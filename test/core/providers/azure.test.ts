import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AZURE_OUTPUT_FORMAT,
  CLOSE_GRACE_MS,
  RATE_LIMIT_WAITS_MS,
  RETRY_DELAY_MS,
  azureRegion,
  createAzureProvider,
  refusedStatus,
  type AzureDeps,
  type HeaderWebSocket,
} from '../../../src/core/providers/azure';
import { buildTextFrame, parseTextFrame } from '../../../src/core/providers/azure-ws';
import type { SynthesisResult } from '../../../src/core/providers/types';

/** A reply recorded from Azure on 2026-09-22 (notes/NOTES_2026-09-22.md): its text frames verbatim, its audio frames as lengths. */
type Frame = { text: string } | { audio: number };
type Recorded = { voice: string; text: string; audioHeader: string; frames: Frame[] };
const recorded = (name: string): Recorded => JSON.parse(readFileSync(new URL(`../../fixtures/azure/${name}`, import.meta.url), 'utf8'));

/**
 * What the next socket does, in the order sockets are opened:
 * - `open` opens and waits for the test to drive it;
 * - `refuse` is an upgrade refused with that status, as React Native reports
 *   one: a bare `error`, then a `close` 1006 whose reason is SocketRocket's
 *   text (notes/NOTES_2026-09-22.md, 14:45);
 * - `close` opens, then closes with that code and reason before any reply;
 * - `replay` opens and plays a recorded reply.
 */
type Behaviour = 'open' | { refuse: number } | { close: { code: number; reason: string } } | { replay: Recorded };

type Handler<E> = ((event: E) => void) | null;

class FakeSocket {
  static sockets: FakeSocket[] = [];
  static script: Behaviour[] = [];
  static get last(): FakeSocket {
    return FakeSocket.sockets[FakeSocket.sockets.length - 1];
  }

  sent: string[] = [];
  binaryType = '';
  closed = false;
  onopen: Handler<unknown> = null;
  onmessage: Handler<{ data: string | ArrayBuffer }> = null;
  onerror: Handler<unknown> = null;
  onclose: Handler<{ code: number; reason: string }> = null;

  constructor(
    readonly url: string,
    readonly protocols: unknown,
    readonly options: { headers: Record<string, string> },
  ) {
    FakeSocket.sockets.push(this);
    const behaviour = FakeSocket.script.shift() ?? 'open';
    queueMicrotask(() => this.begin(behaviour));
  }

  private begin(behaviour: Behaviour) {
    if (typeof behaviour === 'object' && 'refuse' in behaviour) {
      this.onerror?.({});
      this.onclose?.({ code: 1006, reason: `Received bad response code from server: ${behaviour.refuse}.` });
      return;
    }
    this.onopen?.({});
    if (behaviour === 'open') return;
    if ('close' in behaviour) queueMicrotask(() => this.onclose?.(behaviour.close));
    else queueMicrotask(() => this.replay(behaviour.replay));
  }

  send(data: string) {
    this.sent.push(data);
  }

  // Real sockets fire `close` after `close()` returns, never inside it
  close() {
    this.closed = true;
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: '' }));
  }

  audio(payload: Uint8Array, header = 'Path: audio\r\n') {
    const headerBytes = new TextEncoder().encode(header);
    const buf = new Uint8Array(2 + headerBytes.length + payload.length);
    new DataView(buf.buffer).setUint16(0, headerBytes.length, false);
    buf.set(headerBytes, 2);
    buf.set(payload, 2 + headerBytes.length);
    this.onmessage?.({ data: buf.buffer });
  }

  /** A word-boundary frame, audio frames in order, then the end of the turn. */
  respond(words: unknown[], ...chunks: number[][]) {
    if (words.length) this.onmessage?.({ data: buildTextFrame({ Path: 'audio.metadata' }, JSON.stringify({ Metadata: words })) });
    for (const chunk of chunks) this.audio(new Uint8Array(chunk));
    this.onmessage?.({ data: buildTextFrame({ Path: 'turn.end' }, '{}') });
  }

  replay(reply: Recorded) {
    for (const frame of reply.frames) {
      if ('text' in frame) this.onmessage?.({ data: frame.text });
      else this.audio(new Uint8Array(frame.audio), reply.audioHeader);
    }
  }
}

