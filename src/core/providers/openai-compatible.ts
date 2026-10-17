import { base64ToBytes } from './audio';
import { normalizeBaseURL } from './base-url';
import { SynthesisError } from './errors';
import { responseAudio, responseErrorText, responseJSON, throwIfAborted } from './response';
import { serverReason } from './server-reason';
import { MULTILINGUAL, type ListVoicesOptions, type ProviderId, type SynthesisOptions, type SynthesisResult, type TTSProvider, type VoiceInfo } from './types';

export { serverReason } from './server-reason';

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
/** The statuses a server refuses an unknown `response_format` with: 400, and FastAPI's 422 for a value outside a `Literal` (#65). */
const FORMAT_REFUSALS: readonly number[] = [400, 422];

/**
 * The servers that have *proved* they cannot do PCM, by answering the MP3
 * request that followed their refusal: one for the running app, whatever the
 * number of Provider objects (#202). A Reading and a Download build a Provider
 * for every sentence they send (`synthesize` in `src/offline/runtime.ts`), so a
 * memory inside one was gone by the next sentence, and every sentence paid the
 * refusal again. Kept by Provider, Address and Model, the same arrangement as
 * Fish's `sharedVoiceCache` and Speechify's `sharedQueue`; a test hands in its
 * own and stays isolated.
 */
export const sharedPcmRefusals = new Set<string>();

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

export type OpenAICompatibleDeps = {
  fetch: typeof fetch;
  /** The servers known to refuse PCM; the module's shared one when absent. */
  pcmRefusals?: Set<string>;
};

