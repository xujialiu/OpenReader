import { describe, expect, it, vi } from 'vitest';
import { PCM_SAMPLE_RATE } from '../../../src/core/providers/audio';
import {
  DEFAULT_VOICE,
  FISH_API,
  FISH_MEDIA_TYPE,
  FishVoiceCache,
  MODEL_FREE,
  MODEL_PAID,
  MP3_BITRATE,
  OFFICIAL_AUTHOR_ID,
  PAGE_SIZE,
  RATE_LIMIT_RETRIES,
  RETRY_DELAY_MS,
  createFishProvider,
  decodeFishVoice,
  fishReason,
  fishVoice,
  fishVoiceIds,
  localeOfLanguages,
  mergeEvents,
  parseEventStream,
  type FishConfig,
  type FishDeps,
} from '../../../src/core/providers/fish';

/**
 * The plugin's `test/core/providers/fish.test.ts`, adapted to the contract of
 * ADR 0013 and to what this repo's `TTSProvider` actually has.
 *
 * Three groups of its tests changed rather than being dropped:
 *
 * - **the result is not a `Blob`.** Every audio assertion reads the union of
 *   `types.ts`. Fish's arm is `encoded`, `audio/mpeg` — see the note at the top
 *   of `fish.ts` for why it cannot honestly be `pcm` — and three new tests
 *   prove that `readClip` still lets the *bytes* overrule that declaration.
 * - **there is no `refresh` and there are no voice-list notices.**
 *   `ListVoicesOptions` here is `{ signal?: AbortSignal }` and `TTSProvider`
 *   has no `voiceListNotices`, so the tests that asserted a `stale` or
 *   `limited` line now assert the one behaviour that replaces them: a listing
 *   that found nothing but its own `Default` entry reports why.
 * - **there is no `newAbortController`.** This engine has `AbortController`
 *   (measured, notes/NOTES_2026-09-19.md), so the shared load makes its own and
 *   the test asserts what the plugin's injected one was for: the caller's
 *   signal never reaches `fetch`, and the transport is aborted when the
 *   listing's own bound fires.
 *
 * Nothing here stubs a global. `test/setup.ts` makes global `fetch` throw, and
 * every provider below is handed a fake one.
 */

const cfg: FishConfig = { apiKey: 'sk-fish-test', freeOnly: true, voices: '' };

/** Every wait is skipped in the tests; `waits` keeps what was asked for. */
let waits: number[] = [];
/**
 * A cache of its own unless the test asks otherwise: the production default is
 * the module's shared one (`sharedVoiceCache`), which would otherwise carry one
 * test's listing into the next.
 */
function provider(fetchImpl: unknown, over: Partial<FishConfig> = {}, deps: Partial<FishDeps> = {}) {
  return createFishProvider({ ...cfg, ...over }, { fetch: fetchImpl as typeof fetch, wait: async (ms) => void waits.push(ms), cache: new FishVoiceCache(), ...deps });
}

/** A cache that already holds these voices, as a listing or a lookup would have left it, keyed by the test key's account. */
function knowing(...voices: { id: string; label: string; locale: string }[]): FishVoiceCache {
  const cache = new FishVoiceCache();
  cache.pasted.set(cfg.apiKey, new Map(voices.map((voice) => [voice.id.slice(voice.id.indexOf('/') + 1), voice])));
  return cache;
}

/** The synthesis tests' provider: one whose session already knows the narrator, so nothing is looked up. */
function speaker(fetchImpl: unknown, over: Partial<FishConfig> = {}, deps: Partial<FishDeps> = {}) {
  return provider(fetchImpl, over, { cache: knowing(NARRATOR_ENTRY), ...deps });
}

const controller = new AbortController();
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const ID_C = 'c'.repeat(32);
/**
 * The narrator of the synthesis tests: a voice filed under several languages,
 * so a short text on it carries no language hint and those tests stay about the
 * route. The hint has its own tests at the end of this file (#23).
 */
const NARRATOR = { voice: `mul/${ID_A}`, signal: controller.signal };
const NARRATOR_ENTRY = { id: `mul/${ID_A}`, label: 'Narrator', locale: 'mul' };
const DEFAULT = { voice: `mul/${DEFAULT_VOICE}`, signal: controller.signal };
const DEFAULT_ENTRY = { id: `mul/${DEFAULT_VOICE}`, label: 'Default', locale: 'mul' };

/** A model as `GET /model` lists it (measured 2026-09-10): the fields that are read, and some that are not. */
const model = (_id: string, title: string, languages: string[] = ['en']) => ({
  _id,
  type: 'tts',
  title,
  description: '',
  languages,
  tags: [],
  like_count: 1,
  task_count: 2,
  visibility: 'public',
  state: 'trained',
  samples: [],
});
const page = (items: unknown[], has_more = false) => Response.json({ total: items.length, items, has_more });
const publicPage = (items: unknown[], options: { has_more?: boolean; total?: number } = {}) =>
  Response.json({ total: options.total ?? items.length, items, has_more: options.has_more ?? false });
/** A refusal in Fish's shape, plus whatever header the gateway adds. */
const refusal = (status: number, message: string, headers: Record<string, string> = {}) => Response.json({ status, message }, { status, headers });

/** A bare MP3 frame header — eleven sync bits, MPEG-1 Layer III, a real bitrate index — which is what Fish's chunks begin with. */
const MP3_A = new Uint8Array([0xff, 0xfb, 0x90, 0x01]);
const MP3_B = new Uint8Array([0x02, 0x03]);
/** `RIFF` … `WAVE`, the four-byte signature `sniffContainer` recognises. */
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
/** An ID3v2.4 tag, the other way an MP3 announces itself. */
const ID3 = new Uint8Array([0x49, 0x44, 0x33, 0x04]);
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
type Seg = [string, number, number];
/** One event of the timestamp route: a chunk of the audio and the latest alignment snapshot of a text chunk (the docs' shape, measured 2026-09-10). */
const event = (audio: Uint8Array | null, segments: Seg[] | null, chunk_seq = 0, chunk_audio_offset_sec = 0, content = '') =>
  JSON.stringify({
    audio_base64: audio ? b64(audio) : '',
    content,
    chunk_seq,
    chunk_audio_offset_sec,
    alignment: segments ? { audio_duration: segments.at(-1)?.[2] ?? 0, segments: segments.map(([text, start, end]) => ({ text, start, end })) } : null,
  });
const stream = (...events: string[]) => new Response(events.map((e) => `data: ${e}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const events = (...raw: string[]) => parseEventStream(raw.map((e) => `data: ${e}\n\n`).join(''));

const call = (fetchImpl: any, index = 0): { url: string; init: RequestInit & { headers: Record<string, string> }; body: any } => {
  const [url, init] = fetchImpl.mock.calls[index];
  return { url, init, body: init?.body ? JSON.parse(init.body as string) : undefined };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('fishVoiceIds', () => {
  it('finds every 32-hex id in what was pasted — ids, links, any separator — once each, lowercased', () => {
    const text = `https://fish.audio/m/${ID_A}/ , ${ID_B.toUpperCase()}\n${ID_A} ; https://fish.audio/m/${ID_C}`;
    expect(fishVoiceIds(text)).toEqual([ID_A, ID_B, ID_C]);
  });

  it('finds nothing in an empty field or in text without an id', () => {
    expect(fishVoiceIds('')).toEqual([]);
    expect(fishVoiceIds('alloy, nova')).toEqual([]);
  });
});