const boundary = (Text: string, offset: number, duration: number) => ({ Type: 'WordBoundary', Data: { Offset: offset, Duration: duration, text: { Text } } });
const cfg = { apiKey: 'key-1', region: 'eastasia' };
const opts = { voice: 'en-US-AvaNeural', signal: new AbortController().signal };
let wait: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;

function provider(over: Partial<AzureDeps> = {}, config = cfg) {
  return createAzureProvider(config, {
    fetch: vi.fn() as unknown as typeof fetch,
    getWebSocket: () => FakeSocket as unknown as HeaderWebSocket,
    newRequestId: () => 'req-1',
    wait,
    ...over,
  });
}

/** Lets the socket open and the request go out. */
async function opened() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

const pcm = (result: SynthesisResult) => {
  if (result.audio !== 'pcm') throw new Error(`expected pcm, got ${result.audio}`);
  return result;
};

beforeEach(() => {
  FakeSocket.sockets = [];
  FakeSocket.script = [];
  wait = vi.fn(async () => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAzureProvider', () => {
  it('declares that it can produce word timestamps', () => {
    expect(provider().capabilities.wordTimestamps).toBe(true);
    expect(provider().id).toBe('azure');
  });

  it('rejects with no-key before opening a socket when the key is empty', async () => {
    const getWebSocket = vi.fn();
    const p = provider({ getWebSocket: getWebSocket as never }, { ...cfg, apiKey: ' ' });
    await expect(p.synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'no-key' });
    expect(getWebSocket).not.toHaveBeenCalled();
  });

  it('refuses a missing or malformed region before anything goes out, so the key reaches no other host', async () => {
    const getWebSocket = vi.fn();
    await expect(provider({ getWebSocket: getWebSocket as never }, { ...cfg, region: '' }).synthesize('Hi', opts)).rejects.toThrow('region is not set');
    await expect(provider({ getWebSocket: getWebSocket as never }, { ...cfg, region: 'evil.example/#' }).synthesize('Hi', opts)).rejects.toThrow(
      '"evil.example/#" is not an Azure region id',
    );
    expect(getWebSocket).not.toHaveBeenCalled();
  });

  it('rejects immediately without opening a socket when the signal is already aborted', async () => {
    const getWebSocket = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(provider({ getWebSocket: getWebSocket as never }).synthesize('Hi', { ...opts, signal: controller.signal })).rejects.toMatchObject({
      kind: 'unknown',
    });
    expect(getWebSocket).not.toHaveBeenCalled();
  });

  // Azure answers asterisks with a clean `turn.end` and no audio, and bills the
  // turn anyway (the plugin's #42): nothing goes out, and the pause is silence
  it('sends nothing for text with no letter or digit, and answers with silence', async () => {
    const getWebSocket = vi.fn();
    const result = pcm(await provider({ getWebSocket: getWebSocket as never }).synthesize('*****', opts));
    expect(result.samples.length).toBe(0);
    expect(result.note).toBe('no speakable text');
    expect(getWebSocket).not.toHaveBeenCalled();
  });

  it("connects to the region's host with the key in a header, never in the URL, and sends config, context, then ssml", async () => {
    const pending = provider({}, { ...cfg, region: ' East Asia ' }).synthesize('Hello world', opts);
    await opened();

    const socket = FakeSocket.last;
    expect(socket.url).toBe('wss://eastasia.tts.speech.microsoft.com/cognitiveservices/websocket/v1?X-ConnectionId=req-1');
    expect(socket.url).not.toContain('key-1');
    expect(socket.options.headers).toEqual({ 'Ocp-Apim-Subscription-Key': 'key-1' });
    expect(socket.binaryType).toBe('arraybuffer');

    const frames = socket.sent.map((f) => parseTextFrame(f));
    expect(frames.map((f) => f.headers.Path)).toEqual(['speech.config', 'synthesis.context', 'ssml']);
    expect(frames.every((f) => f.headers['X-RequestId'] === 'req-1')).toBe(true);
    expect(JSON.parse(frames[0].body)).toEqual({ context: { system: { name: 'openreader' } } });
    expect(JSON.parse(frames[1].body).synthesis.audio).toEqual({
      metadataOptions: { wordBoundaryEnabled: true, sentenceBoundaryEnabled: false },
      outputFormat: AZURE_OUTPUT_FORMAT,
    });
    expect(frames[2].headers['Content-Type']).toBe('application/ssml+xml');
    expect(frames[2].body).toContain('<voice name="en-US-AvaNeural">Hello world</voice>');

    socket.respond([], [1, 2]);
    await pending;
  });

  it('returns the audio frames, in arrival order, as 24 kHz PCM', async () => {
    const pending = provider().synthesize('Hello', opts);
    await opened();
    // Chunks of differing lengths: an off-by-one in the concatenation would
    // misplace or drop bytes here and pass a single-chunk test
    FakeSocket.last.respond([], [1, 2], [3, 4, 5], [], [6]);

    const result = pcm(await pending);
    expect(Array.from(result.samples)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.sampleRate).toBe(24_000);
  });

  it('converts word boundaries into timestamps aligned to the source text', async () => {
    const pending = provider().synthesize('Hello world', opts);
    await opened();
    FakeSocket.last.respond([boundary('Hello', 0, 5_000_000), boundary('world', 5_000_000, 5_000_000)], [1, 2]);

    expect((await pending).timestamps).toEqual([
      { start: 0, end: 0.5, charStart: 0, charEnd: 5 },
      { start: 0.5, end: 1, charStart: 6, charEnd: 11 },
    ]);
  });

  it('omits timestamps entirely when no word boundary arrived', async () => {
    const pending = provider().synthesize('Hello', opts);
    await opened();
    FakeSocket.last.respond([], [1, 2]);

    const result = await pending;
    // True key absence, not an undefined value: the key's absence is what says
    // the clip is highlighted whole
    expect('timestamps' in result).toBe(false);
    expect(result.note).toContain('no word boundaries');
  });

  // The `:DragonLatestNeural` voices pin every boundary after about 9.5 s to
  // one instant (the plugin's #69); the page would light the last word there
  // and hold it while the voice went on (ADR 0037)
  it('drops the timings of a clip whose last words are pinned to one instant, and says so', async () => {
    const pending = provider().synthesize('one two three four five', opts);
    await opened();
    FakeSocket.last.respond(
      [boundary('one', 0, 3_000_000), boundary('two', 3_000_000, 3_000_000), boundary('three', 95_900_000, 0), boundary('four', 95_900_000, 0), boundary('five', 95_900_000, 0)],
      [1, 2],
    );

    const result = await pending;
    expect('timestamps' in result).toBe(false);
    expect(result.note).toContain('the last 3 of 5 word boundaries all at 9.59 s');
  });

  it('rejects when speakable text comes back with no audio, rather than playing it as a pause', async () => {
    const pending = provider().synthesize('Hello', opts);
    await opened();
    FakeSocket.last.respond([boundary('Hello', 0, 5_000_000)]);
    await expect(pending).rejects.toMatchObject({ kind: 'unknown', message: expect.stringContaining('no audio') });
  });

  it('closes the socket once the turn ends, and a later close does not undo the result', async () => {
    const pending = provider().synthesize('Hello', opts);
    await opened();
    const socket = FakeSocket.last;
    socket.respond([], [1, 2]);

    const result = await pending;
    expect(socket.closed).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    await expect(pending).resolves.toBe(result);
  });

  it('closes the socket and rejects when the signal aborts mid-turn', async () => {
    const controller = new AbortController();
    const pending = provider().synthesize('Hello', { ...opts, signal: controller.signal });
    await opened();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'unknown', message: 'aborted' });
    expect(FakeSocket.last.closed).toBe(true);
  });

  it('rejects instead of hanging when sending the request throws', async () => {
    class ThrowOnSendSocket extends FakeSocket {
      send(): void {
        throw new Error('send failed');
      }
    }
    const p = provider({ getWebSocket: () => ThrowOnSendSocket as unknown as HeaderWebSocket });
    await expect(p.synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('rejects with a SynthesisError when the WebSocket constructor throws', async () => {
    class ThrowingSocket {
      constructor() {
        throw new Error('bad url');
      }
    }
    const p = provider({ getWebSocket: () => ThrowingSocket as unknown as HeaderWebSocket });
    await expect(p.synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', message: expect.stringContaining('bad url') });
  });

  it('rejects instead of hanging when a binary frame is truncated', async () => {
    const pending = provider().synthesize('Hello', opts);
    await opened();
    FakeSocket.last.onmessage?.({ data: new ArrayBuffer(1) });
    await expect(pending).rejects.toMatchObject({ kind: 'unknown' });
  });
});

describe('replies recorded from Azure (notes/NOTES_2026-09-22.md)', () => {
  async function speak(name: string) {
    const reply = recorded(name);
    FakeSocket.script = [{ replay: reply }];
    const result = pcm(await provider().synthesize(reply.text, { ...opts, voice: reply.voice }));
    const spans = (result.timestamps ?? []).map((t) => reply.text.slice(t.charStart, t.charEnd));
    return { reply, result, spans };
  }

  it('an English voice: every word timed, the number spoken with its unit as one', async () => {
    const { result, spans } = await speak('andrew-neural.json');
    // 215,400 bytes, the last frame empty: 4.4875 s at 24 kHz
    expect(result.samples.length).toBe(215_400);
    // One span over both words the boundary names; punctuation is lit by no word
    expect(spans).toEqual(['The', 'price', 'rose', 'to', '29.83 dollars', 'said', 'Dr', 'Smith']);
    expect(result.timestamps![4]).toMatchObject({ start: 0.925, end: 2.925 });
    expect(result.timestamps!.at(-1)!.end).toBe(4.175);
  });

  it('a Chinese voice whose boundaries arrived after their audio: timed by word', async () => {
    const { result, spans } = await speak('xiaoxiao-neural.json');
    expect(result.samples.length).toBe(216_000);
    expect(spans).toEqual(['你好', '世界', '今天', '是', '二', '〇', '二', '六', '年', '九月']);
  });

  it('an HD Flash voice: its boundaries, half of them with the last audio, all timed', async () => {
    const { result, spans } = await speak('jimmie-hd-flash.json');
    expect(result.samples.length).toBe(188_160);
    expect(spans).toHaveLength(8);
  });

  it('a MAI-Voice-2 voice: audio and no word boundaries, so highlighted whole', async () => {
    const { result } = await speak('ethan-mai-voice-2.json');
    expect(result.samples.length).toBe(214_080);
    expect('timestamps' in result).toBe(false);
    expect(result.note).toBe('en-US-Ethan:MAI-Voice-2: no word boundaries');
  });
});

describe('when Azure refuses', () => {
  it('reads a 401 as the key or the region, and asks once', async () => {
    FakeSocket.script = [{ refuse: 401 }];
    const err = await provider().synthesize('Hello', opts).catch((e) => e);
    expect(err).toMatchObject({ kind: 'auth' });
    expect(err.message).toContain('the region eastasia');
    expect(err.message).toContain('Check the key and the region');
    expect(FakeSocket.sockets).toHaveLength(1);
  });

  it("reads a 403 on a synthesis as the month's characters", async () => {
    FakeSocket.script = [{ refuse: 403 }];
    await expect(provider().synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'quota' });
  });

  it('waits 1, 2, 4, 8 and 16 s between refusals for too many requests, then reports', async () => {
    FakeSocket.script = Array.from({ length: 6 }, () => ({ refuse: 429 }));
    const err = await provider().synthesize('Hello', opts).catch((e) => e);
    expect(err).toMatchObject({ kind: 'rate-limit', retriable: true });
    expect(err.message).toContain('after 31 s of waiting');
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([...RATE_LIMIT_WAITS_MS]);
    expect(FakeSocket.sockets).toHaveLength(6);
  });

  it('speaks once a refusal for too many requests has been waited out, and says it waited', async () => {
    FakeSocket.script = [{ refuse: 429 }, { close: { code: 4429, reason: 'Exceeded the concurrent request limit' } }, 'open'];
    const pending = provider().synthesize('Hello', opts);
    await vi.waitFor(() => expect(FakeSocket.sockets).toHaveLength(3));
    await opened();
    FakeSocket.last.respond([], [1, 2]);

    const result = await pending;
    expect(result.note).toContain('after 2 rate-limit waits');
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000]);
  });

  it('asks a 5xx once more after a pause, then reports it', async () => {
    FakeSocket.script = [{ refuse: 503 }, { refuse: 503 }];
    await expect(provider().synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', message: 'Azure answered HTTP 503.' });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([RETRY_DELAY_MS]);
    expect(FakeSocket.sockets).toHaveLength(2);
  });

  it('names the voice when Azure closes with 1007', async () => {
    FakeSocket.script = [{ close: { code: 1007, reason: 'Unsupported voice en-US-Nobody.' } }];
    await expect(provider().synthesize('Hello', { ...opts, voice: 'en-US-Nobody' })).rejects.toMatchObject({
      kind: 'unknown',
      message: 'Azure does not offer the voice en-US-Nobody (1007 Unsupported voice en-US-Nobody.).',
    });
  });

  it('reports a connection that ended before the speech did as a network failure, with its reason', async () => {
    FakeSocket.script = [{ close: { code: 1006, reason: 'The Internet connection appears to be offline.' } }];
    await expect(provider().synthesize('Hello', opts)).rejects.toMatchObject({
      kind: 'network',
      message: 'The connection to Azure ended before the speech did (1006 The Internet connection appears to be offline.).',
    });
  });

  it('settles an error that no close follows, rather than waiting for ever', async () => {
    vi.useFakeTimers();
    const pending = provider().synthesize('Hello', opts);
    const settled = pending.catch((e) => e);
    await opened();
    FakeSocket.last.onerror?.({});
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
    expect(await settled).toMatchObject({ kind: 'network' });
  });
});

