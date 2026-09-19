import { base64ToBytes, readClip } from './audio';
import { normalizeBaseURL } from './base-url';
import { SynthesisError } from './errors';
import { MULTILINGUAL, type ListVoicesOptions, type ProviderId, type SynthesisOptions, type SynthesisResult, type TTSProvider, type VoiceInfo } from './types';

/**
 * The client the OpenAI and OpenAI Compatible sections share: OpenAI's speech
 * API as every server that speaks it has it — `/v1/audio/speech` for the bytes,
 * `/v1/models` as the cheapest authenticated probe, `/v1/audio/voices` where a
 * server publishes its voices — plus the chat completions route that carries
 * audio as base64, which is all some servers' TTS has. What used to be read off
 * the hostname is said by the caller: whether a key is required, the route, the
 * voices the server documents, the name its errors carry.
 */

/**
 * How a server synthesizes: OpenAI's `/v1/audio/speech`, which answers with the
 * audio bytes, or a chat completion with an `audio` object, which answers with
 * base64 audio inside the JSON — the shape OpenAI gave its audio chat models,
 * and the only one some gateways expose (their `/v1/audio/speech` is a 404).
 */
export type SynthesisRoute = 'speech' | 'chat';

export type OpenAICompatibleConfig = {
  /** The provider's id: the voice ids' prefix and the cache's provider key. */
  id: ProviderId;
  /** What the errors call the server: "OpenAI speech: HTTP 502". */
  label: string;
  apiKey: string;
  baseURL: string;
  /**
   * Sent with every request, before the Authorization header. For gateways
   * that authenticate with their own headers — a Cloudflare Access service
   * token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), a reverse
   * proxy with a custom header — in front of a server that has no key.
   */
  headers?: Record<string, string>;
  model: string;
  /** Comma-separated voice ids to offer; empty means "ask the server, else `defaultVoices`, else nothing". */
  voices?: string;
  /**
   * Whether a request without a key is refused before it goes out — a
   * hosted service, which answers 401 otherwise. A compatible server may
   * have none (Kokoro-FastAPI, Chatterbox-TTS-Server) or sit behind a
   * gateway that wants other headers: with no key the request goes out
   * without Authorization, and a server that wanted one answers 401.
   */
  keyRequired: boolean;
  route: SynthesisRoute;
  /** The voices the server documents, for one that publishes no list; none when absent. */
  defaultVoices?: readonly string[];
};

/** What the speech route is asked for first, and what it is asked for after a server refuses that (ADR 0013). */
export const PCM_FORMAT = 'pcm';
export const FALLBACK_FORMAT = 'mp3';

/** "alloy, nova" or one per line → ['alloy', 'nova']. */
export function parseVoiceIds(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Read a voice list in the shapes OpenAI-compatible servers use — there is
 * no standard: Kokoro-FastAPI answers `{ voices: [{ id, name }] }`, others
 * `{ voices: ["id"] }`, `{ data: [...] }`, or a bare array. Returns [] when
 * nothing usable is found.
 */
export function parseVoiceList(body: unknown): { id: string; label: string }[] {
  const container = body as { voices?: unknown; data?: unknown } | unknown[] | null;
  const items = Array.isArray(container)
    ? container
    : Array.isArray(container?.voices)
      ? container.voices
      : Array.isArray(container?.data)
        ? container.data
        : [];
  const out: { id: string; label: string }[] = [];
  for (const item of items) {
    if (typeof item === 'string') {
      if (item) out.push({ id: item, label: item });
      continue;
    }
    const obj = item as { id?: unknown; voice_id?: unknown; name?: unknown } | null;
    const id = [obj?.id, obj?.voice_id, obj?.name].find((v) => typeof v === 'string' && v) as string | undefined;
    if (!id) continue;
    const name = typeof obj?.name === 'string' && obj.name ? obj.name : id;
    out.push({ id, label: name });
  }
  return out;
}

/** `{ data: [{ id }] }` as OpenAI answers, or `{ models: [...] }`, or a bare array. */
export function parseModelList(body: unknown): string[] {
  const container = body as { data?: unknown; models?: unknown } | unknown[] | null;
  const items = Array.isArray(container)
    ? container
    : Array.isArray(container?.data)
      ? container.data
      : Array.isArray(container?.models)
        ? container.models
        : [];
  const out: string[] = [];
  for (const item of items) {
    const id = typeof item === 'string' ? item : (item as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
  }
  return out;
}

function statusError(status: number, what: string): SynthesisError {
  if (status === 401 || status === 403) return new SynthesisError('auth', `${what}: the server rejected the API key (${status})`);
  if (status === 429) return new SynthesisError('rate-limit', `${what}: rate limited (429)`);
  return new SynthesisError('unknown', `${what}: HTTP ${status}`);
}

/**
 * What the server said, from an error body in OpenAI's shape — the longer
 * of `error.message` and `error.param`, since OpenAI puts the detail in the
 * message ("Invalid value: 'x'. Supported values are…", param "voice") and
 * other servers in the param ("Unknown voice: x. Available voices: […]",
 * message "Param Incorrect"). Empty for anything else.
 */
export function serverReason(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: unknown } | null)?.error;
    if (typeof error === 'string') return error.trim().slice(0, 300);
    const fields = error as { message?: unknown; param?: unknown } | null;
    const texts = [fields?.message, fields?.param].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    return texts.sort((a, b) => b.length - a.length)[0]?.trim().slice(0, 300) ?? '';
  } catch {
    return '';
  }
}

