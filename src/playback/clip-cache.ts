/**
 * What a Clip is filed under, and what is filed.
 *
 * **The key is the Provider, the Voice and the text — and deliberately not the
 * speed** (ADR 0009, ADR 0010). That is not a simplification: it is the decisive
 * reason speed is applied at playback at all. Put speed in the key and nudging
 * 1.5× to 1.6× discards every Clip the owner has already paid for, along with
 * the quota and bandwidth spent on it, which under ADR 0002 is the owner's own
 * money. The signature below has no speed parameter, so there is nothing to
 * forget.
 *
 * **Memory only.** There is deliberately no disk cache (ADR 0002): the owner
 * rarely re-listens, so a cache of heard audio has little value, and what a disk
 * cache would really be for — synthesizing a whole book ahead for offline
 * listening — is a different feature with two open questions of its own. So the
 * only implementation is `createMemoryCache` from `core/memory-cache.ts`, and
 * this file does not reach for a filesystem to keep the option open.
 */

import type { AudioCache } from '../core/memory-cache';
import type { ProviderId, SynthesisResult } from '../core/providers/types';

/**
 * A Clip as the cache holds it: the reply exactly as the Provider gave it, plus
 * the same bytes under the name the cache's byte budget reads.
 *
 * `audio` is not a copy — it is the identical `Uint8Array` that `clip.samples`
 * or `clip.bytes` already points at, so storing it costs nothing. The indirection
 * exists because `SynthesisResult` is a union whose two arms name the bytes
 * differently (ADR 0013) and `core/memory-cache.ts` is generic in the clip
 * precisely so a caller can say where its bytes are.
 */
export interface StoredClip {
  audio: Uint8Array<ArrayBuffer>;
  clip: SynthesisResult;
}

/** The cache this directory uses, named so a caller cannot accidentally hand it a differently-shaped store. */
export type ClipCache = AudioCache<StoredClip>;

/**
 * The cache key: provider, voice, text.
 *
 * `JSON.stringify` of an array rather than a joined string, so that no delimiter
 * has to be chosen and no voice id or sentence can be written in a way that
 * collides with a different triple. The plugin does the same thing for the same
 * reason.
 */
export function clipCacheKey(provider: ProviderId, voice: string, text: string): string {
  return JSON.stringify([provider, voice, text]);
}

/** A Provider's reply as the cache stores it, with the bytes found in whichever arm of the union they arrived in. */
export function toStored(clip: SynthesisResult): StoredClip {
  return { audio: clip.audio === 'pcm' ? clip.samples : clip.bytes, clip };
}
