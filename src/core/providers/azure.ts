import { alignWords, describeAlignment, type TimedWord } from '../align';
import { concatBytes } from './audio';
import { buildSSML, buildTextFrame, parseBinaryFrame, parseTextFrame, parseWordBoundaries, pinnedTail } from './azure-ws';
import { SynthesisError } from './errors';
import { isSpeakable } from './speechify';
import { MULTILINGUAL, type ListVoicesOptions, type SynthesisOptions, type SynthesisResult, type TTSProvider, type VoiceInfo } from './types';

/**
 * Azure Speech, over the WebSocket route the desktop plugin speaks by hand
 * (ADR 0037). One socket per Utterance: three text frames out, then binary
 * `audio` frames and `audio.metadata` word boundaries back until `turn.end`.
 *
 * ADR 0005 took Azure to have no word timings here, because `WordBoundary`
 * exists only in the Speech SDK and the SDK does not run under React Native.
 * The plugin never used the SDK, and React Native has a `WebSocket` of its
 * own, so the same frames give this app the same word boundaries — measured
 * from Node with raw PCM on 2026-09-22 (notes/NOTES_2026-09-22.md, 14:30).
 *
 * ## What the port changed
 *
 * - **Raw samples, not the plugin's MP3** (ADR 0013): `raw-24khz-16bit-mono-pcm`,
 *   reported as `pcm` at 24 kHz. `raw-48khz` was measured to be 24 kHz audio
 *   upsampled (14:31), so it would be twice the bytes for nothing.
 * - **The key goes in the upgrade's `Ocp-Apim-Subscription-Key` header**, which
 *   React Native's constructor takes as a third argument, and never in the URL,
 *   where the plugin put it because Firefox's `WebSocket` sends no headers.
 *   Azure accepted a key sent that way (15:32).
 * - **No REST `checkSynthesis`.** The plugin probed over REST because a refused
 *   upgrade reached it as a bare `onerror` with no status. Here the refusal's
 *   status arrives in the `close` that follows (14:45), and ADR 0026 keeps
 *   synthesis out of connection tests: the voice list, which Azure
 *   authenticates, is the check.
 * - **A refusal says what it was.** 401 is the key or the region, since a key
 *   used in another region is also a 401; 403 on a synthesis is the month's
 *   characters; 429, or a close with code 4429, waits and asks again (#40);
 *   a 5xx is asked once more; a close 1007 names the voice.
 * - **A pinned tail drops the clip's timings.** See `pinnedTail`.
 * - **Text with nothing to say is not sent**, as in Fish: Azure answers
 *   asterisks with a clean `turn.end` and no audio, and bills the turn anyway.
 *
 * **No speed, ever** (ADR 0009): the SSML carries no `<prosody rate>`.
 */
export type AzureConfig = { apiKey: string; region: string };

/**
 * A `WebSocket` constructor that takes the upgrade's request headers as a third
 * argument. React Native's does (`Libraries/WebSocket/WebSocket.js`); the DOM
 * type this project compiles against declares two arguments, which is why this
 * is its own type rather than `typeof WebSocket`.
 */
export type HeaderWebSocket = new (
  url: string,
  protocols: string | string[] | undefined,
  options: { headers: Record<string, string> },
) => WebSocket;

/**
 * What Azure takes beyond the contract's `fetch`: the plugin's two, which are
 * platform capabilities and so reach `ProviderDeps`, and `wait`, which is not
 * and does not — it exists so a test can be fast without stubbing a global, as
 * Fish's does.
 */
export type AzureDeps = {
  fetch: typeof fetch;
  getWebSocket: () => HeaderWebSocket;
  /** 32 hex digits, which Azure takes as both `X-ConnectionId` and `X-RequestId`. */
  newRequestId: () => string;
  /** The pause before a retry; `setTimeout` when absent, nothing in the tests. */
  wait?: (ms: number) => Promise<void>;
};

export const AZURE_OUTPUT_FORMAT = 'raw-24khz-16bit-mono-pcm';
export const AZURE_SAMPLE_RATE = 24_000;
/**
 * The pauses between attempts Azure refuses for too many requests: 31 s in
 * all, inside the 60 s `runtime.ts` allows one synthesis, after which the
 * refusal is reported (#40). F0's documented "20 transactions per 60 seconds"
 * was not enforced when measured — 40 in 16 s (notes, 15:32) — so nothing is
 * counted ahead of a refusal.
 */
