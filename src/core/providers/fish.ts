import { alignWords, describeAlignment, type TimedWord } from '../align';
import { withTimeout } from '../timeout';
import { PCM_SAMPLE_RATE, base64ToBytes, concatBytes, readClip } from './audio';
import { SynthesisError } from './errors';
import { isSpeakable } from './speechify';
import { MULTILINGUAL, type ListVoicesOptions, type SynthesisOptions, type SynthesisResult, type TTSProvider, type VoiceInfo } from './types';

/**
 * Fish Audio's cloud API: S2.1 Pro over the route that returns word timings,
 * behind one key. Measured against the live API on 2026-09-10 (Zotero-TTS
 * `notes/NOTES_2026-09-10.md`):
 * - a voice is a model of the official library, an account's own model, or a
 *   model id the owner supplied; the three sources are independently optional,
 *   with the model's default voice included in the own-voices source;
 * - `POST /v1/tts/stream/with-timestamp` answers an event stream: one JSON
 *   per `data:` line with a base64 chunk of the audio and the latest
 *   alignment snapshot of a text chunk — words and digits in the text's own
 *   spelling, one segment per Chinese character, punctuation gone — to be
 *   replaced per `chunk_seq`, not appended, and moved by the chunk's offset;
 *   the words are aligned to the segment text by their text (`core/align.ts`);
 * - the model is an HTTP header, and a missing or unknown one falls back to
 *   the **paid** model, so a typo costs money and only the two names below are
 *   ever sent;
 * - the free model needs no API credit; the paid one on an empty credit is
 *   a 402 with `x-fish-error-code: insufficient_balance`, the quota shape;
 *   a wrong key is 401 on every route; a wrong id is 400 "Reference not
 *   found";
 * - eight requests at once answered 200, so nothing queues — Fish needs no
 *   equivalent of Speechify's serial queue; a 429 waits what Retry-After says
 *   and asks again;
 * - no per-request cap is documented and 1,483 characters went in one
 *   request, so an utterance is never split.
 *
 * ## Fish is the third provider with Word Timings over plain HTTP
 *
 * ADR 0005's table lists three: Speechify, Fish Audio and a self-hosted
 * Kokoro. Fish is the only one of the three that is a cloud service needing no
 * server of the owner's own, so its timing path is the one that has to be
 * right — `mergeEvents` below is where the words and the audio arrive
 * interleaved, and a snapshot merged wrongly is drift that looks plausible.
 *
 * ## What the port changed, and what it deliberately did not
 *
 * **The audio comes back `encoded`, as `audio/mpeg`, and cannot honestly be
 * `pcm` today.** ADR 0013 asks every provider for PCM where the protocol
 * allows it; Fish's does not allow it *usefully*. The body's `format` field
 * comes from the open-source `ServeTTSRequest` schema, which lists `pcm`, but
 * nothing in the reply names a sample rate: an event carries only
 * `audio_base64`, `content`, `chunk_seq`, `chunk_audio_offset_sec` and
 * `alignment`, and the response's own `Content-Type` is `text/event-stream`.
 * Fish publishes no output rate and none has been measured, so `pcm` would
 * have to be reported at `audio.ts`'s assumed 24 kHz — and a wrong rate is not
 * a decode error but **drift**: the playback clock of ADR 0012 is the samples
 * already consumed divided by the rate, and Fish's word times arrive in real
 * seconds, so the highlight would slide against audio that still sounds fine.
 * Reporting the MP3 that was asked for, and letting the playback layer decode
 * it, is the fallback ADR 0013 keeps for exactly this. `readClip` still makes
 * the decision — the bytes overrule the declaration, so a Fish that one day
 * answers a container says so.
 *
 * **No language hint.** The plugin prefixed the request text with
 * `[Speak in American English]` for utterances of one to three words, because
 * Fish's automatic language detection drifts on context-poor text (`100 exp`
 * read as "cn xp"). It is not ported: `src/core/fish-language-hint.ts` counts
 * words with `Intl.Segmenter`, which **this Hermes does not have**
 * (notes/NOTES_2026-09-19.md), so the function would return the empty string
 * on every call on the device while passing its tests under Node — and the
 * cue's own risk is this project's one forbidden failure, since a cue Fish
 * reads aloud shifts every reported time by the length of the cue. The locale
 * it needs is in the published voice id if a decision is ever recorded for it;
 * `SynthesisOptions` stays `{ voice, signal }`.
 *
 * **No speed, ever** (ADR 0009). Fish's body has no speed field and none is
 * being added.
 */
export type FishConfig = {
  apiKey: string;
  /** Every request goes to the free model; off, to the paid one. */
  freeOnly: boolean;
  /** What the owner pasted: ids or links, any separators. */
  voices: string;
  /** Include the Fish Official account's voices; omitted means enabled. */
  includeOfficial?: boolean;
  /** Include the account's own voices; omitted means enabled. */
  includeOwn?: boolean;
  /** Include models supplied in the Voices field; omitted means enabled. */
  includeManual?: boolean;
};

