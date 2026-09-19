/**
 * Getting one Utterance's Clip: the cache, the Provider, the timeout, and the
 * one place `SynthesisResult` stops being a union.
 *
 * Everything here runs under Node. That is not incidental — it is what lets the
 * read-ahead be tested at all. A Clip only becomes an `AudioBuffer` in
 * `audio-graph.ts`, and by then every decision about *which* bytes and *whether
 * they were paid for* has already been made and tested.
 */

import { createMemoryCache } from '../core/memory-cache';
import { SynthesisError } from '../core/providers/errors';
import type { SynthesisResult, Timestamp, TTSProvider } from '../core/providers/types';
import { withTimeout } from '../core/timeout';
import { clipCacheKey, toStored, type ClipCache, type StoredClip } from './clip-cache';
import { UNSPEAKABLE_MS } from './gap';
import { pcm16ToFloat32 } from './pcm';

/**
 * A Clip ready to be put on the queue. Three arms, one per thing that can come
 * back:
 *
 * - `samples` — the normal path. ADR 0013 asks every Provider for PCM and every
 *   Provider on the list can emit it, so this is what almost every Clip is.
 * - `encoded` — the fallback ADR 0013 keeps, for the OpenAI-compatible Provider
 *   talking to a self-hosted server that only emits MP3. It stays bytes until
 *   `audio-graph.ts` decodes it, because that is where the decoder is, and it is
 *   why `disableFFmpeg: false` is in `app.config.ts`.
 * - `silence` — an Utterance that was never sent to a Provider because it is not
 *   Speakable, or one whose reply carried no samples at all. Silence is a Clip
 *   like any other: it takes time, the reading passes over it, and it is
 *   highlighted at Utterance level while it does (CONTEXT.md, ADR 0005).
 */
export type PreparedClip =
  | { utterance: number; audio: 'samples'; samples: Float32Array<ArrayBuffer>; sampleRate: number; words: Timestamp[] | null }
  | { utterance: number; audio: 'encoded'; bytes: Uint8Array<ArrayBuffer>; mediaType: string; words: Timestamp[] | null }
  | { utterance: number; audio: 'silence'; seconds: number; words: null };

/**
 * A Provider's reply as a Clip.
 *
 * The PCM conversion happens here rather than in the graph so that the sign and
 * byte order are tested (`pcm.ts`), and an empty reply becomes silence rather
 * than an error: Speechify answers unspeakable text with zero samples and a note
 * saying so, and `AudioBuffer` refuses a length of zero
 * (`NotSupportedError: The number of frames provided (0) is less than or equal
 * to the minimum bound`), so a Clip of no samples has to be turned into
 * something playable before it reaches the graph.
 */
export function prepareClip(utterance: number, result: SynthesisResult): PreparedClip {
  const words = result.timestamps && result.timestamps.length > 0 ? result.timestamps : null;
  if (result.audio === 'pcm') {
    const samples = pcm16ToFloat32(result.samples);
    if (samples.length === 0) return silence(utterance);
    return { utterance, audio: 'samples', samples, sampleRate: result.sampleRate, words };
  }
  if (result.bytes.byteLength === 0) return silence(utterance);
  return { utterance, audio: 'encoded', bytes: result.bytes, mediaType: result.mediaType, words };
}

/** A beat in place of speech, for text no Provider was asked to speak. */
export function silence(utterance: number, ms: number = UNSPEAKABLE_MS): PreparedClip {
  return { utterance, audio: 'silence', seconds: Math.max(0, ms) / 1000, words: null };
}

export interface ClipFetcherDeps {
  /** The Provider, already configured with its key by whatever built it (ADR 0002: a key arrives as a setting, never as a side effect). */
  provider: TTSProvider;
  /** The Voice, which is per document (ADR 0010). */
  voice: string;
  /** Where Clips are kept. Memory only (ADR 0002); `createMemoryCache` is the only implementation. */
  cache?: ClipCache;
  /** Philosophy rule 1: a request that never settles is a spinner that never stops. The plugin's own default. */
  timeoutMs?: number;
  /** Injected so a test can watch the abort; `AbortController` is a global on Hermes. */
  newAbortController?(): AbortController;
}

export interface ClipFetcher {
  /** The Clip for one Utterance, from the cache if it is there and from the Provider if it is not. Rejects with a `SynthesisError`. */
  fetch(utterance: number, text: string, speakable: boolean): Promise<PreparedClip>;
}

/** The plugin's number, and for its reason: a Provider that has not answered in a minute is not going to. */
export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 60_000;

/** About 30 minutes of 24 kHz PCM. Memory only, so the bound is what the device will tolerate rather than what a disk would (ADR 0002). */
export const DEFAULT_CACHE_BYTES = 96 * 1024 * 1024;

export function createClipFetcher(deps: ClipFetcherDeps): ClipFetcher {
  const cache = deps.cache ?? createMemoryCache<StoredClip>({ maxBytes: DEFAULT_CACHE_BYTES });
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS;

  /**
   * One synthesis per cache key, however many callers ask.
   *
   * Keyed on the cache key rather than the Utterance index, so the same sentence
   * appearing twice in a document — a refrain, a repeated heading — is paid for
   * once. Without it, two concurrent fetches of the same text both reach the
   * Provider and both are billed, which under ADR 0002 is the owner's own money
   * and under philosophy rule 4 is the thing this project promises not to do.
   *
   * **Registered synchronously, and before the cache is consulted.** That is the
   * whole of it, and it is the plugin's own note: consulting the cache first puts
   * an `await` between the lookup and the registration, and two calls
   * interleaving at that `await` both miss and both start a synthesis. So the
   * job that goes into this map is the cache read *and* the synthesis, and it
   * goes in before either runs.
   */
  const inFlight = new Map<string, Promise<SynthesisResult>>();

  async function synthesize(key: string, text: string): Promise<SynthesisResult> {
    const controller = deps.newAbortController?.() ?? new AbortController();
    // The abort stops the request itself; the rejection is what the caller sees.
    const result = await withTimeout(
      deps.provider.synthesize(text, { voice: deps.voice, signal: controller.signal }),
      timeoutMs,
      () => new SynthesisError('network', `${deps.provider.id}: no audio within ${Math.round(timeoutMs / 1000)}s`),
      () => controller.abort(),
    );
    await cache.put(key, toStored(result));
    return result;
  }

  return {
    fetch(utterance, text, speakable) {
      // Never sent to a Provider, so never cached and never keyed: there is no
      // reply to remember (CONTEXT.md, **Speakable**).
      if (!speakable) return Promise.resolve(silence(utterance));

      const key = clipCacheKey(deps.provider.id, deps.voice, text);
      let job = inFlight.get(key);
      if (!job) {
        job = (async () => {
          const hit = await cache.match(key);
          return hit ? hit.clip : synthesize(key, text);
        })();
        inFlight.set(key, job);
        // Cleared on settle, so a failure is asked again rather than remembered
        // as one. The `catch` is for this side chain only; the caller below still
        // sees the rejection.
        void job.catch(() => {}).finally(() => inFlight.delete(key));
      }
      // Each caller prepares its own Clip: one synthesis, two Utterances.
      return job.then((result) => prepareClip(utterance, result));
    },
  };
}