export const RATE_LIMIT_WAITS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000];
/** The pause before a refused upgrade with a 5xx is asked again, as Speechify's and Fish's. */
export const RETRY_DELAY_MS = 500;
/**
 * How long a socket's `error` waits for the `close` that carries its reason.
 * React Native dispatches the two together; Node's `WebSocket` was measured
 * firing no `close` at all after a refused upgrade (notes, 14:33).
 */
export const CLOSE_GRACE_MS = 1_000;

type AzureVoice = { ShortName?: unknown; DisplayName?: unknown; LocalName?: unknown; Locale?: unknown };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const MULTILINGUAL_NAME = /multilingual|多语言/i;

/**
 * Azure's multilingual voices speak any language; their names say so in
 * every form the API returns ("en-US-AvaMultilingualNeural", "Ava
 * Multilingual", "晓晓 多语言"). They go under `mul`, so the voice sheet lists
 * them as their own group rather than under their home locale.
 *
 * By name, as the plugin decides it. The list's metadata would call about three
 * times as many voices multilingual (`SecondaryLocaleList`, 162 of 691), the
 * MAI and Dragon voices among them, but those are named for one locale and are
 * looked for there.
 */
export function isMultilingualAzureVoice(v: AzureVoice): boolean {
  return MULTILINGUAL_NAME.test([v.ShortName, v.DisplayName, v.LocalName].filter((part) => typeof part === 'string').join(' '));
}

/**
 * The region the owner typed, as the label it becomes in the host name — with
 * whitespace removed and lower-cased, so `East Asia` is `eastasia` — or null
 * when it is not one. Only letters and digits make an Azure region id, and
 * anything else would put the key into a request to some other host.
 */
export function azureRegion(typed: string): string | null {
  const id = typed.replace(/\s+/g, '').toLowerCase();
  return /^[a-z0-9]+$/.test(id) ? id : null;
}

/**
 * The HTTP status inside a close reason, or null. A refused upgrade reaches
 * React Native as a `close` 1006 whose reason is SocketRocket's
 * `Received bad response code from server: 401.` (notes/NOTES_2026-09-22.md,
 * 14:45) — the status is only there as text.
 */
export function refusedStatus(reason: string): number | null {
  const match = /response code[^0-9]{0,24}(\d{3})/i.exec(reason);
  return match ? Number(match[1]) : null;
}

type Spoken = { ok: true; audio: Uint8Array<ArrayBuffer>; words: TimedWord[] };
type Ended = { ok: false; status: number | null; code: number | null; reason: string };