/**
 * What Fish takes beyond the contract's `fetch`.
 *
 * The plugin's `newAbortController` is **gone**: it existed because the Zotero
 * sandbox has no `AbortController` of its own and one had to be borrowed from a
 * chrome window. This engine has it — measured, notes/NOTES_2026-09-19.md — so
 * a shared load makes its own, and `ProviderDeps` stays `{ fetch }`.
 *
 * `wait`, `cache` and `timeoutMs` are not platform dependencies and never
 * reached the factory: each has a working default, and each exists so a test
 * can be fast, isolated and deterministic without stubbing a global.
 */
export type FishDeps = {
  fetch: typeof fetch;
  /** The pause before a retry; `setTimeout` when absent, nothing in the tests. */
  wait?: (ms: number) => Promise<void>;
  /** The session's voice cache; the module's shared one when absent, so providers built per call still share one listing. */
  cache?: FishVoiceCache;
  /** Override the listing bound in tests; production uses the eleven-second bound below. */
  timeoutMs?: number;
};

export const FISH_API = 'https://api.fish.audio';
/** The same model either way: the free one wants no API credit, the paid one bills per UTF-8 byte (docs, 2026-09-10). */
export const MODEL_FREE = 's2.1-pro-free';
export const MODEL_PAID = 's2.1-pro';
/** What is asked for, and what the bytes are therefore declared as. Not `pcm`: see the note on the contract at the top of this file. */
export const FISH_FORMAT = 'mp3';
export const FISH_MEDIA_TYPE = 'audio/mpeg';
/** Half the bytes of the 128 kbps default, at the same latency (measured 2026-09-10). */
export const MP3_BITRATE = 64;
/** The most the list route gives per page (422 above it). */
export const PAGE_SIZE = 100;
const MAX_PAGES = 20;
/** The stable Fish Official account whose models are automatically offered. */
export const OFFICIAL_AUTHOR_ID = 'd8b0991f96b44e489422ca2ddf0bd31d';
/** A complete listing, including response-body parsing, must answer well inside the caller's own bound. */
export const FISH_VOICE_LIST_TIMEOUT_MS = 11_000;
/** The id of the built-in entry that sends no reference: the model's own voice. */
export const DEFAULT_VOICE = 'default';
export const DEFAULT_VOICE_LABEL = 'Default';
/** The pause before a 5xx is asked again, as Speechify's. */
export const RETRY_DELAY_MS = 500;
/** How many times a 429 is waited out before it surfaces. */
export const RATE_LIMIT_RETRIES = 3;
const RETRY_AFTER_DEFAULT_MS = 1000;
const RETRY_AFTER_MAX_MS = 5000;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const MODEL_ID = /[0-9a-f]{32}/gi;
const ONE_MODEL_ID = /^[0-9a-f]{32}$/i;

/** A value that has been loaded, or a load every caller of this account shares. */
type CacheSlot<T> = { value?: T; inFlight?: Promise<T> };

/**
 * Session-only Fish voice data, keyed by account.
 *
 * Fish's listing is four to five requests — the official author's ~338 models
 * are four pages of 100, the account's own models another, and each pasted id
 * one more — and the settings sheet asks for it every time it opens. The cache
 * is what stops that being paid for repeatedly in latency.
 *
 * It holds no API key of its own; the map keys are the account, in memory, for
 * as long as the process lives. The plugin also counted hits and loads for a
 * Zotero diagnostics panel, which has no equivalent here, so the counters and
 * `getFishVoiceCacheStats` have not come across.
 */
export class FishVoiceCache {
  readonly official = new Map<string, CacheSlot<VoiceInfo[]>>();
  readonly own = new Map<string, CacheSlot<VoiceInfo[]>>();
  readonly pasted = new Map<string, Map<string, VoiceInfo>>();
  readonly pastedInFlight = new Map<string, Map<string, Promise<VoiceInfo>>>();
}

/**
 * The cache of the running app: one per module, whatever the number of
 * provider instances — the same arrangement as `speechify.ts`'s `sharedQueue`,
 * and the reason Fish needs nothing added to `ProviderDeps`. A test injects its
 * own and stays isolated.
 */
export const sharedVoiceCache = new FishVoiceCache();

/** Every 32-hex id in what was pasted — ids, links such as `https://fish.audio/m/<id>/`, any separators — once each, lowercased. */
export function fishVoiceIds(text: string): string[] {
  return [...new Set((text.match(MODEL_ID) ?? []).map((id) => id.toLowerCase()))];
}

const LANGUAGE = /^[a-z]{2,3}$/i;

type EnglishRegion = { locale: string; labels: readonly RegExp[] };

