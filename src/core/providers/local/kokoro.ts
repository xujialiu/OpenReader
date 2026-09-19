import { alignWords, describeAlignment } from '../../align';
import type { TimedWord } from '../../align';
import { base64ToBytes, readClip } from '../audio';
import { normalizeBaseURL } from '../base-url';
import { SynthesisError } from '../errors';
import type { ListVoicesOptions, SynthesisOptions, SynthesisResult, TTSProvider, VoiceInfo } from '../types';

/** Kokoro voice ids encode language and gender via a prefix, e.g. af_bella = American Female. */
const LOCALE_BY_PREFIX: Record<string, string> = {
  a: 'en-US',
  b: 'en-GB',
  z: 'zh-CN',
  j: 'ja-JP',
  e: 'es-ES',
  f: 'fr-FR',
  h: 'hi-IN',
  i: 'it-IT',
  p: 'pt-BR',
};

export function localeForKokoroVoice(voiceId: string): string {
  const underscore = voiceId.indexOf('_');
  if (underscore < 1) return 'en-US';
  return LOCALE_BY_PREFIX[voiceId[0]] ?? 'en-US';
}

type CaptionedResponse = {
  audio?: string;
  timestamps?: { word?: string; start_time?: number; end_time?: number }[];
};

function toTimedWords(raw: CaptionedResponse['timestamps']): TimedWord[] {
  if (!Array.isArray(raw)) return [];
  const words: TimedWord[] = [];
  for (const t of raw) {
    if (typeof t?.word !== 'string' || typeof t.start_time !== 'number' || typeof t.end_time !== 'number') {
      continue;
    }
    words.push({ text: t.word, start: t.start_time, end: t.end_time });
  }
  return words;
}

export type LocalEngineDeps = {
  fetch: typeof fetch;
  /**
   * Sent with every request. For a gateway in front of the server — a
   * Cloudflare Access service token (`CF-Access-Client-Id` /
   * `CF-Access-Client-Secret`), a reverse proxy with its own header — so
   * that the Local engine, and with it word-level highlighting, works from
   * another machine.
   */
  headers?: Record<string, string>;
};