export function createAzureProvider(cfg: AzureConfig, deps: AzureDeps): TTSProvider {
  const pause = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /** The key and the host, or the reason there are none; before any request, so nothing half-configured goes out. */
  function reach(): { key: string; region: string; host: string } {
    const key = cfg.apiKey.trim();
    if (!key) throw new SynthesisError('no-key', 'Azure API key is not set');
    const region = azureRegion(cfg.region);
    if (!region) {
      const typed = cfg.region.trim();
      throw new SynthesisError('unknown', typed ? `"${typed}" is not an Azure region id, such as eastasia` : 'Azure region is not set');
    }
    return { key, region, host: `${region}.tts.speech.microsoft.com` };
  }

  /** What a status means. A 403 on the voice list is the key; on a synthesis it is the month's characters, as the plugin measured REST answering. */
  function refused(status: number, region: string, synthesis: boolean): SynthesisError {
    if (status === 401) return new SynthesisError('auth', `Azure refused the API key for the region ${region} (401). Check the key and the region.`);
    if (status === 403 && synthesis) return new SynthesisError('quota', 'Azure refused to synthesize (403): this month’s characters are likely used up, or the key may not synthesize.');
    if (status === 403) return new SynthesisError('auth', 'Azure refused the API key (403).');
    if (status === 429) return new SynthesisError('rate-limit', 'Azure refused: too many requests (429).');
    return new SynthesisError('unknown', `Azure answered HTTP ${status}.`);
  }

  /**
   * One turn on a socket of its own. Resolves with the audio and the words, or
   * with how the socket ended; rejects only for an abort or for something that
   * was never a reply — a constructor that threw, a frame that could not be
   * read — so the caller can decide what to retry.
   */
  function turn(text: string, voice: string, key: string, host: string, signal: AbortSignal): Promise<Spoken | Ended> {
    return new Promise<Spoken | Ended>((resolve, reject) => {
      const requestId = deps.newRequestId();
      let socket: WebSocket;
      try {
        const Socket = deps.getWebSocket();
        socket = new Socket(`wss://${host}/cognitiveservices/websocket/v1?X-ConnectionId=${requestId}`, undefined, {
          headers: { 'Ocp-Apim-Subscription-Key': key },
        });
      } catch (e) {
        reject(new SynthesisError('unknown', `The connection to Azure could not be opened (${e})`));
        return;
      }
      socket.binaryType = 'arraybuffer';

      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const words: TimedWord[] = [];
      let settled = false;
      let grace: ReturnType<typeof setTimeout> | undefined;

      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        if (grace !== undefined) clearTimeout(grace);
        signal.removeEventListener('abort', onAbort);
        try {
          socket.close();
        } catch {
          // Already closed
        }
        settle();
      };
      const onAbort = () => finish(() => reject(new SynthesisError('unknown', 'aborted')));
      signal.addEventListener('abort', onAbort);

      socket.onopen = () => {
        // A throw from an event handler reaches nobody, and would leave the
        // synthesis hanging: every send is inside the guard.
        try {
          const headers = (path: string, contentType: string) => ({
            Path: path,
            'X-RequestId': requestId,
            'X-Timestamp': new Date().toISOString(),
            'Content-Type': contentType,
          });
          socket.send(buildTextFrame(headers('speech.config', 'application/json'), JSON.stringify({ context: { system: { name: 'openreader' } } })));
          socket.send(
            buildTextFrame(
              headers('synthesis.context', 'application/json'),
              JSON.stringify({
                synthesis: {
                  audio: {
                    metadataOptions: { wordBoundaryEnabled: true, sentenceBoundaryEnabled: false },
                    outputFormat: AZURE_OUTPUT_FORMAT,
                  },
                },
              }),
            ),
          );
          socket.send(buildTextFrame(headers('ssml', 'application/ssml+xml'), buildSSML(text, voice)));
        } catch (e) {
          finish(() => reject(new SynthesisError('unknown', `The request could not be sent to Azure (${e})`)));
        }
      };

      // Word boundaries can arrive after the audio they time (for a Chinese
      // voice, all of them did), so nothing is decided before `turn.end`.
      socket.onmessage = (event: MessageEvent) => {
        try {
          if (typeof event.data === 'string') {
            const { headers, body } = parseTextFrame(event.data);
            if (headers.Path === 'audio.metadata') words.push(...parseWordBoundaries(body));
            else if (headers.Path === 'turn.end') finish(() => resolve({ ok: true, audio: concatBytes(chunks), words }));
            return;
          }
          const { headers, payload } = parseBinaryFrame(event.data as ArrayBuffer);
          if (headers.Path === 'audio' && payload.length) chunks.push(payload);
        } catch (e) {
          finish(() => reject(new SynthesisError('unknown', `A reply from Azure could not be read (${e})`)));
        }
      };

      // React Native dispatches a bare `error` and then the `close` with the
      // reason in it, so an error waits for that close rather than settling
      // without knowing why.
      socket.onerror = () => {
        grace ??= setTimeout(() => finish(() => resolve({ ok: false, status: null, code: null, reason: '' })), CLOSE_GRACE_MS);
      };
      socket.onclose = (event: CloseEvent) => {
        const code = typeof event?.code === 'number' ? event.code : null;
        const reason = typeof event?.reason === 'string' ? event.reason : '';
        finish(() => resolve({ ok: false, status: refusedStatus(reason), code, reason }));
      };
    });
  }

  /** The error a socket that ended without `turn.end` stands for, once nothing is left to retry. */
  function ended(end: Ended, region: string, voice: string, waited: number): SynthesisError {
    if (end.status === 429 || end.code === 4429) {
      const after = waited ? ` It still did after ${waited / 1000} s of waiting.` : '';
      return new SynthesisError('rate-limit', `Azure refused: too many requests (${end.code === 4429 ? 'close 4429' : '429'}).${after}`);
    }
    if (end.status !== null) return refused(end.status, region, true);
    const said = `${end.code ?? ''}${end.reason ? ` ${end.reason}` : ''}`.trim();
    if (end.code === 1007) return new SynthesisError('unknown', `Azure does not offer the voice ${voice} (${said}).`);
    return new SynthesisError('network', `The connection to Azure ended before the speech did${said ? ` (${said})` : ''}.`);
  }

  /** The clip a finished turn makes, with its timings when Azure gave some that can be used. */
  function clip(spoken: Spoken, text: string, voice: string, after: string): SynthesisResult {
    // Speakable text that comes back silent is a fault, not a pause: ADR 0027's
    // missing audio stops the reading where a skip would lose words unheard.
    if (!spoken.audio.length) throw new SynthesisError('unknown', `Azure returned no audio for “${text.slice(0, 60)}”.`);
    const pcm = { audio: 'pcm' as const, samples: spoken.audio, sampleRate: AZURE_SAMPLE_RATE };
    const { words } = spoken;
    if (!words.length) return { ...pcm, note: `${voice}: no word boundaries${after}` };
    const pinned = pinnedTail(words);
    if (pinned) {
      const at = words[words.length - 1].start.toFixed(2);
      return { ...pcm, note: `${voice}: the last ${pinned} of ${words.length} word boundaries all at ${at} s, so the Utterance is highlighted whole${after}` };
    }
    // Azure sends no offset into the text, and `29.83 dollars` comes back as
    // one boundary: the aligner places the words by their text (ADR 0005).
    const aligned = alignWords(words, text);
    if (!aligned.timestamps.length) return { ...pcm, note: `${voice}: none of the ${words.length} word boundaries is in the text${after}` };
    const detail = describeAlignment(aligned);
    return { ...pcm, timestamps: aligned.timestamps, note: `${voice}: ${aligned.timestamps.length} word timings${detail ? `, ${detail}` : ''}${after}` };
  }

  return {
    id: 'azure',
    // The WebSocket's word boundaries, for every voice that sends them; a clip
    // without them is highlighted whole (MAI-Voice-2 voices send none).
    capabilities: { wordTimestamps: true },

    async listVoices(options?: ListVoicesOptions): Promise<VoiceInfo[]> {
      const { key, region, host } = reach();
      let response: Response;
      try {
        response = await deps.fetch(`https://${host}/cognitiveservices/voices/list`, {
          headers: { 'Ocp-Apim-Subscription-Key': key },
          signal: options?.signal,
        });
      } catch (e) {
        throw new SynthesisError('network', `Cannot reach ${host} (${e})`);
      }
      if (!response.ok) throw refused(response.status, region, false);

      let list: unknown;
      try {
        list = await response.json();
      } catch {
        throw new SynthesisError('unknown', 'Azure answered the voice list with something that is not JSON.');
      }
      if (!Array.isArray(list)) throw new SynthesisError('unknown', 'Azure answered the voice list with something that is not a list.');
      return list.flatMap((entry: AzureVoice): VoiceInfo[] => {
        const id = str(entry?.ShortName);
        const locale = str(entry?.Locale);
        if (!id || !locale) return [];
        const label = str(entry.LocalName) || str(entry.DisplayName) || id;
        return [{ id, label, locale: isMultilingualAzureVoice(entry) ? MULTILINGUAL : locale }];
      });
    },

    async synthesize(text: string, o: SynthesisOptions): Promise<SynthesisResult> {
      const { key, region, host } = reach();
      // Nothing to say: no request, and no samples, which plays as a pause
      if (!isSpeakable(text)) return { audio: 'pcm', samples: new Uint8Array(0), sampleRate: AZURE_SAMPLE_RATE, note: 'no speakable text' };

      let waits = 0;
      let waited = 0;
      let retried = '';
      for (;;) {
        // An aborted signal fires no further `abort` event, so it is checked
        // before a socket is opened for it, and again after every pause.
        if (o.signal.aborted) throw new SynthesisError('unknown', 'aborted');
        const outcome = await turn(text, o.voice, key, host, o.signal);
        if (outcome.ok) {
          const after = `${retried}${waits ? ` after ${waits} rate-limit wait${waits === 1 ? '' : 's'}` : ''}`;
          return clip(outcome, text, o.voice, after);
        }
        if ((outcome.status === 429 || outcome.code === 4429) && waits < RATE_LIMIT_WAITS_MS.length) {
          const ms = RATE_LIMIT_WAITS_MS[waits++];
          waited += ms;
          await pause(ms);
          continue;
        }
        if (outcome.status !== null && outcome.status >= 500 && !retried) {
          retried = ` after a retry of HTTP ${outcome.status}`;
          await pause(RETRY_DELAY_MS);
          continue;
        }
        throw ended(outcome, region, o.voice, waited);
      }
    },
  };
}