describe('localeOfLanguages', () => {
  it('files a voice with one language under it and one with several, or none, under the multilingual group', () => {
    expect(localeOfLanguages(['en'])).toBe('en');
    expect(localeOfLanguages(['ZH'])).toBe('zh');
    expect(localeOfLanguages(['es', 'en'])).toBe('mul');
    expect(localeOfLanguages([])).toBe('mul');
    expect(localeOfLanguages(undefined)).toBe('mul');
    expect(localeOfLanguages(['not a code'])).toBe('mul');
  });

  it('keeps the id prefix for language tags the grouping does not recognize', () => {
    expect(localeOfLanguages(['en-US'])).toBe('mul');
  });
});

describe('fishVoice', () => {
  it('keeps the locale in the id and names the voice by its title', () => {
    expect(fishVoice(model(ID_A, 'jjk narrator'))).toEqual({ id: `en/${ID_A}`, label: 'jjk narrator', locale: 'en' });
    expect(fishVoice(model(ID_B, 'Bilingüe', ['es', 'en']))).toEqual({ id: `mul/${ID_B}`, label: 'Bilingüe', locale: 'mul' });
  });

  it('names a voice by its id without a title, and answers null for an entry without an id', () => {
    expect(fishVoice({ _id: ID_A, languages: ['ja'] })).toEqual({ id: `ja/${ID_A}`, label: ID_A, locale: 'ja' });
    expect(fishVoice({ title: 'Nobody' })).toBeNull();
  });

  it.each([
    ['Canadian English', 'en-CA', ['en-ca']],
    ['Australian English', 'en-AU', ['en-au']],
    ['British English', 'en-GB', []],
    ['US male', 'en-US', []],
    ['Indian English', 'en-IN', []],
  ])('files a clearly published %s voice under its region while retaining the stable English id', (label, locale, tags) => {
    const title = `Avery — ${label}`;
    expect(fishVoice({ ...model(ID_A, title), tags })).toEqual({ id: `en/${ID_A}`, label: title, locale });
  });

  it('uses an explicit regional language tag without changing the stable id', () => {
    const voice = fishVoice(model(ID_A, 'regional voice', ['en-US']));
    expect(voice).toEqual({ id: `mul/${ID_A}`, label: 'regional voice', locale: 'en-US' });
  });

  it('uses the published region tag even when the title has no region', () => {
    expect(fishVoice({ ...model(ID_A, 'regional voice'), tags: ['en-ca'] })).toEqual({ id: `en/${ID_A}`, label: 'regional voice', locale: 'en-CA' });
  });

  it('does not regroup other languages or infer an accent from a description’s target audience', () => {
    expect(fishVoice(model(ID_A, 'Chinese voice', ['zh-CN']))).toEqual({ id: `mul/${ID_A}`, label: 'Chinese voice', locale: 'mul' });
    expect(fishVoice({ ...model(ID_B, 'Narrator'), description: 'Ideal for British travel advertisements.' })).toEqual({ id: `en/${ID_B}`, label: 'Narrator', locale: 'en' });
  });

  it('keeps conflicting regional tags under generic English', () => {
    expect(fishVoice({ ...model(ID_A, 'Canadian voice'), tags: ['en-ca', 'en-us'] })?.locale).toBe('en');
  });

  it('uses an explicit English region for multilingual models without guessing from a name', () => {
    expect(fishVoice(model(ID_A, 'Aarav'))).toEqual({ id: `en/${ID_A}`, label: 'Aarav', locale: 'en' });
    expect(fishVoice({ ...model(ID_B, 'Aarav — Male Indian multilingual (EN)', ['ru', 'ar', 'en', 'es', 'fr']), tags: ['indian'] })).toEqual({
      id: `mul/${ID_B}`,
      label: 'Aarav — Male Indian multilingual (EN)',
      locale: 'en-IN',
    });
  });

  it.each([
    ['Indian multilingual narrator', ['indian'], 'mul'],
    ['Indian multilingual narrator (EN)', [], 'en-IN'],
    ['Australian English narrator', [], 'en-AU'],
    ['Regional narrator', ['en-ca'], 'en-CA'],
    ['Indian narrator (EN)', ['en-us'], 'mul'],
  ])('groups multilingual %s only with explicit English and an unambiguous region', (title, tags, locale) => {
    expect(fishVoice({ ...model(ID_A, title, ['hi', 'en']), tags })).toEqual({ id: `mul/${ID_A}`, label: title, locale });
  });

  it('does not move a non-English voice just because its title mentions English', () => {
    expect(fishVoice(model(ID_A, 'Indian English narrator', ['hi']))?.locale).toBe('hi');
  });
});

describe('decodeFishVoice', () => {
  it('splits a published id into its locale and model id, the default voice included', () => {
    expect(decodeFishVoice(`en/${ID_A}`)).toEqual({ locale: 'en', id: ID_A });
    expect(decodeFishVoice(`mul/${DEFAULT_VOICE}`)).toEqual({ locale: 'mul', id: DEFAULT_VOICE });
  });

  it('answers null for anything else', () => {
    expect(decodeFishVoice(ID_A)).toBeNull();
    expect(decodeFishVoice('en/')).toBeNull();
    expect(decodeFishVoice('en/alloy')).toBeNull();
    expect(decodeFishVoice(`not a locale/${ID_A}`)).toBeNull();
  });
});

describe('parseEventStream', () => {
  it('reads the JSON of every data line and skips comments, other fields, blank lines and a line that is not JSON', () => {
    const body = `: keep-alive\n\nevent: message\ndata: {"chunk_seq":0}\n\ndata: not json\n\ndata: {"chunk_seq":1}\r\n\r\n`;
    expect(parseEventStream(body)).toEqual([{ chunk_seq: 0 }, { chunk_seq: 1 }]);
  });

  it('reads a data line with no space after the colon, and one whose JSON contains colons and braces', () => {
    expect(parseEventStream(`data:{"content":"a: {b}","chunk_seq":2}\n`)).toEqual([{ content: 'a: {b}', chunk_seq: 2 }]);
  });

  it('reads nothing from a body whose newlines are the two characters backslash and n', () => {
    // The shape of a hand-written stub, and the cause of a "no audio" error
    // that looked like a Fish outage (Zotero-TTS notes/NOTES_2026-09-13.md).
    // One `data:` line that is not JSON is better than half an event.
    expect(parseEventStream(`data: {"chunk_seq":0}\\n\\ndata: {"chunk_seq":1}\\n\\n`)).toEqual([]);
  });

  it('skips a data line whose JSON is not an object', () => {
    expect(parseEventStream(`data: "just a string"\ndata: 7\ndata: null\ndata: {"chunk_seq":0}\n`)).toEqual([{ chunk_seq: 0 }]);
  });
});