/**
 * The typed error for a refused request. OpenAI reports an exhausted
 * balance as 429 with code "insufficient_quota" — the same status as rate
 * limiting, told apart only by the body. Any other refusal quotes the
 * server's reason after the status, when the body gives one: a wrong voice
 * id is the common case, and the server names the right ones.
 */
function refusalFrom(status: number, body: string, what: string): SynthesisError {
  if (status === 429 && /insufficient_quota|exceeded your current quota/i.test(body)) {
    return new SynthesisError('quota', 'The server refused to synthesize: quota exceeded (insufficient_quota)');
  }
  const error = statusError(status, what);
  const reason = error.kind === 'unknown' ? serverReason(body) : '';
  return reason ? new SynthesisError('unknown', `${error.message} — ${reason}`) : error;
}

/** The base64 audio of a chat completion reply, `choices[0].message.audio.data`; null when the reply carries none. */
export function chatAudioData(reply: unknown): string | null {
  const choices = (reply as { choices?: unknown } | null)?.choices;
  const first = (Array.isArray(choices) ? choices[0] : null) as { message?: { audio?: { data?: unknown } | null } | null } | null;
  const data = first?.message?.audio?.data;
  return typeof data === 'string' && data ? data : null;
}

export function createOpenAICompatibleProvider(cfg: OpenAICompatibleConfig, deps: { fetch: typeof fetch }): TTSProvider {
  // Tolerates the SDK's `/v1` suffix and trailing slashes
  const base = () => normalizeBaseURL(cfg.baseURL);
  const authHeaders = (): Record<string, string> => ({
    ...(cfg.headers ?? {}),
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
  });
  const missingKey = () => cfg.keyRequired && !cfg.apiKey;
  const noKey = () => new SynthesisError('no-key', `${cfg.label} API key is not set`);

  /**
   * Set once a server has *proved* it cannot do PCM, by answering the MP3
   * request that followed its refusal. Only a successful fallback sets it, so a
   * 400 about anything else — a voice id the server does not have is the common
   * one — cannot latch a server into MP3 for the rest of its life.
   */
  let refusesPcm = false;

  async function get(path: string, signal?: AbortSignal): Promise<Response> {
    try {
      return await deps.fetch(`${base()}${path}`, { headers: authHeaders(), signal });
    } catch (e) {
      throw new SynthesisError('network', `Cannot reach ${base()}: ${e}`);
    }
  }

  async function post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    try {
      return await deps.fetch(`${base()}${path}`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      throw new SynthesisError('network', String(e));
    }
  }

  /**
   * One synthesis on the speech route, which answers with the bytes.
   *
   * PCM is asked for first, because that is what the playback engine wants and
   * because it deletes the encoder padding that would otherwise be audible at
   * every sentence boundary (ADR 0013). But this route is spoken by *any*
   * server, and a self-hosted one may only emit MP3: a 400 — the status a
   * server uses for a `response_format` it does not know — is asked again as
   * MP3 and reported as `encoded` bytes for the playback layer to decode. If
   * that second request fails too, the first refusal is what surfaces, since a
   * 400 that is not about the format says something more useful.
   */
  async function speakOnSpeechRoute(text: string, voice: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const what = `${cfg.label} speech`;
    const ask = async (format: string): Promise<Response> => post('/v1/audio/speech', { model: cfg.model, voice, input: text, response_format: format }, signal);

    let response = refusesPcm ? await ask(FALLBACK_FORMAT) : await ask(PCM_FORMAT);
    let note = refusesPcm ? 'the server does not do PCM; asked for MP3' : '';

    if (!response.ok && !refusesPcm) {
      const refusal = refusalFrom(response.status, await response.text().catch(() => ''), what);
      if (response.status !== 400) throw refusal;
      const retry = await ask(FALLBACK_FORMAT);
      if (!retry.ok) throw refusal;
      refusesPcm = true;
      response = retry;
      note = 'the server refused PCM; asked for MP3';
    }
    if (!response.ok) throw refusalFrom(response.status, await response.text().catch(() => ''), what);

    const bytes = new Uint8Array(await response.arrayBuffer());
    const clip = readClip(bytes, response.headers.get('Content-Type'));
    return note ? { ...clip, note } : clip;
  }

  /**
   * One synthesis on the chat route. The text goes as an `assistant` message
   * with an `audio` object naming the voice and format, and the audio comes
   * back as base64 in `choices[0].message.audio.data`; a reply without it — a
   * chat model in the Model field answers text — is an error here, at a
   * connection check and while reading alike, never a silent empty clip.
   *
   * MP3 is what this route asks for, and the result says `encoded` honestly.
   * OpenAI's own audio chat models document a `pcm16` format, but this route
   * exists for the gateways whose `/v1/audio/speech` is missing, and those
   * document mp3 and nothing else; asking them for a format nobody has measured
   * would break the one case the route is for. The reply also names no sample
   * rate, so calling its bytes PCM would be a guess.
   */
  async function speakOnChatRoute(text: string, voice: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const what = 'chat/completions audio';
    const response = await post('/v1/chat/completions', { model: cfg.model, messages: [{ role: 'assistant', content: text }], audio: { format: FALLBACK_FORMAT, voice } }, signal);
    if (!response.ok) throw refusalFrom(response.status, await response.text().catch(() => ''), what);
    let reply: unknown;
    try {
      reply = await response.json();
    } catch {
      throw new SynthesisError('unknown', `${what}: the reply was not JSON`);
    }
    const data = chatAudioData(reply);
    if (!data) throw new SynthesisError('unknown', `${what}: the reply carried no audio — is "${cfg.model}" a speech model?`);
    try {
      return { audio: 'encoded', bytes: base64ToBytes(data), mediaType: 'audio/mpeg', note: 'audio through /v1/chat/completions' };
    } catch (e) {
      throw new SynthesisError('unknown', `${what}: the audio was not valid base64 (${e})`);
    }
  }

  const speak = (text: string, voice: string, signal?: AbortSignal): Promise<SynthesisResult> =>
    cfg.route === 'chat' ? speakOnChatRoute(text, voice, signal) : speakOnSpeechRoute(text, voice, signal);

  const provider: TTSProvider = {
    id: cfg.id,
    // OpenAI's speech endpoint returns no timing information at all, and
    // neither does the chat route (a probed gateway's `transcript` is null,
    // 2026-09-06). Nothing is estimated to fill the gap (ADR 0005).
    capabilities: { wordTimestamps: false },

    /**
     * Voices, in order of trust: the ones the owner typed; the ones the
     * server publishes on /v1/audio/voices (a common extension of
     * OpenAI-compatible servers — OpenAI itself answers 404); the ones the
     * caller documents for it (OpenAI's own list). A server that cannot be
     * reached at all is an error, not a reason to show the documented names
     * for it.
     */
    async listVoices(options?: ListVoicesOptions): Promise<VoiceInfo[]> {
      const custom = parseVoiceIds(cfg.voices ?? '');
      if (custom.length) return custom.map((id) => ({ id, label: id, locale: MULTILINGUAL }));

      const response = await get('/v1/audio/voices', options?.signal);
      if (response.ok) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          // Not JSON: the route exists but is something else; fall through
        }
        const published = parseVoiceList(body);
        if (published.length) return published.map((v) => ({ ...v, locale: MULTILINGUAL }));
      } else if (response.status === 401 || response.status === 403) {
        throw statusError(response.status, `${base()}/v1/audio/voices`);
      }
      return (cfg.defaultVoices ?? []).map((id) => ({ id, label: id, locale: MULTILINGUAL }));
    },

    /** The model ids the server offers; the cheapest authenticated request the API has, so also the connection probe. */
    async listModels(): Promise<string[]> {
      if (missingKey()) throw noKey();
      const url = `${base()}/v1/models`;
      const response = await get('/v1/models');
      // Not every OpenAI-compatible server has a model list (Chatterbox-TTS-
      // Server answers 404); that is "no models published", not a failure —
      // the voice list and the synthesis probe still prove the connection.
      if (response.status === 404 || response.status === 405) return [];
      if (!response.ok) throw statusError(response.status, url);
      try {
        return parseModelList(await response.json());
      } catch {
        return [];
      }
    },

    async checkConnection(): Promise<void> {
      await provider.listModels!();
    },

    /**
     * A two-character request on the configured route, discarded.
     * listModels proves the key is accepted; only an actual synthesis
     * proves the account can spend, the voice is accepted and — on the
     * chat route — the model answers audio at all.
     */
    async checkSynthesis(voice: string): Promise<void> {
      if (missingKey()) throw noKey();
      await speak('Hi', voice);
    },

    async synthesize(text: string, o: SynthesisOptions): Promise<SynthesisResult> {
      if (missingKey()) throw noKey();
      return speak(text, o.voice, o.signal);
    },
  };
  return provider;
}