describe('listVoices', () => {
  it('maps each voice to its own name and locale, with the multilingual ones under mul', async () => {
    const body = [
      { ShortName: 'en-US-AndrewNeural', DisplayName: 'Andrew', LocalName: 'Andrew', Locale: 'en-US' },
      { ShortName: 'zh-CN-XiaoxiaoNeural', DisplayName: 'Xiaoxiao', LocalName: '晓晓', Locale: 'zh-CN' },
      { ShortName: 'zh-CN-guangxi-YunqiNeural', DisplayName: 'Yunqi', LocalName: '云奇 广西', Locale: 'zh-CN-guangxi' },
      { ShortName: 'en-US-AvaMultilingualNeural', DisplayName: 'Ava Multilingual', LocalName: 'Ava Multilingual', Locale: 'en-US' },
      { ShortName: 'zh-CN-XiaoxiaoMultilingualNeural', DisplayName: 'Xiaoxiao Multilingual', LocalName: '晓晓 多语言', Locale: 'zh-CN' },
      // Named for one locale, so found there, whatever its metadata says it speaks
      { ShortName: 'en-US-Ethan:MAI-Voice-2', DisplayName: 'Ethan MAI-Voice-2', LocalName: 'Ethan MAI-Voice-2', Locale: 'en-US', SecondaryLocaleList: ['zh-CN'] },
      { ShortName: 'ja-JP-NanamiNeural', Locale: 'ja-JP' },
      { DisplayName: 'no id', Locale: 'en-US' },
    ];
    const fetchImpl = vi.fn(async () => Response.json(body));

    expect(await provider({ fetch: fetchImpl as unknown as typeof fetch }).listVoices()).toEqual([
      { id: 'en-US-AndrewNeural', label: 'Andrew', locale: 'en-US' },
      { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓', locale: 'zh-CN' },
      { id: 'zh-CN-guangxi-YunqiNeural', label: '云奇 广西', locale: 'zh-CN-guangxi' },
      { id: 'en-US-AvaMultilingualNeural', label: 'Ava Multilingual', locale: 'mul' },
      { id: 'zh-CN-XiaoxiaoMultilingualNeural', label: '晓晓 多语言', locale: 'mul' },
      { id: 'en-US-Ethan:MAI-Voice-2', label: 'Ethan MAI-Voice-2', locale: 'en-US' },
      { id: 'ja-JP-NanamiNeural', label: 'ja-JP-NanamiNeural', locale: 'ja-JP' },
    ]);

    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://eastasia.tts.speech.microsoft.com/cognitiveservices/voices/list');
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('key-1');
  });

  it("passes the caller's signal to the request", async () => {
    const fetchImpl = vi.fn(async () => Response.json([]));
    const { signal } = new AbortController();
    await provider({ fetch: fetchImpl as unknown as typeof fetch }).listVoices({ signal });
    expect((fetchImpl as any).mock.calls[0][1].signal).toBe(signal);
  });

  it('rejects with no-key before fetching when the key is empty', async () => {
    const fetchImpl = vi.fn();
    await expect(provider({ fetch: fetchImpl as unknown as typeof fetch }, { ...cfg, apiKey: '' }).listVoices()).rejects.toMatchObject({ kind: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a 401 or a 403 as the key, naming the region a 401 was refused in', async () => {
    const answer = (status: number) => provider({ fetch: vi.fn(async () => new Response('', { status })) as unknown as typeof fetch }).listVoices();
    await expect(answer(401)).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('the region eastasia') });
    await expect(answer(403)).rejects.toMatchObject({ kind: 'auth' });
    await expect(answer(500)).rejects.toMatchObject({ kind: 'unknown', message: 'Azure answered HTTP 500.' });
  });

  it('names the host it could not reach, which is where a mistyped region shows', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(provider({ fetch: fetchImpl as unknown as typeof fetch }, { ...cfg, region: 'eastasiaa' }).listVoices()).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringContaining('eastasiaa.tts.speech.microsoft.com'),
    });
  });

  it('rejects a reply that is not a list of voices', async () => {
    await expect(provider({ fetch: vi.fn(async () => new Response('nope')) as unknown as typeof fetch }).listVoices()).rejects.toMatchObject({ kind: 'unknown' });
    await expect(provider({ fetch: vi.fn(async () => Response.json({})) as unknown as typeof fetch }).listVoices()).rejects.toMatchObject({ kind: 'unknown' });
  });
});

describe('azureRegion', () => {
  it('makes what was typed a region id: no whitespace, lower case', () => {
    expect(azureRegion('eastasia')).toBe('eastasia');
    expect(azureRegion(' East Asia ')).toBe('eastasia');
    expect(azureRegion('West US 2')).toBe('westus2');
  });

  it('refuses anything that is not letters and digits, or nothing at all', () => {
    for (const typed of ['', '  ', 'east-asia', 'eastasia.', 'evil.example/#', 'east_asia', 'ëastasia']) expect(azureRegion(typed), typed).toBeNull();
  });
});

describe('refusedStatus', () => {
  it("finds the status in SocketRocket's text, and nothing where there is none", () => {
    expect(refusedStatus('Received bad response code from server: 401.')).toBe(401);
    expect(refusedStatus('Request failed with response code 429')).toBe(429);
    expect(refusedStatus('The Internet connection appears to be offline.')).toBeNull();
    expect(refusedStatus('')).toBeNull();
  });
});