/** Regions that Fish Audio publishes explicitly in a model's labels or tags. */
const ENGLISH_REGIONS: readonly EnglishRegion[] = [
  {
    locale: 'en-US',
    labels: [
      /\ben[-_](?:us|usa)\b/i,
      /\b(?:american|united states)(?:\s+english)?\b/i,
      /\b(?:u\.?\s*s\.?|us)[ -]?(?:male|female|english|voice|narrator|storyteller|companion)\b/i,
    ],
  },
  {
    locale: 'en-GB',
    labels: [
      /\ben[-_](?:gb|uk)\b/i,
      /\b(?:british|united kingdom)(?:\s+english)?\b/i,
      /\b(?:u\.?\s*k\.?|uk)[ -]?(?:male|female|english|voice|narrator|storyteller|companion)\b/i,
    ],
  },
  {
    locale: 'en-CA',
    labels: [/\ben[-_]ca\b/i, /\bcanadian(?:\s+english)?\b/i, /\bcanada(?:\s+english)?\b/i],
  },
  {
    locale: 'en-AU',
    labels: [/\ben[-_]au\b/i, /\baustralian(?:\s+english)?\b/i, /\baustralia(?:n)?(?:\s+english)?\b/i],
  },
  {
    locale: 'en-IN',
    labels: [/\ben[-_]in\b/i, /\bindian(?:\s+english)?\b/i, /\bindia(?:n)?(?:\s+english)?\b/i],
  },
  {
    locale: 'en-NG',
    labels: [/\ben[-_]ng\b/i, /\bnigerian(?:\s+english)?\b/i, /\bnigeria(?:n)?(?:\s+english)?\b/i],
  },
  {
    locale: 'en-ZA',
    labels: [/\ben[-_]za\b/i, /\bsouth african(?:\s+english)?\b/i, /\bsouth africa(?:n)?(?:\s+english)?\b/i],
  },
  {
    locale: 'en-NZ',
    labels: [/\ben[-_]nz\b/i, /\bnew zealand(?:\s+english)?\b/i],
  },
  {
    locale: 'en-IE',
    labels: [/\ben[-_]ie\b/i, /\birish(?:\s+english)?\b/i, /\bireland(?:\s+english)?\b/i],
  },
  {
    locale: 'en-SG',
    labels: [/\ben[-_]sg\b/i, /\bsingaporean(?:\s+english)?\b/i, /\bsingapore(?:\s+english)?\b/i],
  },
];

const ENGLISH_REGION_CODES: ReadonlyMap<string, string> = new Map([
  ['us', 'en-US'],
  ['usa', 'en-US'],
  ['gb', 'en-GB'],
  ['uk', 'en-GB'],
  ['ca', 'en-CA'],
  ['au', 'en-AU'],
  ['in', 'en-IN'],
  ['ng', 'en-NG'],
  ['za', 'en-ZA'],
  ['nz', 'en-NZ'],
  ['ie', 'en-IE'],
  ['sg', 'en-SG'],
  ['jm', 'en-JM'],
  ['ke', 'en-KE'],
  ['ph', 'en-PH'],
  ['tt', 'en-TT'],
]);