export function createOpenAICompatibleProvider(cfg: OpenAICompatibleConfig, deps: OpenAICompatibleDeps): TTSProvider {
  // Tolerates the SDK's `/v1` suffix and trailing slashes
  const base = () => normalizeBaseURL(cfg.baseURL);
  const authHeaders = (): Record<string, string> => ({
    ...(cfg.headers ?? {}),
    ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
  });
  const missingKey = () => cfg.keyRequired && !cfg.apiKey;
  const noKey = () => new SynthesisError('no-key', `${cfg.label} API key is not set`);

  /**
   * Whether this server has *proved* it cannot do PCM, by answering the MP3
   * request that followed its refusal. Only a successful fallback records it,
   * so a 400 about anything else — a voice id the server does not have is the
   * common one — cannot latch a server into MP3. It is kept until the app is
   * closed; another Address or Model is asked for PCM again.
   */
  const pcmRefusals = deps.pcmRefusals ?? sharedPcmRefusals;
  const server = () => `${cfg.id} ${base()} ${cfg.model}`;

  async function get(path: string, signal?: AbortSignal): Promise<Response> {
    try {
      return await deps.fetch(`${base()}${path}`, { headers: authHeaders(), signal });
    } catch (e) {
      throwIfAborted(signal, cfg.label);
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
      throwIfAborted(signal, cfg.label);
      throw new SynthesisError('network', String(e));
    }
  }

  /**
   * One synthesis on the speech route, which answers with the bytes.
   *
   * PCM is asked for first, because that is what the playback engine wants and
   * because it deletes the encoder padding that would otherwise be audible at
   * every sentence boundary (ADR 0013). But this route is spoken by *any*
   * server, and a self-hosted one may only emit MP3: a 400 or a 422 — the
   * statuses a server uses for a `response_format` it does not know, 422
   * being FastAPI's (the owner's Chatterbox, #65) — is asked again as MP3 and
   * reported as `encoded` bytes for the playback layer to decode. If that
   * second request fails too, the first refusal is what surfaces, since one
   * that is not about the format says something more useful.
   */
  async function speakOnSpeechRoute(text: string, voice: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const what = `${cfg.label} speech`;
    const ask = async (format: string): Promise<Response> => post('/v1/audio/speech', { model: cfg.model, voice, input: text, response_format: format }, signal);

    const refusesPcm = pcmRefusals.has(server());
    let response = refusesPcm ? await ask(FALLBACK_FORMAT) : await ask(PCM_FORMAT);
    let note = refusesPcm ? 'the server does not do PCM; asked for MP3' : '';

    if (!response.ok && !refusesPcm) {
      const refusal = refusalFrom(response.status, await responseErrorText(response, what, signal), what);
      if (!FORMAT_REFUSALS.includes(response.status)) throw refusal;
      const retry = await ask(FALLBACK_FORMAT);
      if (!retry.ok) throw refusal;
      pcmRefusals.add(server());
      response = retry;
      note = 'the server refused PCM; asked for MP3';
    }
    if (!response.ok) throw refusalFrom(response.status, await responseErrorText(response, what, signal), what);

    const clip = await responseAudio(response, what, signal);
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
    if (!response.ok) throw refusalFrom(response.status, await responseErrorText(response, what, signal), what);
    let reply: unknown;
    try {
      reply = await responseJSON(response, what, signal);
    } catch (error) {
      if (error instanceof SynthesisError) throw error;
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

  /**
   * The voices the server publishes on /v1/audio/voices (a common extension
   * of OpenAI-compatible servers — OpenAI itself answers 404), or null when
   * it publishes none: a 404 or a 405, or a reply with no voices in it. Any
   * other refusal is an error (ADR 0079).
   */
  async function publishedVoices(signal?: AbortSignal): Promise<VoiceInfo[] | null> {
    const response = await get('/v1/audio/voices', signal);
    if (response.ok) {
      let body: unknown = null;
      try {
        body = await responseJSON(response, `${base()}/v1/audio/voices`, signal);
      } catch (error) {
        if (error instanceof SynthesisError) throw error;
        // Not JSON: the route exists but is something else; fall through
      }
      const published = parseVoiceList(body);
      return published.length ? published.map((v) => ({ ...v, locale: MULTILINGUAL })) : null;
    }
    if (response.status !== 404 && response.status !== 405) {
      // A missing listing route permits documented names. A gateway failure
      // does not: caching those names would prevent the next open retrying.
      const what = `${base()}/v1/audio/voices`;
      if (response.status >= 500) throw new SynthesisError('network', `${what}: HTTP ${response.status}`);
      throw statusError(response.status, what);
    }
    return null;
  }

  /**
   * The model ids the server offers, or null when it publishes no model list:
   * a 404 or a 405 (Chatterbox-TTS-Server answers 404), or a reply that is not
   * JSON. A refused key is an error.
   */
  async function publishedModels(): Promise<string[] | null> {
    const url = `${base()}/v1/models`;
    const response = await get('/v1/models');
    if (response.status === 404 || response.status === 405) return null;
    if (!response.ok) throw statusError(response.status, url);
    try {
      return parseModelList(await responseJSON(response, url));
    } catch (error) {
      if (error instanceof SynthesisError) throw error;
      return null;
    }
  }

  /**
   * Whether the synthesis route is there, asked without asking it to speak
   * (#209, ADR 0026): a POST of `{}`, which carries no text, so nothing is
   * synthesized or billed. A server refuses a body missing `model`, `input` and
   * `voice` before it looks at any of them — FastAPI with 422, OpenAI with 400
   * — while a body naming a voice can be answered 404 by a real route
   * (Chatterbox-TTS-Server's, for a voice file it does not have). So a 404 or
   * a 405 here, or a web page, says there is no speech API at the Address.
   */
  async function synthesisRouteAnswers(): Promise<void> {
    const route = cfg.route === 'chat' ? '/v1/chat/completions' : '/v1/audio/speech';
    const response = await post(route, {});
    if (response.status === 401 || response.status === 403) throw statusError(response.status, `${base()}${route}`);
    const page = response.ok && /text\/html/i.test(response.headers.get('Content-Type') ?? '');
    if (response.status === 404 || response.status === 405 || page) {
      throw new SynthesisError('unknown', `${cfg.label}: nothing at ${base()} answers ${route} (HTTP ${response.status}${page ? ', a web page' : ''}). Check the Address.`);
    }
  }

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
      const published = await publishedVoices(options?.signal);
      return published ?? (cfg.defaultVoices ?? []).map((id) => ({ id, label: id, locale: MULTILINGUAL }));
    },

    /** The model ids the server offers, none when it publishes no list; the cheapest authenticated request the API has. */
    async listModels(): Promise<string[]> {
      if (missingKey()) throw noKey();
      return (await publishedModels()) ?? [];
    },

    /**
     * That an API is at the Address and takes the key, without synthesizing
     * (ADR 0026). A model list proves it, and a voice list of the server's own
     * does. A server that publishes neither (#209) has only the speech route,
     * or no speech API at all, and the documented voices `listVoices` would
     * then give say nothing about which: so the speech route is asked whether
     * it is there.
     */
    async checkConnection(): Promise<void> {
      if (missingKey()) throw noKey();
      if (await publishedModels()) return;
      if (await publishedVoices()) return;
      await synthesisRouteAnswers();
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