describe('mergeEvents', () => {
  it('concatenates the audio chunks in order, keeps the latest snapshot per text chunk, and moves each chunk by its offset', () => {
    const merged = mergeEvents(
      events(
        event(MP3_A, null, 0),
        event(null, [['Hello', 0, 0.4]], 0),
        event(MP3_B, [['Hello', 0, 0.4], ['world', 0.4, 0.86]], 0),
        event(null, null, 1, 1),
        event(null, [['again', 0.1, 0.5]], 1, 1),
      ),
    );
    expect([...merged.audio]).toEqual([...MP3_A, ...MP3_B]);
    expect(merged.words).toEqual([
      { text: 'Hello', start: 0, end: 0.4 },
      { text: 'world', start: 0.4, end: 0.86 },
      { text: 'again', start: 1.1, end: 1.5 },
    ]);
    expect(merged.chunks).toBe(2);
  });

  it('replaces a chunk’s snapshot rather than appending it, so a cumulative report does not repeat its words', () => {
    // The route re-sends the whole snapshot of a chunk as it grows, and the
    // last events repeat the final one. Appending would emit `one` five times
    // and put the highlight on a word that was spoken once.
    const merged = mergeEvents(
      events(
        event(MP3_A, [['one', 0, 0.3]], 0),
        event(MP3_B, [['one', 0, 0.3], ['two', 0.3, 0.6]], 0),
        event(null, [['one', 0, 0.3], ['two', 0.3, 0.6], ['three', 0.6, 1]], 0),
        event(null, [['one', 0, 0.3], ['two', 0.3, 0.6], ['three', 0.6, 1]], 0),
      ),
    );
    expect(merged.words.map((w) => w.text)).toEqual(['one', 'two', 'three']);
    expect(merged.chunks).toBe(1);
  });

  it('keeps a snapshot a later null alignment would otherwise have cleared', () => {
    const merged = mergeEvents(events(event(MP3_A, [['kept', 0, 0.5]], 0), event(MP3_B, null, 0)));
    expect(merged.words).toEqual([{ text: 'kept', start: 0, end: 0.5 }]);
  });

  it('orders the words by chunk, not by arrival, and moves each chunk by its own offset rather than a running sum', () => {
    // Every property of the timeline in one assertion. The offsets 0, 5 and 9
    // are already against the start of the whole audio, so `nine` starts at
    // 9.2 — not at 14.2, which is what accumulating them would give, and which
    // would drift further with every chunk.
    const merged = mergeEvents(
      events(
        event(MP3_B, [['nine', 0.2, 0.7]], 2, 9),
        event(MP3_A, [['zero', 0, 0.4]], 0, 0),
        event(null, [['five', 0.1, 0.9]], 1, 5),
      ),
    );
    expect(merged.words).toEqual([
      { text: 'zero', start: 0, end: 0.4 },
      { text: 'five', start: 5.1, end: 5.9 },
      { text: 'nine', start: 9.2, end: 9.7 },
    ]);
    // The audio is in arrival order, which is the order Fish sends it in
    expect([...merged.audio]).toEqual([...MP3_B, ...MP3_A]);
    expect(merged.chunks).toBe(3);
  });

  it('counts a chunk that carried only audio, and treats a missing chunk_seq as chunk zero', () => {
    expect(mergeEvents(events(event(MP3_A, null, 0), event(MP3_B, [['a', 0, 1]], 1, 2))).chunks).toBe(2);
    const merged = mergeEvents([{ audio_base64: b64(MP3_A), alignment: { segments: [{ text: 'a', start: 0, end: 1 }] } }]);
    expect(merged.words).toEqual([{ text: 'a', start: 0, end: 1 }]);
    expect(merged.chunks).toBe(1);
  });

  it('skips a segment without a text or with times that are not numbers, and an event without audio', () => {
    const raw = [
      {
        audio_base64: '',
        chunk_seq: 0,
        chunk_audio_offset_sec: 0,
        alignment: {
          audio_duration: 1,
          segments: [{ text: 'a', start: 0, end: 0.5 }, { text: '', start: 0.5, end: 0.6 }, { text: 'b', start: '0.6', end: 1 }, { text: 'c', start: 0.9, end: 0.7 }, null],
        },
      },
    ];
    expect(mergeEvents(raw).words).toEqual([{ text: 'a', start: 0, end: 0.5 }]);
    expect(mergeEvents(raw).audio.length).toBe(0);
  });

  it('ignores an alignment that is not an object or whose segments are not a list, and an event with no audio field at all', () => {
    expect(mergeEvents([{ chunk_seq: 0, alignment: 'soon' }, { chunk_seq: 1, alignment: { segments: 'none' } }]).words).toEqual([]);
    expect(mergeEvents([{ chunk_seq: 0 }]).audio.length).toBe(0);
  });

  it('skips an offset or a chunk number that is not a finite number', () => {
    const merged = mergeEvents([
      { chunk_seq: Number.NaN, chunk_audio_offset_sec: Number.POSITIVE_INFINITY, alignment: { segments: [{ text: 'a', start: 1, end: 2 }] } },
    ]);
    expect(merged.words).toEqual([{ text: 'a', start: 1, end: 2 }]);
    expect(merged.chunks).toBe(1);
  });

  it('throws on audio that is not base64', () => {
    expect(() => mergeEvents([{ audio_base64: '***', chunk_seq: 0 }])).toThrow();
  });
});

describe('fishReason', () => {
  it('reads the message of a refusal, and nothing from any other body', () => {
    expect(fishReason(JSON.stringify({ status: 400, message: 'Reference  not\nfound' }))).toBe('Reference not found');
    expect(fishReason('No permission -- see authorization schemes')).toBe('');
  });
});