function englishRegionFromText(values: readonly string[]): string | undefined {
  const matches = new Set<string>();
  for (const value of values) {
    const tagRegion = /^en[-_]/i.test(value.trim()) ? englishRegionCode(value) : undefined;
    if (tagRegion) matches.add(tagRegion);
    for (const region of ENGLISH_REGIONS) {
      if (region.labels.some((label) => label.test(value))) matches.add(region.locale);
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

function englishRegionCode(value: string): string | undefined {
  const code = value.trim().replace(/^en[-_]/i, '').toLowerCase();
  return ENGLISH_REGION_CODES.get(code);
}

/** The locale a voice is filed under: its one language (a two-letter code, BCP-47 as it is), or the multilingual group for several or none. */
export function localeOfLanguages(languages: unknown): string {
  if (!Array.isArray(languages)) return MULTILINGUAL;
  const codes = languages.filter((code): code is string => typeof code === 'string' && LANGUAGE.test(code.trim()));
  return codes.length === 1 ? codes[0].trim().toLowerCase() : MULTILINGUAL;
}

/** A model as `GET /model` and `GET /model/{id}` describe it; the fields that are read. */
export type FishModel = {
  _id?: unknown;
  title?: unknown;
  languages?: unknown;
  tags?: unknown;
  description?: unknown;
  type?: unknown;
  state?: unknown;
  dmca_taken_down?: unknown;
};

/** The voice a model is listed as: its grouping locale may include a published English region, while the id keeps the stable base-language prefix. */
export function fishVoice(model: FishModel): VoiceInfo | null {
  const id = str(model._id);
  if (!id) return null;
  // Keep the id's prefix even for language tags this code does not recognise:
  // the display group must not decide whether a saved Voice still resolves.
  const languageLocale = localeOfLanguages(model.languages);
  const languages = Array.isArray(model.languages) ? model.languages : [];
  const explicitEnglish =
    languages.length === 1 && typeof languages[0] === 'string' && /^en[-_]/i.test(languages[0].trim()) ? englishRegionCode(languages[0]) : undefined;
  const tags = Array.isArray(model.tags) ? model.tags.filter((tag): tag is string => typeof tag === 'string') : [];
  const labels = [str(model.title), ...tags];
  // Multiple supported languages do not erase an explicitly labelled English
  // voice. A region alone is insufficient: an Indian multilingual voice need
  // not be an English voice. Never use the description's audience as evidence.
  const labelledEnglish = labels.some((label) => /\benglish\b|\ben(?:[-_][a-z]{2,3})?\b/i.test(label));
  const english = languageLocale === 'en' || (languageLocale === MULTILINGUAL && labelledEnglish);
  const locale = explicitEnglish ?? (english ? englishRegionFromText(labels) : undefined) ?? languageLocale;
  return { id: `${languageLocale}/${id}`, label: str(model.title) || id, locale };
}

/** The official list can contain service entries or models withdrawn from the library; only explicit incompatibilities are filtered. */
function publicFishVoice(model: FishModel): VoiceInfo | null {
  const id = str(model._id);
  if (!ONE_MODEL_ID.test(id)) return null;
  if (typeof model.type === 'string' && model.type && model.type !== 'tts') return null;
  if (typeof model.state === 'string' && model.state && model.state !== 'trained') return null;
  if (model.dmca_taken_down === true) return null;
  return fishVoice(model);
}

const LOCALE = /^(?:mul|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)$/;

/** A published voice id back into its locale and model id; null for anything this provider did not publish. */
export function decodeFishVoice(encoded: string): { locale: string; id: string } | null {
  const at = encoded.indexOf('/');
  if (at < 1) return null;
  const locale = encoded.slice(0, at);
  const id = encoded.slice(at + 1);
  if (!LOCALE.test(locale)) return null;
  if (id !== DEFAULT_VOICE && !ONE_MODEL_ID.test(id)) return null;
  return { locale, id };
}

/** One event of the timestamp route, as its `data:` line decodes; the fields that are read. */
export type FishEvent = { audio_base64?: unknown; content?: unknown; chunk_seq?: unknown; chunk_audio_offset_sec?: unknown; alignment?: unknown };

/**
 * The JSON of every `data:` line of an event stream; comments, other fields
 * and lines that are not JSON are skipped.
 *
 * Each `data:` line is parsed on its own, which is what Fish sends. A stream
 * whose newlines are literal backslash-n — what a hand-written stub produces —
 * therefore yields no events at all rather than half of one, and `speak`
 * reports that the stream carried no audio.
 */
export function parseEventStream(body: string): FishEvent[] {
  const events: FishEvent[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(5).trim());
      if (parsed && typeof parsed === 'object') events.push(parsed as FishEvent);
    } catch {
      // Not JSON: skipped
    }
  }
  return events;
}

export type MergedStream = {
  audio: Uint8Array<ArrayBuffer>;
  /** On the whole audio's timeline: each chunk's snapshot moved by its offset. */
  words: TimedWord[];
  /** How many text chunks the route cut the text into. */
  chunks: number;
};

/**
 * The stream as one audio and one word list: the audio chunks concatenated
 * in arrival order; per text chunk the latest snapshot — a later non-null
 * `alignment` **replaces** it, a null one changes nothing — with its segments
 * moved by that snapshot's own `chunk_audio_offset_sec`. Throws on audio that
 * is not base64.
 *
 * Three properties carry the whole word-timing path, and each is one line
 * here and a drift if it is wrong. *Replaces*, because a snapshot is
 * cumulative within its chunk, so appending would emit every word of a chunk
 * as many times as the chunk was reported. *Its own* offset, because the
 * offset travels with the snapshot and is not accumulated here — the route
 * already reports it against the start of the whole audio. And *sorted by
 * `chunk_seq`*, not by arrival, because the words have to come out in the
 * order the audio plays them for the aligner to pair them against the text.
 */
export function mergeEvents(events: FishEvent[]): MergedStream {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const snapshots = new Map<number, { offset: number; segments: unknown[] }>();
  const seen = new Set<number>();
  for (const event of events) {
    if (typeof event.audio_base64 === 'string' && event.audio_base64) chunks.push(base64ToBytes(event.audio_base64));
    const seq = typeof event.chunk_seq === 'number' && Number.isFinite(event.chunk_seq) ? event.chunk_seq : 0;
    seen.add(seq);
    const alignment = event.alignment as { segments?: unknown } | null | undefined;
    if (!alignment || typeof alignment !== 'object' || !Array.isArray(alignment.segments)) continue;
    const offset = typeof event.chunk_audio_offset_sec === 'number' && Number.isFinite(event.chunk_audio_offset_sec) ? event.chunk_audio_offset_sec : 0;
    snapshots.set(seq, { offset, segments: alignment.segments });
  }
  const words: TimedWord[] = [];
  for (const seq of [...snapshots.keys()].sort((a, b) => a - b)) {
    const { offset, segments } = snapshots.get(seq)!;
    for (const segment of segments) {
      const { text, start, end } = (segment ?? {}) as { text?: unknown; start?: unknown; end?: unknown };
      if (typeof text !== 'string' || !text || typeof start !== 'number' || typeof end !== 'number') continue;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
      words.push({ text, start: start + offset, end: end + offset });
    }
  }
  return { audio: concatBytes(chunks), words, chunks: seen.size };
}

/** What a refusal says, from Fish's `{ status, message }`; empty for any other body. Whitespace collapsed. */
export function fishReason(body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown } | null;
    return str(parsed?.message).replace(/\s+/g, ' ').slice(0, 300);
  } catch {
    return '';
  }
}