function createKokoroProvider(rawBaseURL: string, deps: LocalEngineDeps): TTSProvider {
  // "http://localhost:8880/v1/" is what the OpenAI SDK docs teach; the paths
  // below already start with /v1 or /dev
  const baseURL = normalizeBaseURL(rawBaseURL);
  // A gateway answers 401/403 when the credentials are missing or wrong;
  // that is a different problem from the server being down, and the owner is
  // told so ("rejected the credentials") instead of being sent to Docker.
  const statusError = (what: string, status: number): SynthesisError =>
    status === 401 || status === 403
      ? new SynthesisError('auth', `${what}: the server rejected the credentials (${status})`)
      : new SynthesisError('unknown', `${what} returned ${status}`);
  const call = async (path: string, init: RequestInit): Promise<Response> => {
    const headers = { ...(deps.headers ?? {}), ...((init.headers as Record<string, string> | undefined) ?? {}) };
    try {
      return await deps.fetch(baseURL + path, { ...init, headers });
    } catch (e) {
      // fetch throws outright when the local server isn't up. This must be
      // distinguished here, otherwise the owner would just see a "network
      // error" and go check their own broadband. The message is shown as it
      // is, so it names the address that was tried and asks the one question
      // there is: fetch rejects with the same text for a refused port, a DNS
      // failure and a TLS error alike.
      throw new SynthesisError('local-server-down', `Cannot reach Kokoro at ${baseURL}. Is the server running? (${e})`);
    }
  };

  /**
   * What is asked for on both routes. `pcm` because ADR 0013 wants samples and
   * Kokoro-FastAPI's format list has them; `stream: false` because the captioned
   * route otherwise answers newline-delimited JSON chunks, which is not one JSON
   * document and fails to parse. There is no `speed`: Natural Pace (ADR 0009).
   */
  const payloadFor = (text: string, voice: string) => ({
    model: 'kokoro',
    input: text,
    voice,
    response_format: 'pcm',
    return_timestamps: true,
    stream: false,
  });

  return {
    id: 'local',
    capabilities: { wordTimestamps: true },

    async listVoices(options?: ListVoicesOptions): Promise<VoiceInfo[]> {
      const response = await call('/v1/audio/voices', { signal: options?.signal });
      if (!response.ok) {
        throw statusError('Kokoro voices', response.status);
      }
      let body: { voices?: unknown };
      try {
        body = (await response.json()) as { voices?: unknown };
      } catch (e) {
        throw new SynthesisError('decode-failed', `Kokoro voices response is not valid JSON: ${e}`);
      }
      // Older servers list plain ids; current Kokoro-FastAPI lists
      // `{ id, name }` objects. Accept both, or the list comes back empty.
      const entries = Array.isArray(body.voices) ? body.voices : [];
      const voices: VoiceInfo[] = [];
      for (const entry of entries) {
        const id = typeof entry === 'string' ? entry : (entry as { id?: unknown })?.id;
        if (typeof id !== 'string' || !id) continue;
        const name = (entry as { name?: unknown })?.name;
        voices.push({ id, label: typeof name === 'string' && name ? name : id, locale: localeForKokoroVoice(id) });
      }
      return voices;
    },

    async synthesize(text: string, o: SynthesisOptions): Promise<SynthesisResult> {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFor(text, o.voice)),
        signal: o.signal,
      };

      const captioned = await call('/dev/captioned_speech', init);
      if (captioned.status === 401 || captioned.status === 403) {
        // The plain endpoint sits behind the same gateway; no point trying it
        throw statusError('Kokoro speech', captioned.status);
      }

      if (captioned.ok) {
        let body: CaptionedResponse;
        try {
          body = (await captioned.json()) as CaptionedResponse;
        } catch (e) {
          throw new SynthesisError('decode-failed', `Kokoro captioned response is not valid JSON: ${e}`);
        }
        if (typeof body.audio === 'string') {
          // The audio arrives inside JSON, so there is no Content-Type to read:
          // readClip has only the bytes to go on, and reports `encoded` if a
          // server ignored `response_format` and sent a container anyway.
          let clip: SynthesisResult;
          try {
            clip = readClip(base64ToBytes(body.audio));
          } catch (e) {
            throw new SynthesisError('decode-failed', `Kokoro audio is not valid base64: ${e}`);
          }
          const words = toTimedWords(body.timestamps);
          if (!words.length) return { ...clip, note: 'the captioned reply came without word timestamps' };
          // The server speaks a rewritten text and returns its words; the
          // aligner pairs what it can and bridges the rest, and the debug line
          // says how much of each
          const aligned = alignWords(words, text);
          if (!aligned.timestamps.length) return { ...clip, note: `none of the ${words.length} words the server returned is in the text` };
          const note = describeAlignment(aligned);
          return { ...clip, timestamps: aligned.timestamps, ...(note ? { note } : {}) };
        }
      }

      // Older versions or minimal deployments may not have
      // /dev/captioned_speech. Fall back to the plain endpoint, at the cost
      // of losing word timings — ADR 0005: fall back to utterance level rather
      // than estimating. The note says why, so the debug output can tell a
      // wrong server from a wordless voice.
      const note = captioned.ok
        ? 'the captioned reply had no audio; fell back to /v1/audio/speech'
        : `/dev/captioned_speech returned ${captioned.status}; fell back to /v1/audio/speech`;
      const plain = await call('/v1/audio/speech', init);
      if (!plain.ok) {
        throw statusError('Kokoro speech', plain.status);
      }
      const bytes = new Uint8Array(await plain.arrayBuffer());
      return { ...readClip(bytes, plain.headers.get('Content-Type')), note };
    },

    /**
     * Any OpenAI-compatible server answers /v1/audio/voices and
     * /v1/audio/speech, so a wrong address "works" with the word timings
     * silently gone. This proves /dev/captioned_speech itself, so a connection
     * check can say so while the owner is still looking at the settings.
     */
    async checkWordTimestamps(voice: string): Promise<{ ok: boolean; detail?: string }> {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFor('Test.', voice)),
      };
      const notKokoro = 'this looks like a plain OpenAI-compatible server (those belong in the OpenAI provider), or an old Kokoro-FastAPI';
      const captioned = await call('/dev/captioned_speech', init);
      if (captioned.status === 401 || captioned.status === 403) {
        throw statusError('Kokoro speech', captioned.status);
      }
      if (!captioned.ok) {
        return { ok: false, detail: `/dev/captioned_speech returned ${captioned.status} — ${notKokoro}` };
      }
      let body: CaptionedResponse;
      try {
        body = (await captioned.json()) as CaptionedResponse;
      } catch {
        return { ok: false, detail: `the reply to /dev/captioned_speech is not captioned JSON — ${notKokoro}` };
      }
      return toTimedWords(body.timestamps).length
        ? { ok: true }
        : { ok: false, detail: 'the server answered /dev/captioned_speech without word timestamps' };
    },
  };
}

export const kokoroAdapter = {
  id: 'kokoro',
  label: 'Kokoro-FastAPI',
  voiceName: 'Kokoro',
  site: { host: 'github.com/remsky/Kokoro-FastAPI', url: 'https://github.com/remsky/Kokoro-FastAPI' },
  defaultBaseURL: 'http://localhost:8880',
  capabilities: { wordTimestamps: true },
  create: createKokoroProvider,
};