describe('listVoices', () => {
  it('lists the account’s own voices page by page under their locales, then the default voice', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('page_number=1') ? page([model(ID_A, 'jjk narrator'), model(ID_B, '中文', ['zh'])], true) : page([model(ID_C, 'Both', ['es', 'en'])]),
    );
    const voices = await provider(fetchImpl, { includeOfficial: false }).listVoices({ signal: controller.signal });
    expect(voices).toEqual([
      { id: `en/${ID_A}`, label: 'jjk narrator', locale: 'en' },
      { id: `zh/${ID_B}`, label: '中文', locale: 'zh' },
      { id: `mul/${ID_C}`, label: 'Both', locale: 'mul' },
      DEFAULT_ENTRY,
    ]);
    expect(call(fetchImpl).url).toBe(`${FISH_API}/model?self=true&page_size=${PAGE_SIZE}&page_number=1`);
    expect(call(fetchImpl).init.headers.Authorization).toBe('Bearer sk-fish-test');
    // The shared load gets its own signal so a timeout can cancel the
    // transport; the caller's is never handed to fetch, or one listing giving
    // up would cancel the load every other caller is waiting on.
    expect(call(fetchImpl).init.signal).not.toBe(controller.signal);
    expect(call(fetchImpl).init.signal?.aborted).toBe(false);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toContain(`${FISH_API}/model?self=true&page_size=${PAGE_SIZE}&page_number=2`);
  });

  it('resolves the pasted ids one by one, skips those the account owns, and lists an id the library does not know as not found', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([model(ID_A, 'Own')]);
      if (url.endsWith(`/model/${ID_B}`)) return Response.json(model(ID_B, 'Paddington', ['en']));
      if (url.endsWith(`/model/${ID_C}`)) return refusal(404, 'Model not found');
      throw new Error(`unexpected ${url}`);
    });
    const p = provider(fetchImpl, { includeOfficial: false, voices: `https://fish.audio/m/${ID_B}/ ${ID_A} ${ID_C}` });
    const voices = await p.listVoices();
    expect(voices.map((v) => v.label)).toEqual(['Own', 'Paddington', `${ID_C} (not found)`, 'Default']);
    expect(voices[2]).toEqual({ id: `mul/${ID_C}`, label: `${ID_C} (not found)`, locale: 'mul' });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${FISH_API}/model?self=true&page_size=${PAGE_SIZE}&page_number=1`,
      `${FISH_API}/model/${ID_B}`,
      `${FISH_API}/model/${ID_C}`,
    ]);
  });

  it('reports a wrong key as an auth error — the list answers 401 in plain text', async () => {
    const fetchImpl = vi.fn(async () => new Response('No permission -- see authorization schemes', { status: 401 }));
    await expect(provider(fetchImpl).listVoices()).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('No permission') });
  });

  it('asks nothing without a key', async () => {
    const fetchImpl = vi.fn();
    await expect(provider(fetchImpl, { apiKey: ' ' }).listVoices()).rejects.toMatchObject({ kind: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports the outage rather than answering a catalogue of one when the server cannot be reached', async () => {
    // The plugin answered `[Default]` and put "the list may be stale" in a
    // status line beside it. There is no such line here, so a one-voice
    // catalogue would be the only thing the owner saw of a server that is down.
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('NetworkError');
    });
    await expect(provider(fetchImpl).listVoices()).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('cannot reach') });
  });

  it('lists what the working source found when the other one failed', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([model(ID_A, 'Own')]);
      throw new TypeError('NetworkError');
    });
    await expect(provider(fetchImpl, { includeManual: false }).listVoices()).resolves.toEqual([{ id: `en/${ID_A}`, label: 'Own', locale: 'en' }, DEFAULT_ENTRY]);
  });

  it('merges official and own voices, deduplicating by raw model id', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([model(ID_A, 'Own A')]);
      if (url.includes(`author_id=${OFFICIAL_AUTHOR_ID}`) && (url.includes('page_number=1&') || url.endsWith('page_number=1')))
        return publicPage([model(ID_A, 'Official A'), model(ID_B, 'Official B')], { has_more: true, total: 300 });
      if (url.includes(`author_id=${OFFICIAL_AUTHOR_ID}`)) return publicPage([model(ID_C, 'Official C')]);
      throw new Error(`unexpected ${url}`);
    });
    const voices = await provider(fetchImpl, { includeManual: false }).listVoices();
    expect(voices.map((v) => v.id)).toEqual([`en/${ID_A}`, `en/${ID_B}`, `en/${ID_C}`, `mul/${DEFAULT_VOICE}`]);
    // The official entry wins the duplicate, because official is merged first
    expect(voices[0].label).toBe('Official A');
  });

  it.each([
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [false, true, true],
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true],
  ])('fetches exactly the enabled sources (%s official, %s own, %s manual)', async (includeOfficial, includeOwn, includeManual) => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(`author_id=${OFFICIAL_AUTHOR_ID}`)) return publicPage([model(ID_A, 'Official')]);
      if (url.includes('self=true')) return page([model(ID_B, 'Own')]);
      if (url.endsWith(`/model/${ID_C}`)) return Response.json(model(ID_C, 'Manual'));
      throw new Error(`unexpected ${url}`);
    });
    const voices = await provider(fetchImpl, { includeOfficial, includeOwn, includeManual, voices: ID_C }).listVoices();
    expect(voices).toEqual([
      ...(includeOfficial ? [{ id: `en/${ID_A}`, label: 'Official', locale: 'en' }] : []),
      ...(includeOwn ? [{ id: `en/${ID_B}`, label: 'Own', locale: 'en' }] : []),
      ...(includeManual ? [{ id: `en/${ID_C}`, label: 'Manual', locale: 'en' }] : []),
      ...(includeOwn ? [DEFAULT_ENTRY] : []),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(Number(includeOfficial) + Number(includeOwn) + Number(includeManual));
  });

  it('keeps a disabled source’s cache out of the catalogue while retaining the manual text', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(`author_id=${OFFICIAL_AUTHOR_ID}`)) return publicPage([model(ID_A, 'Official')]);
      if (url.includes('self=true')) return page([model(ID_B, 'Own')]);
      if (url.endsWith(`/model/${ID_C}`)) return Response.json(model(ID_C, 'Manual'));
      throw new Error(`unexpected ${url}`);
    });
    const config: FishConfig = { ...cfg, includeOfficial: true, includeOwn: true, includeManual: true, voices: ID_C };
    const p = createFishProvider(config, { fetch: fetchImpl as typeof fetch, cache: new FishVoiceCache() });
    await p.listVoices();
    config.includeOfficial = false;
    config.includeOwn = false;
    config.includeManual = false;
    expect(await p.listVoices()).toEqual([]);
    config.includeOwn = true;
    expect(await p.listVoices()).toEqual([{ id: `en/${ID_B}`, label: 'Own', locale: 'en' }, DEFAULT_ENTRY]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('lists the four official pages through the stable author id without a licensed filter', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      const pageNumber = Number(new URL(url).searchParams.get('page_number'));
      return publicPage([model(`${String.fromCharCode(96 + pageNumber)}${'a'.repeat(31)}`, `Official ${pageNumber}`)], { has_more: pageNumber < 4, total: 338 });
    });
    const voices = await provider(fetchImpl, { includeOwn: false, includeManual: false }).listVoices();
    expect(voices.slice(0, 4).map((voice) => voice.label)).toEqual(['Official 1', 'Official 2', 'Official 3', 'Official 4']);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const officialCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes(`author_id=${OFFICIAL_AUTHOR_ID}`));
    expect(officialCalls).toHaveLength(4);
    expect(officialCalls.every(([url]) => !String(url).includes('licensed'))).toBe(true);
  });

  it('skips public entries that are not TTS models, unfinished, withdrawn, or without a valid model id', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      return publicPage([
        model(ID_A, 'Playable'),
        { ...model(ID_B, 'Service'), type: 'svc' },
        { ...model(ID_C, 'Creating'), state: 'created' },
        { ...model('d'.repeat(32), 'Removed'), dmca_taken_down: true },
        { _id: 'not-a-model-id', title: 'Broken', languages: ['en'] },
      ]);
    });
    expect((await provider(fetchImpl).listVoices()).map((voice) => voice.label)).toEqual(['Playable', 'Default']);
  });

  it('reuses the official and own lists across providers sharing a cache', async () => {
    const cache = new FishVoiceCache();
    const fetchImpl = vi.fn(async (url: string) => (url.includes('self=true') ? page([model(ID_A, 'Own')]) : publicPage([model(ID_B, 'Official')])));
    const first = provider(fetchImpl, { apiKey: 'account-a' }, { cache });
    const second = provider(fetchImpl, { apiKey: 'account-a' }, { cache });
    await first.listVoices();
    await second.listVoices();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shares one listing between providers built without a cache of their own', async () => {
    // Why Fish needed nothing added to `ProviderDeps`: the session cache lives
    // in the module, the way `speechify.ts` keeps its serial queue there. The
    // account is unique to this test so the shared cache carries nothing into
    // another one.
    const fetchImpl = vi.fn(async (url: string) => (url.includes('self=true') ? page([model(ID_A, 'Own')]) : publicPage([])));
    const deps = { fetch: fetchImpl as unknown as typeof fetch };
    const over = { apiKey: 'module-shared-account', includeManual: false };
    await createFishProvider({ ...cfg, ...over }, deps).listVoices();
    await createFishProvider({ ...cfg, ...over }, deps).listVoices();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reuses cached manual metadata while honouring the current manual text', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      if (url.endsWith(`/model/${ID_C}`)) return Response.json(model(ID_C, 'Manual C'));
      return publicPage([model(ID_A, 'Official A')]);
    });
    const config: FishConfig = { ...cfg, voices: ID_C };
    const p = createFishProvider(config, { fetch: fetchImpl as typeof fetch, cache: new FishVoiceCache() });
    expect((await p.listVoices()).map((voice) => voice.label)).toEqual(['Official A', 'Manual C', 'Default']);
    // A removed id disappears at once, and the official snapshot is not refetched
    config.voices = '';
    expect((await p.listVoices()).map((voice) => voice.label)).toEqual(['Official A', 'Default']);
    // Pasted again, and the metadata is remembered rather than asked for twice
    config.voices = ID_C;
    expect((await p.listVoices()).map((voice) => voice.label)).toEqual(['Official A', 'Manual C', 'Default']);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).endsWith(`/model/${ID_C}`))).toHaveLength(1);
  });

  it('keeps cached lists isolated when the API key changes', async () => {
    const cache = new FishVoiceCache();
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const account = (init.headers as Record<string, string>).Authorization;
      if (url.includes('self=true')) return page([model(account.includes('a-key') ? ID_A : ID_B, account)]);
      return publicPage([]);
    });
    const config: FishConfig = { ...cfg, apiKey: 'a-key' };
    const p = createFishProvider(config, { fetch: fetchImpl as typeof fetch, cache });
    expect((await p.listVoices()).map((voice) => voice.id)).toContain(`en/${ID_A}`);
    config.apiKey = 'b-key';
    expect((await p.listVoices()).map((voice) => voice.id)).toContain(`en/${ID_B}`);
    config.apiKey = 'a-key';
    expect((await p.listVoices()).map((voice) => voice.id)).toContain(`en/${ID_A}`);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not let one canceled caller cancel another caller using the shared listing request', async () => {
    const own = deferred<Response>();
    const published = deferred<Response>();
    const fetchImpl = vi.fn((url: string, _init?: RequestInit) => (url.includes('self=true') ? own.promise : published.promise));
    const p = provider(fetchImpl);
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = p.listVoices({ signal: firstController.signal });
    const second = p.listVoices({ signal: secondController.signal });
    firstController.abort();
    await expect(first).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl.mock.calls.every(([, init]) => init?.signal !== firstController.signal)).toBe(true);
    own.resolve(page([]));
    published.resolve(publicPage([]));
    await expect(second).resolves.toEqual([DEFAULT_ENTRY]);
  });

  it('aborts its own transport when the listing’s bound fires, and never because a caller gave up', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Promise<Response>(() => {}));
    const p = provider(fetchImpl, {}, { timeoutMs: 20 });
    const caller = new AbortController();
    const first = p.listVoices({ signal: caller.signal });
    caller.abort();
    await expect(first).rejects.toMatchObject({ kind: 'network' });
    const started = fetchImpl.mock.calls.map(([, init]) => init!.signal!);
    expect(started.length).toBeGreaterThan(0);
    expect(started.every((signal) => signal !== caller.signal)).toBe(true);
    expect(started.some((signal) => signal.aborted)).toBe(false);
    // The shared load's own bound is what cancels the request, so a listing
    // nobody is waiting for does not keep running (philosophy rule 1).
    await expect(p.listVoices()).rejects.toMatchObject({ kind: 'network' });
    expect(started.every((signal) => signal.aborted)).toBe(true);
  });

  it('does not start a listing for a caller whose signal is already aborted', async () => {
    const fetchImpl = vi.fn();
    const aborted = new AbortController();
    aborted.abort();
    await expect(provider(fetchImpl).listVoices({ signal: aborted.signal })).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('bounds the complete official and own listing operation and reports the time limit', async () => {
    const fetchImpl = vi.fn(async () => new Promise<Response>(() => {}));
    const p = provider(fetchImpl, {}, { timeoutMs: 20 });
    const started = Date.now();
    await expect(p.listVoices()).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('no reply within') });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('drops a timed-out shared request so a later listing recovers without being asked twice', async () => {
    let officialCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      officialCalls++;
      if (officialCalls === 1) return new Promise<Response>(() => {});
      return publicPage([model(ID_A, 'Recovered official')]);
    });
    const p = provider(fetchImpl, {}, { timeoutMs: 20 });
    await expect(p.listVoices()).rejects.toMatchObject({ kind: 'network' });
    await expect(p.listVoices()).resolves.toEqual([{ id: `en/${ID_A}`, label: 'Recovered official', locale: 'en' }, DEFAULT_ENTRY]);
    expect(officialCalls).toBe(2);
  });

  it('expires a shared pasted lookup at the listing deadline so it cannot poison a later listing', async () => {
    let manualCalls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      if (url.endsWith(`/model/${ID_C}`)) {
        manualCalls++;
        if (manualCalls === 1) return new Promise<Response>(() => {});
        return Response.json(model(ID_C, 'Recovered manual'));
      }
      return publicPage([]);
    });
    const p = provider(fetchImpl, { voices: ID_C }, { timeoutMs: 20 });
    await expect(p.listVoices()).rejects.toMatchObject({ kind: 'network' });
    await expect(p.listVoices()).resolves.toEqual([{ id: `en/${ID_C}`, label: 'Recovered manual', locale: 'en' }, DEFAULT_ENTRY]);
    expect(manualCalls).toBe(2);
  });

  it('keeps a manual voice already resolved when a hanging official list consumes the deadline, and starts no new lookup', async () => {
    const cache = new FishVoiceCache();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      if (url.includes('author_id=')) return new Promise<Response>(() => {});
      if (url.endsWith(`/model/${ID_C}`)) return Response.json(model(ID_C, 'Saved manual'));
      throw new Error(`Unexpected lookup: ${url}`);
    });
    await provider(fetchImpl, { includeOfficial: false, includeOwn: false, voices: ID_C }, { cache, timeoutMs: 20 }).listVoices();
    const later = provider(fetchImpl, { includeOwn: false, voices: `${ID_C} ${ID_B}` }, { cache, timeoutMs: 20 });
    expect(await later.listVoices()).toEqual([{ id: `en/${ID_C}`, label: 'Saved manual', locale: 'en' }]);
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith(`/model/${ID_C}`))).toHaveLength(1);
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(`/model/${ID_B}`))).toBe(false);
  });

  it('reports a malformed model-list reply', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ items: null }));
    await expect(provider(fetchImpl).listVoices()).rejects.toMatchObject({ kind: 'unknown', message: expect.stringContaining('model list') });
  });

  it('rejects a refused key even when the other source answered', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return new Response('No permission -- see authorization schemes', { status: 401 });
      return publicPage([model(ID_A, 'Official')]);
    });
    await expect(provider(fetchImpl, { includeManual: false }).listVoices()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('official pagination', () => {
  it('fetches the remaining public-window pages concurrently after the first page reveals the window', async () => {
    let publicInFlight = 0;
    let maxPublicInFlight = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('self=true')) return page([]);
      if (url.includes('page_number=1&') || url.endsWith('page_number=1')) return publicPage([model(ID_A, 'First')], { has_more: true, total: 1000 });
      publicInFlight++;
      maxPublicInFlight = Math.max(maxPublicInFlight, publicInFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      publicInFlight--;
      return publicPage([]);
    });
    const voices = await provider(fetchImpl).listVoices();
    expect(voices.map((voice) => voice.label)).toEqual(['First', 'Default']);
    expect(maxPublicInFlight).toBe(9);
  });
});

describe('synthesize', () => {
  it('asks the timestamp route for MP3 at 64 kbps on the free model, and aligns the stream’s words to the text', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, null), event(MP3_B, [['Hello', 0, 0.4], ['world', 0.4, 0.86]])));
    const result = await speaker(fetchImpl).synthesize('Hello, world!', NARRATOR);
    const { url, init, body } = call(fetchImpl);
    expect(url).toBe(`${FISH_API}/v1/tts/stream/with-timestamp`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-fish-test', 'Content-Type': 'application/json', model: MODEL_FREE });
    expect(init.signal).toBe(controller.signal);
    expect(body).toEqual({ text: 'Hello, world!', reference_id: ID_A, format: 'mp3', mp3_bitrate: MP3_BITRATE, latency: 'normal' });
    expect(result).toMatchObject({ audio: 'encoded', mediaType: FISH_MEDIA_TYPE });
    expect(result.audio === 'encoded' && [...result.bytes]).toEqual([...MP3_A, ...MP3_B]);
    expect(result.timestamps).toEqual([
      { start: 0, end: 0.4, charStart: 0, charEnd: 5 },
      { start: 0.4, end: 0.86, charStart: 7, charEnd: 12 },
    ]);
    expect(result.note).toBe(MODEL_FREE);
  });

  it('sends the utterance and nothing else on a voice filed under several languages — no speed, no hint, not one character added', async () => {
    // ADR 0009 has no speed to add, and a voice of several languages has no one
    // language to name, so a short text goes as it is (#23). The leading space
    // survives, because the alignment’s character offsets are against this text.
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['exp', 0.2, 0.6]])));
    await speaker(fetchImpl).synthesize(' 100 exp', NARRATOR);
    expect(Object.keys(call(fetchImpl).body).sort()).toEqual(['format', 'latency', 'mp3_bitrate', 'reference_id', 'text']);
    expect(call(fetchImpl).body.text).toBe(' 100 exp');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('names the paid model in the header when the switch is off, and sends no reference for the default voice', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['Hi', 0, 0.3]])));
    await speaker(fetchImpl, { freeOnly: false }).synthesize('Hi', DEFAULT);
    expect(call(fetchImpl).init.headers.model).toBe(MODEL_PAID);
    expect(call(fetchImpl).body).toEqual({ text: 'Hi', format: 'mp3', mp3_bitrate: MP3_BITRATE, latency: 'normal' });
  });

  it('moves a later text chunk’s words by its offset and counts the chunks in the note', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['One', 0, 0.5]], 0, 0), event(MP3_B, [['two', 0.1, 0.4]], 1, 0.5)));
    const result = await speaker(fetchImpl).synthesize('One two', NARRATOR);
    expect(result.timestamps).toEqual([
      { start: 0, end: 0.5, charStart: 0, charEnd: 3 },
      { start: 0.6, end: 0.9, charStart: 4, charEnd: 7 },
    ]);
    expect(result.note).toBe(`${MODEL_FREE}, 2 chunks`);
  });

  it('puts a later chunk that arrived first back in its place, so the timings stay in the order the audio plays', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_B, [['two', 0.1, 0.4]], 1, 0.5), event(MP3_A, [['One', 0, 0.5]], 0, 0)));
    const result = await speaker(fetchImpl).synthesize('One two', NARRATOR);
    expect(result.timestamps).toEqual([
      { start: 0, end: 0.5, charStart: 0, charEnd: 3 },
      { start: 0.6, end: 0.9, charStart: 4, charEnd: 7 },
    ]);
  });

  it('aligns Chinese words the stream reports one per character onto the text', async () => {
    // 60 Chinese characters answered 38 segments, one per character, with Latin
    // tokens whole (measured 2026-09-10). `align.ts` joins the characters of one
    // spoken word into one highlight, and the offsets are its own, never the
    // stream's.
    const fetchImpl = vi.fn(async () =>
      stream(event(MP3_A, [['他', 0, 0.2], ['说', 0.2, 0.4], ['Zotero', 0.4, 1], ['很', 1, 1.2], ['好', 1.2, 1.4]])),
    );
    const text = '他说Zotero很好。';
    const result = await speaker(fetchImpl).synthesize(text, NARRATOR);
    expect(result.timestamps?.map((t) => text.slice(t.charStart, t.charEnd))).toEqual(['他', '说', 'Zotero', '很', '好']);
    expect(result.timestamps?.map((t) => t.start)).toEqual([0, 0.2, 0.4, 1, 1.2]);
  });

  it('falls back to the utterance with a note when no event carried an alignment', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, null), event(MP3_B, null)));
    const result = await speaker(fetchImpl).synthesize('Hello', NARRATOR);
    expect(result.timestamps).toBeUndefined();
    expect(result.note).toBe(`${MODEL_FREE}: no word timings in the stream`);
    expect(result.audio === 'encoded' && [...result.bytes]).toEqual([...MP3_A, ...MP3_B]);
  });

  it('falls back to the utterance when none of the stream’s words is in the text', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['completely', 0, 0.5], ['different', 0.5, 1]])));
    const result = await speaker(fetchImpl).synthesize('Hello', NARRATOR);
    expect(result.timestamps).toBeUndefined();
    expect(result.note).toContain('none of the 2 words');
  });

  it('says in the note how much of the alignment had to be bridged', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['Hello', 0, 0.4], ['extra', 0.4, 0.5], ['world', 0.5, 0.9]])));
    const result = await speaker(fetchImpl).synthesize('Hello world', NARRATOR);
    expect(result.note).toBe(`${MODEL_FREE}, 1 dropped`);
  });

  it('reports the audio as the encoded MP3 it asked for, with no sample rate invented for it', async () => {
    // ADR 0013 asks for PCM where the protocol allows it. Fish's does not name
    // a rate anywhere — the stream's own Content-Type is `text/event-stream`
    // and an event carries only the base64 — so `pcm` would mean guessing
    // 24 kHz, and a wrong rate is drift in the playback clock rather than a
    // visible error.
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['Hi', 0, 0.3]])));
    const result = await speaker(fetchImpl).synthesize('Hi', NARRATOR);
    expect(result.audio).toBe('encoded');
    expect(result).not.toHaveProperty('sampleRate');
    expect(result).not.toHaveProperty('samples');
  });

  it('lets the bytes overrule that declaration: a WAV or an ID3 tag in the stream is reported as what it is', async () => {
    const wav = vi.fn(async () => stream(event(WAV, [['Hi', 0, 0.3]])));
    expect(await speaker(wav).synthesize('Hi', NARRATOR)).toMatchObject({ audio: 'encoded', mediaType: 'audio/wav' });
    const tagged = vi.fn(async () => stream(event(ID3, [['Hi', 0, 0.3]])));
    expect(await speaker(tagged).synthesize('Hi', NARRATOR)).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg' });
  });

  it('is an error when the stream carried no audio', async () => {
    const fetchImpl = vi.fn(async () => stream(event(null, [['Hello', 0, 0.4]])));
    await expect(speaker(fetchImpl).synthesize('Hello', NARRATOR)).rejects.toMatchObject({ kind: 'unknown', message: expect.stringContaining('no audio') });
  });

  it('is an error when a 200 is not an event stream at all', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }));
    await expect(speaker(fetchImpl).synthesize('Hello', NARRATOR)).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('is a decode failure when a chunk is not base64', async () => {
    const fetchImpl = vi.fn(async () => stream(JSON.stringify({ audio_base64: '***', chunk_seq: 0, alignment: null })));
    await expect(speaker(fetchImpl).synthesize('Hello', NARRATOR)).rejects.toMatchObject({ kind: 'decode-failed', message: expect.stringContaining('base64') });
  });

  it('sends nothing for text with no letter or digit and answers no samples, which plays as a pause', async () => {
    const fetchImpl = vi.fn();
    const result = await speaker(fetchImpl).synthesize('* * *', NARRATOR);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ audio: 'pcm', samples: new Uint8Array(0), sampleRate: PCM_SAMPLE_RATE, note: 'no speakable text' });
  });

  it('refuses a voice id it did not publish', async () => {
    const fetchImpl = vi.fn();
    await expect(speaker(fetchImpl).synthesize('Hi', { voice: 'alloy', signal: controller.signal })).rejects.toMatchObject({ kind: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports 401 as the key, 402 as the credit, and a 400 with the server’s reason', async () => {
    await expect(speaker(vi.fn(async () => refusal(401, 'Invalid Token'))).synthesize('Hi', NARRATOR)).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringContaining('Invalid Token'),
    });
    const credit = 'Insufficient API credit. API credit is managed independently from platform credit.';
    await expect(
      speaker(vi.fn(async () => refusal(402, credit, { 'x-fish-error-code': 'insufficient_balance' })), { freeOnly: false }).synthesize('Hi', NARRATOR),
    ).rejects.toMatchObject({ kind: 'quota', message: expect.stringContaining('Insufficient API credit') });
    await expect(speaker(vi.fn(async () => refusal(400, 'Reference not found'))).synthesize('Hi', NARRATOR)).rejects.toMatchObject({
      kind: 'unknown',
      message: `Fish Audio ${MODEL_FREE}: HTTP 400 — Reference not found`,
    });
  });

  it('reads the gateway’s balance header as the credit whatever the status', async () => {
    await expect(speaker(vi.fn(async () => refusal(403, 'nope', { 'x-fish-error-code': 'insufficient_balance' }))).synthesize('Hi', NARRATOR)).rejects.toMatchObject({
      kind: 'quota',
    });
  });

  it('waits what a 429 asks and tries again, then reports the rate limit', async () => {
    waits = [];
    const fetchImpl = vi.fn(async () => refusal(429, 'Too many requests', { 'Retry-After': '2' }));
    await expect(speaker(fetchImpl).synthesize('Hi', NARRATOR)).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(fetchImpl).toHaveBeenCalledTimes(RATE_LIMIT_RETRIES + 1);
    expect(waits).toEqual([2000, 2000, 2000]);
  });

  it('does not wait out a 429 that is really the credit', async () => {
    waits = [];
    const fetchImpl = vi.fn(async () => refusal(429, 'no credit', { 'x-fish-error-code': 'insufficient_balance' }));
    await expect(speaker(fetchImpl).synthesize('Hi', NARRATOR)).rejects.toMatchObject({ kind: 'quota' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
  });

  it('asks once more after a 5xx, and says so in the note', async () => {
    waits = [];
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 })).mockResolvedValueOnce(stream(event(MP3_A, [['Hi', 0, 0.3]])));
    const result = await speaker(fetchImpl).synthesize('Hi', NARRATOR);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([RETRY_DELAY_MS]);
    expect(result.note).toBe(`${MODEL_FREE} after a retry of HTTP 502`);
    await expect(speaker(vi.fn(async () => new Response('down', { status: 503 }))).synthesize('Hi', NARRATOR)).rejects.toMatchObject({
      kind: 'unknown',
      message: expect.stringContaining('503'),
    });
  });

  it('reports a server that cannot be reached as a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.');
    });
    await expect(speaker(fetchImpl).synthesize('Hi', NARRATOR)).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('api.fish.audio') });
  });

  it('refuses to synthesize without a key, and sends nothing', async () => {
    const fetchImpl = vi.fn();
    await expect(speaker(fetchImpl, { apiKey: '  ' }).synthesize('Hi', NARRATOR)).rejects.toMatchObject({ kind: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('the checks', () => {
  it('proves the key with the own-voices list, one entry', async () => {
    const fetchImpl = vi.fn(async () => page([]));
    await provider(fetchImpl).checkConnection!();
    expect(call(fetchImpl).url).toBe(`${FISH_API}/model?self=true&page_size=1`);
    await expect(provider(vi.fn(async () => new Response('No permission -- see authorization schemes', { status: 401 }))).checkConnection!()).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('still authenticates with the own probe when own voices are excluded from the catalogue', async () => {
    const fetchImpl = vi.fn(async () => page([]));
    await provider(fetchImpl, { includeOfficial: false, includeOwn: false, includeManual: false }).checkConnection!();
    expect(call(fetchImpl).url).toBe(`${FISH_API}/model?self=true&page_size=1`);
  });

  it('proves the account can synthesize with two letters on the voice, through the timestamp route', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['Hi', 0, 0.3]])));
    await provider(fetchImpl).checkSynthesis!(NARRATOR.voice);
    expect(call(fetchImpl).url).toBe(`${FISH_API}/v1/tts/stream/with-timestamp`);
    expect(call(fetchImpl).body.text).toBe('Hi');
  });

  it('is the fish provider, with word timings — the third of ADR 0005’s three over plain HTTP', () => {
    const p = provider(vi.fn());
    expect(p.id).toBe('fish');
    expect(p.capabilities.wordTimestamps).toBe(true);
  });
});

/**
 * #23: the plugin's language hint (xujialiu/Zotero-TTS#98). Fish takes the
 * language from the text, and one to three words are too few, so they go with
 * the voice's own language in front — named from the locale the voice was
 * published under, which for an English voice may carry its region.
 */
describe('language hint', () => {
  const DAX = { voice: `en/${ID_B}`, signal: controller.signal };
  const DAX_ENTRY = { id: `en/${ID_B}`, label: 'Dax', locale: 'en-US' };
  const stat = () => stream(event(MP3_A, [['100', 0, 0.4], ['exp', 0.4, 0.56]]));

  it('puts the voice’s language in front of a short stat, and aligns the words to the stat alone', async () => {
    const fetchImpl = vi.fn(async () => stat());
    const result = await provider(fetchImpl, {}, { cache: knowing(DAX_ENTRY) }).synthesize('100 exp', DAX);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(call(fetchImpl).body.text).toBe('[Speak in American English] 100 exp');
    expect(result.timestamps).toEqual([
      { start: 0, end: 0.4, charStart: 0, charEnd: 3 },
      { start: 0.4, end: 0.56, charStart: 4, charEnd: 7 },
    ]);
    expect(result.note).toBe(`${MODEL_FREE}, language hint [Speak in American English]`);
  });

  it('adds no space of its own in front of a text that already starts with one', async () => {
    const fetchImpl = vi.fn(async () => stat());
    await provider(fetchImpl, {}, { cache: knowing(DAX_ENTRY) }).synthesize(' 100 exp', DAX);
    expect(call(fetchImpl).body.text).toBe('[Speak in American English] 100 exp');
  });

  it.each([
    ['2/50 HP', true],
    ['Level Up!', true],
    ['— 100 —', true],
    ['You gained 100 exp.', false],
    ['one two three four', false],
  ])('counts numbers and not punctuation: %j is hinted: %s', async (text, hinted) => {
    const fetchImpl = vi.fn(async () => stat());
    await provider(fetchImpl, {}, { cache: knowing(DAX_ENTRY) }).synthesize(text, DAX);
    expect(call(fetchImpl).body.text).toBe(hinted ? `[Speak in American English] ${text}` : text);
  });

  it('names an English voice without a region plainly', async () => {
    const fetchImpl = vi.fn(async () => stat());
    await provider(fetchImpl, {}, { cache: knowing({ ...DAX_ENTRY, locale: 'en' }) }).synthesize('100 exp', DAX);
    expect(call(fetchImpl).body.text).toBe('[Speak in English] 100 exp');
  });

  it('sends a short text bare on a voice of several languages, and on Default, which it never looks up', async () => {
    const several = vi.fn(async () => stat());
    await provider(several, {}, { cache: knowing(NARRATOR_ENTRY) }).synthesize('100 exp', NARRATOR);
    expect(call(several).body.text).toBe('100 exp');
    const byDefault = vi.fn(async () => stat());
    await provider(byDefault).synthesize('100 exp', DEFAULT);
    expect(byDefault).toHaveBeenCalledTimes(1);
    expect(call(byDefault).body.text).toBe('100 exp');
  });

  it('names a voice filed under one other language from its id, without asking anything', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['第', 0, 0.2], ['一', 0.2, 0.4], ['章', 0.4, 0.6]])));
    const zh = { voice: `zh/${ID_C}`, signal: controller.signal };
    await provider(fetchImpl).synthesize('第一章', zh);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(call(fetchImpl).body.text).toBe('[Speak in Chinese] 第一章');
    // Four characters are four words here (the owner's choice for #23), so no hint.
    await provider(fetchImpl).synthesize('第十一章', zh);
    expect(call(fetchImpl, 1).body.text).toBe('第十一章');
  });

  it('gives no hint for a language it cannot name', async () => {
    const fetchImpl = vi.fn(async () => stat());
    await provider(fetchImpl, {}, { cache: knowing({ ...DAX_ENTRY, locale: 'qq' }) }).synthesize('100 exp', DAX);
    expect(call(fetchImpl).body.text).toBe('100 exp');
  });

  it('asks the model once for a voice the session has not listed, and remembers the answer', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(`/model/${ID_B}`) ? Response.json({ ...model(ID_B, 'Dax', ['en']), tags: ['American'] }) : stat(),
    );
    const p = provider(fetchImpl);
    await p.synthesize('100 exp', DAX);
    await p.synthesize('2/50 HP', DAX);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `${FISH_API}/model/${ID_B}`,
      `${FISH_API}/v1/tts/stream/with-timestamp`,
      `${FISH_API}/v1/tts/stream/with-timestamp`,
    ]);
    expect(call(fetchImpl, 1).body.text).toBe('[Speak in American English] 100 exp');
    expect(call(fetchImpl, 2).body.text).toBe('[Speak in American English] 2/50 HP');
  });

  it('waits for a listing already on its way — the one the app starts with — instead of asking the model', async () => {
    const listing = deferred<Response>();
    const fetchImpl = vi.fn(async (url: string) => (url.includes(`author_id=${OFFICIAL_AUTHOR_ID}`) ? listing.promise : stat()));
    const p = provider(fetchImpl, { includeOwn: false, includeManual: false });
    const listed = p.listVoices();
    const spoken = p.synthesize('100 exp', DAX);
    await new Promise((resolve) => setTimeout(resolve, 0));
    listing.resolve(publicPage([model(ID_B, 'Dax American', ['en'])]));
    await Promise.all([listed, spoken]);
    expect(fetchImpl.mock.calls.map(([url]) => url)).not.toContain(`${FISH_API}/model/${ID_B}`);
    expect(call(fetchImpl, 1).body.text).toBe('[Speak in American English] 100 exp');
  });

  it('fails the utterance when the voice cannot be looked up, rather than sending it without its hint', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith(`/model/${ID_B}`)) throw new TypeError('Network request failed');
      return stat();
    });
    await expect(provider(fetchImpl).synthesize('100 exp', DAX)).rejects.toMatchObject({ kind: 'network' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never makes a long sentence wait on a lookup', async () => {
    const fetchImpl = vi.fn(async () => stat());
    await provider(fetchImpl).synthesize('You gained 100 exp today.', DAX);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(call(fetchImpl).body.text).toBe('You gained 100 exp today.');
  });

  it('sends the connection check bare, and looks nothing up', async () => {
    const fetchImpl = vi.fn(async () => stream(event(MP3_A, [['Hi', 0, 0.3]])));
    await provider(fetchImpl).checkSynthesis!(DAX.voice);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(call(fetchImpl).body.text).toBe('Hi');
  });
});