/** Whether a refusal is the API credit: a 402, or the gateway's header on any status (measured 2026-09-10). */
function isQuota(status: number, headers: Headers): boolean {
  return status === 402 || headers.get('x-fish-error-code') === 'insufficient_balance';
}

function refusal(response: Response, body: string, what: string): SynthesisError {
  const status = response.status;
  // The list's 401 is plain text ("No permission -- see authorization schemes"), the rest is JSON
  const message = fishReason(body) || body.trim().replace(/\s+/g, ' ').slice(0, 200);
  const quoted = message ? ` — ${message}` : '';
  if (isQuota(status, response.headers)) return new SynthesisError('quota', `${what}: Fish Audio refused the request (${status})${quoted}`);
  if (status === 401 || status === 403) return new SynthesisError('auth', `${what}: Fish Audio rejected the API key (${status})${quoted}`);
  if (status === 429) return new SynthesisError('rate-limit', `${what}: rate limited (429)${quoted}`);
  return new SynthesisError('unknown', `${what}: HTTP ${status}${quoted}`);
}

/** How long a 429 asks to wait: its Retry-After in seconds, a second without one, five at most. */
function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After') ?? '');
  if (!Number.isFinite(seconds) || seconds <= 0) return RETRY_AFTER_DEFAULT_MS;
  return Math.min(RETRY_AFTER_MAX_MS, Math.round(seconds * 1000));
}

const OWN_WHAT = 'Fish Audio voice list';
const OFFICIAL_WHAT = 'Fish Audio official voice list';

export function createFishProvider(cfg: FishConfig, deps: FishDeps): TTSProvider {
  const apiKey = () => cfg.apiKey.trim();
  const model = () => (cfg.freeOnly ? MODEL_FREE : MODEL_PAID);
  const pause = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers = (extra: Record<string, string> = {}, key = apiKey()): Record<string, string> => ({ Authorization: `Bearer ${key}`, ...extra });
  const cache = deps.cache ?? sharedVoiceCache;
  const listTimeoutMs = deps.timeoutMs ?? FISH_VOICE_LIST_TIMEOUT_MS;

  function requireKey(): void {
    if (!apiKey()) throw new SynthesisError('no-key', 'Fish Audio API key is not set');
  }

  async function request(path: string, init: RequestInit, what: string): Promise<Response> {
    try {
      return await deps.fetch(`${FISH_API}${path}`, init);
    } catch (e) {
      throw new SynthesisError('network', `${what}: cannot reach api.fish.audio (${e})`);
    }
  }

  /**
   * One request with the two retries: a 429 waits what Retry-After says
   * and asks again, up to RATE_LIMIT_RETRIES times, unless it is the
   * credit; a 5xx is asked once more after RETRY_DELAY_MS. The note says
   * what happened, for the debug line — the only place a live run can see a
   * retry.
   */
  async function exchange(path: string, init: RequestInit, what: string, deadline = Number.POSITIVE_INFINITY): Promise<{ response: Response; note: string }> {
    let waits = 0;
    let retried = '';
    for (;;) {
      if (Date.now() >= deadline) throw new SynthesisError('network', `${what}: no reply within the listing time limit`);
      const response = await request(path, init, what);
      if (response.ok) {
        const waited = waits ? ` after ${waits} rate-limit wait${waits === 1 ? '' : 's'}` : '';
        return { response, note: `${retried}${waited}` };
      }
      const body = await response.text().catch(() => '');
      if (response.status === 429 && waits < RATE_LIMIT_RETRIES && !isQuota(429, response.headers)) {
        waits++;
        const waitMs = retryAfterMs(response);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new SynthesisError('network', `${what}: no reply within the listing time limit`);
        if (Number.isFinite(deadline)) await withTimeout(pause(waitMs), remaining, () => new SynthesisError('network', `${what}: no reply within the listing time limit`));
        else await pause(waitMs);
        continue;
      }
      if (response.status >= 500 && !retried) {
        retried = ` after a retry of HTTP ${response.status}`;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new SynthesisError('network', `${what}: no reply within the listing time limit`);
        if (Number.isFinite(deadline)) await withTimeout(pause(RETRY_DELAY_MS), remaining, () => new SynthesisError('network', `${what}: no reply within the listing time limit`));
        else await pause(RETRY_DELAY_MS);
        continue;
      }
      throw refusal(response, body, what);
    }
  }

  async function readJSON<T>(response: Response, what: string): Promise<T> {
    try {
      return (await response.json()) as T;
    } catch {
      throw new SynthesisError('unknown', `${what}: the reply was not JSON`);
    }
  }

  /**
   * The fields of a model list that are read. The plugin also read
   * `window_limited`, `total_is_exact`, `max_offset` and
   * `accessible_upper_bound`, to tell the pane that the library's 1,000-entry
   * query window had cut the list short. There is no status line to tell here
   * — `TTSProvider` has no `voiceListNotices` — so a flag nothing can report
   * is not computed.
   */
  type ModelListReply = { items?: unknown; has_more?: unknown; total?: unknown };

  const authFailure = (error: unknown): boolean => error instanceof SynthesisError && error.kind === 'auth';

  function abortedError(what: string): SynthesisError {
    return new SynthesisError('network', `${what}: aborted`);
  }

  function lateError(what: string): SynthesisError {
    return new SynthesisError('network', `${what}: no reply within ${Math.round(listTimeoutMs / 1000)} s`);
  }

  /**
   * Let one caller stop waiting while the shared request continues for other
   * callers. The plugin also tolerated a signal with no `addEventListener`,
   * for stand-ins the Zotero chrome handed it; every `AbortSignal` here is the
   * engine's own (measured, notes/NOTES_2026-09-19.md), so the guard is gone.
   */
  function forCaller<T>(promise: Promise<T>, signal: AbortSignal | undefined, what: string): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortedError(what));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(abortedError(what));
      };
      const cleanup = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  }

  /**
   * One load per account, shared by every caller, with the listing's bound on
   * the load itself rather than on the caller: a caller may stop waiting
   * sooner, but a request that never settles must not stay in flight and
   * poison every later listing. That is what the `inFlight` clearing in the
   * failure path is for, and it is why a timed-out listing recovers by itself
   * on the next attempt.
   *
   * The plugin's `refresh` generation counter is gone with `refresh` itself:
   * `ListVoicesOptions` here is `{ signal?: AbortSignal }`, so there is no
   * request that supersedes another and no older result to suppress.
   */
  function cached<T>(map: Map<string, CacheSlot<T>>, key: string, load: (deadline: number, signal: AbortSignal) => Promise<T>, what: string, deadline: number): Promise<T> {
    let slot = map.get(key);
    if (!slot) {
      slot = {};
      map.set(key, slot);
    }
    if (slot.value !== undefined) return Promise.resolve(slot.value);
    if (slot.inFlight) return slot.inFlight;
    const held = slot;
    const controller = new AbortController();
    const promise = withTimeout(load(deadline, controller.signal), Math.max(0, deadline - Date.now()), () => lateError(what), () => controller.abort()).then(
      (value) => {
        held.value = value;
        held.inFlight = undefined;
        return value;
      },
      (error) => {
        held.inFlight = undefined;
        throw error;
      },
    );
    slot.inFlight = promise;
    return promise;
  }

  /** Number of pages worth asking for after the first page exposes its total. */
  function pagesFor(reply: ModelListReply, maxPages: number): number {
    if (reply.has_more !== true) return 1;
    const totalPages = typeof reply.total === 'number' && Number.isFinite(reply.total) && reply.total > 0 ? Math.ceil(reply.total / PAGE_SIZE) : maxPages;
    return Math.min(maxPages, Math.max(2, totalPages));
  }

  function modelId(voice: VoiceInfo): string {
    const decoded = decodeFishVoice(voice.id);
    if (decoded) return decoded.id.toLowerCase();
    const slash = voice.id.indexOf('/');
    return (slash >= 0 ? voice.id.slice(slash + 1) : voice.id).toLowerCase();
  }

  function mergeVoices(...groups: readonly VoiceInfo[][]): VoiceInfo[] {
    const seen = new Set<string>();
    const out: VoiceInfo[] = [];
    for (const group of groups) {
      for (const voice of group) {
        const id = modelId(voice);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(voice);
      }
    }
    return out;
  }

  /** Every page of one model list, the pages after the first concurrently, deduplicated by raw model id. */
  async function modelPages(path: (page: number) => string, read: (model: FishModel) => VoiceInfo | null, what: string, signal: AbortSignal | undefined, key: string, deadline: number): Promise<VoiceInfo[]> {
    const readPage = async (page: number): Promise<{ reply: ModelListReply; voices: VoiceInfo[] }> => {
      const { response } = await exchange(path(page), { headers: headers({}, key), ...(signal ? { signal } : {}) }, what, deadline);
      const reply = await readJSON<ModelListReply>(response, what);
      if (!Array.isArray(reply?.items)) throw new SynthesisError('unknown', `${what}: the reply was not a model list`);
      return { reply, voices: mergeVoices(reply.items.map((item) => read(item as FishModel)).filter((voice): voice is VoiceInfo => voice !== null)) };
    };
    const first = await readPage(1);
    const rest = await Promise.all(Array.from({ length: pagesFor(first.reply, MAX_PAGES) - 1 }, (_, index) => readPage(index + 2)));
    return mergeVoices([first, ...rest].flatMap((page) => page.voices));
  }

  /** Every page of the account's own models. An authenticated request, so a wrong key fails here. */
  const ownVoices = (signal: AbortSignal | undefined, key: string, deadline: number): Promise<VoiceInfo[]> =>
    modelPages((page) => `/model?self=true&page_size=${PAGE_SIZE}&page_number=${page}`, fishVoice, OWN_WHAT, signal, key, deadline);

  /** Every page in the official account's list. The whole pagination operation is bounded by the caller. */
  const officialVoices = (signal: AbortSignal | undefined, key: string, deadline: number): Promise<VoiceInfo[]> =>
    modelPages((page) => `/model?author_id=${OFFICIAL_AUTHOR_ID}&page_size=${PAGE_SIZE}&page_number=${page}`, publicFishVoice, OFFICIAL_WHAT, signal, key, deadline);

  /** A pasted id by the public model route: its title and language, or, for an id the library does not know, the id marked as not found. */
  async function pastedVoice(id: string, signal: AbortSignal | undefined, key: string): Promise<VoiceInfo> {
    const what = `Fish Audio voice ${id}`;
    const response = await request(`/model/${id}`, { headers: headers({}, key), ...(signal ? { signal } : {}) }, what);
    if (response.status === 404) return { id: `${MULTILINGUAL}/${id}`, label: `${id} (not found)`, locale: MULTILINGUAL };
    if (!response.ok) throw refusal(response, await response.text().catch(() => ''), what);
    return fishVoice(await readJSON<FishModel>(response, what)) ?? { id: `${MULTILINGUAL}/${id}`, label: id, locale: MULTILINGUAL };
  }

  /**
   * One lookup per pasted id per account, shared and remembered. The deadline
   * bounds network work, not already-resolved metadata: a slow official
   * refresh must not drop a manual voice that is already known.
   */
  function sharedPastedRequest(id: string, deadline: number): Promise<VoiceInfo> {
    const account = apiKey();
    const what = `Fish Audio voice ${id}`;
    let values = cache.pasted.get(account);
    if (!values) {
      values = new Map<string, VoiceInfo>();
      cache.pasted.set(account, values);
    }
    const existing = values.get(id);
    if (existing) return Promise.resolve(existing);
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining <= 0) return Promise.reject(lateError(what));
    let pending = cache.pastedInFlight.get(account);
    if (!pending) {
      pending = new Map<string, Promise<VoiceInfo>>();
      cache.pastedInFlight.set(account, pending);
    }
    const active = pending.get(id);
    if (active) return active;
    const known = values;
    const inFlight = pending;
    const controller = new AbortController();
    const promise = withTimeout(pastedVoice(id, controller.signal, account), remaining, () => lateError(what), () => controller.abort()).then(
      (voice) => {
        known.set(id, voice);
        inFlight.delete(id);
        return voice;
      },
      (error) => {
        inFlight.delete(id);
        throw error;
      },
    );
    pending.set(id, promise);
    return promise;
  }

  async function speak(text: string, voice: string, signal?: AbortSignal): Promise<SynthesisResult> {
    requireKey();
    const decoded = decodeFishVoice(voice);
    if (!decoded) throw new SynthesisError('unknown', `Unknown Fish Audio voice: ${voice}`);
    // Nothing to say: no request, and no samples, which plays as a pause
    if (!isSpeakable(text)) return { audio: 'pcm', samples: new Uint8Array(0), sampleRate: PCM_SAMPLE_RATE, note: 'no speakable text' };
    const what = `Fish Audio ${model()}`;
    // No speed and no language cue: the text is the utterance, exactly, so the
    // words the stream reports are the words of the text the aligner is given.
    const body = { text, format: FISH_FORMAT, mp3_bitrate: MP3_BITRATE, latency: 'normal', ...(decoded.id === DEFAULT_VOICE ? {} : { reference_id: decoded.id }) };
    const init: RequestInit = { method: 'POST', headers: headers({ 'Content-Type': 'application/json', model: model() }), body: JSON.stringify(body), signal };
    const { response, note } = await exchange('/v1/tts/stream/with-timestamp', init, what);
    const events = parseEventStream(await response.text());
    let merged: MergedStream;
    try {
      merged = mergeEvents(events);
    } catch (e) {
      throw new SynthesisError('decode-failed', `${what}: the audio was not valid base64 (${e})`);
    }
    if (!merged.audio.length) throw new SynthesisError('unknown', `${what}: the stream carried no audio`);
    // The audio arrived inside JSON, so the reply's own Content-Type says
    // `text/event-stream` and nothing about the samples. What is declared here
    // is what was asked for, and `readClip` lets the bytes overrule it.
    const clip = readClip(merged.audio, FISH_MEDIA_TYPE);
    const chunks = merged.chunks > 1 ? `, ${merged.chunks} chunks` : '';
    if (!merged.words.length) return { ...clip, note: `${model()}${chunks}${note}: no word timings in the stream` };
    // The stream reports words in the text's own spelling with the punctuation
    // gone, and its character offsets are not trusted at all: the aligner pairs
    // by token and reports how much it had to bridge (ADR 0005).
    const aligned = alignWords(merged.words, text);
    if (!aligned.timestamps.length) return { ...clip, note: `${model()}${chunks}${note}: none of the ${merged.words.length} words the server returned is in the text` };
    const detail = describeAlignment(aligned);
    return { ...clip, timestamps: aligned.timestamps, note: `${model()}${chunks}${detail ? `, ${detail}` : ''}${note}` };
  }

  type Attempt<T> = { value?: T; error?: unknown };

  /** A shared load's result either way: it already carries the listing bound, so only the caller's own signal is added. */
  async function attemptShared<T>(promise: Promise<T>, signal: AbortSignal | undefined, what: string): Promise<Attempt<T>> {
    try {
      return { value: await forCaller(promise, signal, what) };
    } catch (error) {
      return { error };
    }
  }

  const nothing = (): Promise<Attempt<VoiceInfo[]>> => Promise.resolve({});

  const provider: TTSProvider = {
    id: 'fish',
    // Every reply of the timestamp route carries the words' seconds (measured 2026-09-10); never estimated
    capabilities: { wordTimestamps: true },

    /**
     * The enabled official, own and manual voices. The model's default voice
     * belongs to the own-voices source.
     *
     * The three sources are independent and are started together, so one slow
     * list does not serialize behind another. A source that fails is left out
     * rather than failing the listing — except for two cases that are never
     * silent. A refused key (401/403) rejects immediately, because every
     * source would refuse for the same reason and the owner needs to fix the
     * key, not read a short list. And a listing that found **nothing** but its
     * own `Default` entry rejects with the first failure: the plugin answered
     * `[Default]` and put "the list may be stale" in a status line beside it,
     * and there is no such line here, so a one-voice catalogue would be the
     * only thing the owner saw of a server that is down.
     */
    async listVoices(options?: ListVoicesOptions): Promise<VoiceInfo[]> {
      requireKey();
      const signal = options?.signal;
      if (signal?.aborted) throw abortedError(OWN_WHAT);
      const account = apiKey();
      const deadline = Date.now() + listTimeoutMs;
      const includeOfficial = cfg.includeOfficial !== false;
      const includeOwn = cfg.includeOwn !== false;
      const includeManual = cfg.includeManual !== false;

      // Start the selected lists before awaiting either. The requests
      // deliberately do not receive the caller's signal: `forCaller` cancels
      // only this listing's wait, leaving the shared load useful to everyone
      // else who asked for it.
      const officialLoad = includeOfficial
        ? cached(cache.official, account, (loadDeadline, loadSignal) => officialVoices(loadSignal, account, loadDeadline), OFFICIAL_WHAT, deadline)
        : null;
      const ownLoad = includeOwn ? cached(cache.own, account, (loadDeadline, loadSignal) => ownVoices(loadSignal, account, loadDeadline), OWN_WHAT, deadline) : null;
      const [official, own] = await Promise.all([
        officialLoad ? attemptShared(officialLoad, signal, OFFICIAL_WHAT) : nothing(),
        ownLoad ? attemptShared(ownLoad, signal, OWN_WHAT) : nothing(),
      ]);

      const failures: unknown[] = [official.error, own.error].filter((error) => error !== undefined);
      const authError = failures.find(authFailure);
      if (authError) throw authError;
      if (signal?.aborted) throw abortedError(OWN_WHAT);

      const officialList = official.value ?? [];
      const ownList = own.value ?? [];
      const known = new Set([...officialList, ...ownList].map(modelId));
      const ids = includeManual ? fishVoiceIds(cfg.voices).filter((id) => !known.has(id)) : [];
      const pastedResults = await Promise.all(ids.map((id) => attemptShared(sharedPastedRequest(id, deadline), signal, `Fish Audio voice ${id}`)));
      const pastedList: VoiceInfo[] = [];
      for (const result of pastedResults) {
        if (result.value) pastedList.push(result.value);
        if (result.error !== undefined) {
          if (authFailure(result.error)) throw result.error;
          failures.push(result.error);
        }
      }
      if (signal?.aborted) throw abortedError(OWN_WHAT);

      if (!officialList.length && !ownList.length && !pastedList.length && failures.length) {
        const first = failures[0];
        throw first instanceof Error ? first : new SynthesisError('unknown', `${OWN_WHAT}: ${String(first)}`);
      }
      // Default is a local entry in Your voices, including an account with no
      // models of its own. Disabling that source hides it without changing its id.
      const defaults: VoiceInfo[] = includeOwn ? [{ id: `${MULTILINGUAL}/${DEFAULT_VOICE}`, label: DEFAULT_VOICE_LABEL, locale: MULTILINGUAL }] : [];
      return mergeVoices(officialList, ownList, pastedList, defaults);
    },

    /** The cheapest authenticated request there is: one entry of the own-voices list. */
    async checkConnection(): Promise<void> {
      requireKey();
      const what = 'Fish Audio key check';
      const response = await request('/model?self=true&page_size=1', { headers: headers() }, what);
      if (!response.ok) throw refusal(response, await response.text().catch(() => ''), what);
    },

    /** Two letters on the voice, discarded: proves the model answers — and, with the free switch off, that the credit is there. */
    async checkSynthesis(voice: string): Promise<void> {
      await speak('Hi', voice);
    },

    synthesize(text: string, o: SynthesisOptions): Promise<SynthesisResult> {
      return speak(text, o.voice, o.signal);
    },
  };
  return provider;
}
