import { describe, expect, it, vi } from 'vitest';
import { PCM_SAMPLE_RATE } from '../../../src/core/providers/audio';
import { SynthesisError } from '../../../src/core/providers/errors';
import {
  FALLBACK_FORMAT,
  PCM_FORMAT,
  createOpenAICompatibleProvider,
  type OpenAICompatibleConfig,
  parseModelList,
  parseVoiceIds,
  parseVoiceList,
} from '../../../src/core/providers/openai-compatible';
import { OPENAI_DEFAULT_VOICES } from '../../../src/core/providers/openai';
import { MULTILINGUAL } from '../../../src/core/providers/types';

// The client the OpenAI and OpenAI Compatible sections share: what the caller
// says decides what the hostname used to — whether a key is required, the route
// the server synthesizes on, the voices it documents.
const cfg: OpenAICompatibleConfig = {
  id: 'openai-official',
  label: 'OpenAI',
  apiKey: 'sk-test',
  baseURL: 'https://api.openai.com',
  model: 'gpt-4o-mini-tts',
  keyRequired: true,
  route: 'speech',
  defaultVoices: OPENAI_DEFAULT_VOICES,
};

/** Every pause before a 5xx is asked again is skipped in the tests; `waits` keeps what was asked for. */
let waits: number[] = [];

/** A memory of PCM refusals of its own for each Provider, so no test inherits another's (#202). */
function provider(fetchImpl: unknown, over: Partial<OpenAICompatibleConfig> = {}, wait = async (ms: number) => void waits.push(ms)) {
  return createOpenAICompatibleProvider({ ...cfg, ...over }, { fetch: fetchImpl as typeof fetch, pcmRefusals: new Set(), wait });
}

const signalController = new AbortController();
const opts = { voice: 'alloy', signal: signalController.signal };

const notFound = () => new Response('', { status: 404 });

/**
 * Raw samples as the speech route answers them for `response_format: "pcm"`:
 * 16-bit signed little-endian mono, no container, no header.
 */
const samples = (...values: number[]) => new Response(Uint8Array.from(values), { status: 200, headers: { 'Content-Type': 'audio/pcm' } });
/** A server that only has MP3, which is what the decode fallback of ADR 0013 exists for. */
const mp3 = () => new Response(Uint8Array.from([0x49, 0x44, 0x33, 0x04]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
const formatOf = (fetchImpl: unknown, index = 0) => JSON.parse((fetchImpl as any).mock.calls[index][1].body).response_format;

describe('createOpenAICompatibleProvider', () => {
  it('carries the id it is given and declares that it cannot produce word timestamps', () => {
    expect(provider(vi.fn()).id).toBe('openai-official');
    expect(provider(vi.fn(), { id: 'compatible' }).id).toBe('compatible');
    expect(provider(vi.fn()).capabilities.wordTimestamps).toBe(false);
  });

  it('posts the text to the speech endpoint and returns the samples', async () => {
    const fetchImpl = vi.fn(async () => samples(1, 2, 3, 4));
    const result = await provider(fetchImpl).synthesize('Hello there', opts);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.signal).toBe(signalController.signal);
    // No speed: the clip is made at the voice's Natural Pace and the playback
    // layer stretches it (ADR 0009). PCM, not mp3: ADR 0013.
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-4o-mini-tts',
      voice: 'alloy',
      input: 'Hello there',
      response_format: 'pcm',
    });
    expect(result).toEqual({ audio: 'pcm', samples: Uint8Array.from([1, 2, 3, 4]), sampleRate: PCM_SAMPLE_RATE });
    expect('timestamps' in result).toBe(false);
  });

  // ADR 0013: PCM is what is requested, and decoding is the path that catches
  // the rest. A self-hosted server that has never heard of `response_format:
  // "pcm"` answers 400, and the clip still has to arrive.
  it('asks again for MP3 when the server refuses PCM, and says the bytes are encoded', async () => {
    const fetchImpl = vi.fn(async () => (formatOf(fetchImpl, (fetchImpl as any).mock.calls.length - 1) === PCM_FORMAT ? new Response('{"error":{"message":"unsupported response_format"}}', { status: 400 }) : mp3()));
    const result = await provider(fetchImpl).synthesize('Hello', opts);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(formatOf(fetchImpl, 0)).toBe(PCM_FORMAT);
    expect(formatOf(fetchImpl, 1)).toBe(FALLBACK_FORMAT);
    expect(result).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg', note: expect.stringMatching(/refused PCM/) });
  });

  // Only a fallback that worked proves the server cannot do PCM. A 400 about a
  // voice id it does not have must not latch the provider into MP3 for good,
  // and must surface as the message the server actually sent.
  it('reports the first refusal when the MP3 request fails too, and keeps asking for PCM', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Unknown voice: alloy' } }), { status: 400 }));
    const p = provider(fetchImpl);
    await expect(p.synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', message: expect.stringMatching(/Unknown voice: alloy/) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(p.synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown' });
    expect(formatOf(fetchImpl, 2)).toBe(PCM_FORMAT);
  });

  it('stops asking for PCM once a server has proved it cannot, so the 400 is paid for once', async () => {
    const fetchImpl = vi.fn(async () => (formatOf(fetchImpl, (fetchImpl as any).mock.calls.length - 1) === PCM_FORMAT ? new Response('', { status: 400 }) : mp3()));
    const p = provider(fetchImpl);
    await p.synthesize('One', opts);
    const result = await p.synthesize('Two', opts);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(formatOf(fetchImpl, 2)).toBe(FALLBACK_FORMAT);
    expect(result).toMatchObject({ audio: 'encoded', note: expect.stringMatching(/does not do PCM/) });
  });

  // #202. A Reading and a Download build a Provider for every sentence
  // (`synthesize` in src/offline/runtime.ts), so what one learned has to
  // outlive it: the module's memory, as Fish's voice cache and Speechify's
  // queue are. Each test here has an Address of its own, since the memory is shared.
  it('remembers the refusal across Provider objects built for the same Address and Model (#202)', async () => {
    const fetchImpl = vi.fn(async () => (formatOf(fetchImpl, (fetchImpl as any).mock.calls.length - 1) === PCM_FORMAT ? new Response('', { status: 422 }) : mp3()));
    const build = () => createOpenAICompatibleProvider({ ...cfg, id: 'compatible', baseURL: 'https://tts.home.example', model: 'm' }, { fetch: fetchImpl as unknown as typeof fetch });
    await build().synthesize('One', opts);
    await build().synthesize('Two', opts);
    await build().synthesize('Three', opts);
    expect((fetchImpl as any).mock.calls.map((_call: unknown, index: number) => formatOf(fetchImpl, index))).toEqual([PCM_FORMAT, FALLBACK_FORMAT, FALLBACK_FORMAT, FALLBACK_FORMAT]);
  });

  it('asks another Address, or another Model at the same one, for PCM again (#202)', async () => {
    const fetchImpl = vi.fn(async (url: string, init: { body: string }) =>
      JSON.parse(init.body).response_format === PCM_FORMAT && url.startsWith('https://mp3-only.example') && JSON.parse(init.body).model === 'm'
        ? new Response('', { status: 422 })
        : JSON.parse(init.body).response_format === PCM_FORMAT ? samples(1, 2) : mp3());
    const build = (baseURL: string, model: string) => createOpenAICompatibleProvider({ ...cfg, id: 'compatible', baseURL, model }, { fetch: fetchImpl as unknown as typeof fetch });
    await build('https://mp3-only.example', 'm').synthesize('One', opts);
    await build('https://pcm.example', 'm').synthesize('Two', opts);
    await build('https://mp3-only.example', 'other').synthesize('Three', opts);
    expect((fetchImpl as any).mock.calls.map((_call: unknown, index: number) => formatOf(fetchImpl, index))).toEqual([PCM_FORMAT, FALLBACK_FORMAT, PCM_FORMAT, PCM_FORMAT]);
  });

  // FastAPI answers a value outside a Literal with 422, not 400: the owner's
  // Chatterbox server refused `pcm` this way (#65, notes 2026-09-25 14:54).
  it('asks again for MP3 when the server refuses PCM with a 422, as FastAPI does (#65)', async () => {
    const detail = { detail: [{ type: 'literal_error', loc: ['body', 'response_format'], msg: "Input should be 'wav', 'opus' or 'mp3'", input: 'pcm' }] };
    const fetchImpl = vi.fn(async () => (formatOf(fetchImpl, (fetchImpl as any).mock.calls.length - 1) === PCM_FORMAT ? new Response(JSON.stringify(detail), { status: 422 }) : mp3()));
    const p = provider(fetchImpl);
    expect(await p.synthesize('One', opts)).toMatchObject({ audio: 'encoded', note: expect.stringMatching(/refused PCM/) });
    await p.synthesize('Two', opts);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(formatOf(fetchImpl, 2)).toBe(FALLBACK_FORMAT);
  });
  it('reports a 422 with the field and the server\'s message when the MP3 request fails too (#65)', async () => {
    const detail = { detail: [{ type: 'missing', loc: ['body', 'voice'], msg: 'Field required', input: null }] };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(detail), { status: 422 }));
    await expect(provider(fetchImpl).synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', message: 'OpenAI speech: HTTP 422 — voice: Field required' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // A refusal that is not a 400 is not a format problem: retrying it would
  // double the cost of every failure and hide the status that explains it.
  // A 5xx is the server's passing failure and is asked again (#237, below).
  it('never asks twice after a status other than 400, 422 or a 5xx', async () => {
    for (const status of [401, 403, 404, 429]) {
      const fetchImpl = vi.fn(async () => new Response('', { status }));
      await expect(provider(fetchImpl).synthesize('Hi', opts)).rejects.toBeInstanceOf(SynthesisError);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  // A server that answers PCM but resamples has to be able to say so, or every
  // word timing in the clip is scaled by the wrong factor
  it('takes the sample rate a server names, and reports a container as encoded', async () => {
    const resampled = vi.fn(async () => new Response(new Uint8Array(4), { status: 200, headers: { 'Content-Type': 'audio/L16;rate=16000' } }));
    expect(await provider(resampled).synthesize('Hi', opts)).toMatchObject({ audio: 'pcm', sampleRate: 16_000 });
    const wav = vi.fn(async () => new Response(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), { status: 200, headers: { 'Content-Type': 'audio/wav' } }));
    expect(await provider(wav).synthesize('Hi', opts)).toMatchObject({ audio: 'encoded', mediaType: 'audio/wav' });
  });

  it('refuses to synthesize without a key where one is required', async () => {
    const fetchImpl = vi.fn();
    await expect(provider(fetchImpl, { apiKey: '' }).synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'no-key', message: 'OpenAI API key is not set' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps failures to typed errors', async () => {
    const cases: [() => Promise<Response>, string][] = [
      [async () => new Response('', { status: 429 }), 'rate-limit'],
      [async () => new Response('', { status: 401 }), 'auth'],
      [async () => new Response('', { status: 500 }), 'unknown'],
      [
        async () => {
          throw new TypeError('NetworkError');
        },
        'network',
      ],
    ];
    for (const [fetchImpl, kind] of cases) {
      await expect(provider(vi.fn(fetchImpl)).synthesize('Hi', opts)).rejects.toMatchObject({ kind });
    }
  });

  // The OpenAI SDK documents base_url="http://localhost:8880/v1"; written
  // that way the provider must not request /v1/v1/audio/speech
  it("accepts a base URL written with the SDK's /v1 suffix", async () => {
    const fetchImpl = vi.fn(async () => samples(1));
    await provider(fetchImpl, { baseURL: 'http://localhost:8880/v1/' }).synthesize('Hi', opts);
    expect((fetchImpl as any).mock.calls[0][0]).toBe('http://localhost:8880/v1/audio/speech');
  });
});

// Many servers speak OpenAI's API with their own voices; the documented
// names must only be a last resort, never assumed
describe('listVoices', () => {
  it('uses the voices the user typed, without asking the server', async () => {
    const fetchImpl = vi.fn();
    const voices = await provider(fetchImpl, { voices: 'af_bella, zf_xiaobei;am_adam\naf_bella' }).listVoices();
    expect(voices).toEqual([
      { id: 'af_bella', label: 'af_bella', locale: MULTILINGUAL },
      { id: 'zf_xiaobei', label: 'zf_xiaobei', locale: MULTILINGUAL },
      { id: 'am_adam', label: 'am_adam', locale: MULTILINGUAL },
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('otherwise asks the server for its voice list, with the key', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voices: [{ id: 'af_bella', name: 'Bella' }, { id: 'am_adam' }] }));
    const voices = await provider(fetchImpl, { baseURL: 'http://localhost:8880' }).listVoices();
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('http://localhost:8880/v1/audio/voices');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(voices).toEqual([
      { id: 'af_bella', label: 'Bella', locale: MULTILINGUAL },
      { id: 'am_adam', label: 'am_adam', locale: MULTILINGUAL },
    ]);
  });

  it('falls back to the documented voices when the server has no voice list', async () => {
    const voices = await provider(vi.fn(notFound)).listVoices();
    expect(voices.map((v) => v.id)).toEqual([...OPENAI_DEFAULT_VOICES]);
    for (const voice of voices) expect(voice.locale).toBe(MULTILINGUAL);
  });

  it('falls back as well when the route answers something unusable', async () => {
    for (const fetchImpl of [
      vi.fn(async () => new Response('<html>', { status: 200 })),
      vi.fn(async () => Response.json({ voices: [] })),
      vi.fn(async () => Response.json({ unrelated: true })),
    ]) {
      const voices = await provider(fetchImpl).listVoices();
      expect(voices).toHaveLength(OPENAI_DEFAULT_VOICES.length);
    }
  });

  it('lists nothing at all when there are no documented voices either', async () => {
    expect(await provider(vi.fn(notFound), { defaultVoices: undefined }).listVoices()).toEqual([]);
  });

  it('reports a rejected key rather than listing default voices for it', async () => {
    await expect(provider(vi.fn(async () => new Response('', { status: 401 }))).listVoices()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('reports an unreachable server rather than listing default voices for it', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('NetworkError');
    });
    await expect(provider(fetchImpl).listVoices()).rejects.toMatchObject({ kind: 'network' });
  });

  // Issue #55: the catalog bounds each provider's listing and aborts one
  // that runs past the bound, so the request must carry the caller's signal
  it("passes the caller's signal to the voice list request", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voices: ['af_bella'] }));
    const { signal } = new AbortController();
    await provider(fetchImpl, { baseURL: 'http://localhost:8880' }).listVoices({ signal });
    expect((fetchImpl as any).mock.calls[0][1].signal).toBe(signal);
  });
});

describe('listModels / checkConnection', () => {
  it('asks the server for its model list, with the key', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ data: [{ id: 'tts-1' }, { id: 'gpt-4o-mini-tts' }] }));
    const models = await provider(fetchImpl).listModels!();
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(models).toEqual(['tts-1', 'gpt-4o-mini-tts']);
  });

  it('reports a rejected key', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => new Response('', { status }));
      await expect(provider(fetchImpl).listModels!()).rejects.toMatchObject({ kind: 'auth' });
      await expect(provider(fetchImpl).checkConnection!()).rejects.toMatchObject({ kind: 'auth' });
    }
  });

  it('reports an unreachable server', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.');
    });
    await expect(provider(fetchImpl).checkConnection!()).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports any other failure with its status', async () => {
    await expect(provider(vi.fn(async () => new Response('', { status: 500 }))).listModels!()).rejects.toThrow(/500/);
  });

  it('reports a missing key without calling the server', async () => {
    const fetchImpl = vi.fn();
    await expect(provider(fetchImpl, { apiKey: '' }).listModels!()).rejects.toMatchObject({ kind: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('tolerates a model list that is not JSON', async () => {
    expect(await provider(vi.fn(async () => new Response('ok', { status: 200 }))).listModels!()).toEqual([]);
  });
});

/**
 * #209. A 404 to both lists is what a server with only the speech route
 * answers, and what a web server with no speech API under the Address answers
 * too. So when neither list is published, the check asks the speech route
 * whether it is there, with a body that has nothing to speak: `{}`, which
 * FastAPI refuses with 422 before its handler runs (measured with a FastAPI
 * 0.143.3 app declaring Chatterbox-TTS-Server's request model, 2026-10-18).
 * A body naming a voice can be answered 404 by a real route: Chatterbox's
 * handler does so for a voice file it does not have.
 */
describe('checkConnection on a server that publishes neither list (#209)', () => {
  type Answer = (url: string, init: RequestInit) => Response;
  const server = (speech: Answer, lists: Answer = () => notFound()) => {
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
      asked.push(`${init.method ?? 'GET'} ${url}${init.body ? ` ${init.body}` : ''}`);
      return url.endsWith('/v1/audio/speech') ? speech(url, init) : lists(url, init);
    });
    return { fetchImpl, asked };
  };
  const compatible = (fetchImpl: unknown, baseURL = 'https://my-blog.example.com') => provider(fetchImpl, { id: 'compatible', label: 'OpenAI Compatible', apiKey: '', keyRequired: false, baseURL });

  it('fails at an Address with no speech API under it, naming the Address', async () => {
    const { fetchImpl, asked } = server(() => new Response('<h1>Not Found</h1>', { status: 404 }));
    await expect(compatible(fetchImpl).checkConnection!()).rejects.toMatchObject({
      message: 'OpenAI Compatible: nothing at https://my-blog.example.com answers /v1/audio/speech (HTTP 404). Check the Address.',
    });
    expect(asked).toEqual([
      'GET https://my-blog.example.com/v1/models',
      'GET https://my-blog.example.com/v1/audio/voices',
      'POST https://my-blog.example.com/v1/audio/speech {}',
    ]);
  });

  it('fails for a pasted speech endpoint, whose Address the message shows', async () => {
    const { fetchImpl } = server(() => notFound());
    await expect(compatible(fetchImpl, 'https://tts.example.com/v1/audio/speech').checkConnection!()).rejects.toThrow(
      'nothing at https://tts.example.com/v1/audio/speech answers /v1/audio/speech (HTTP 404)',
    );
  });

  it('fails when the speech route is not one a POST can reach, or is a web page', async () => {
    for (const answer of [new Response('', { status: 405 }), new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })]) {
      const { fetchImpl } = server(() => answer);
      await expect(compatible(fetchImpl).checkConnection!()).rejects.toThrow(/nothing at https:\/\/my-blog\.example\.com answers \/v1\/audio\/speech/);
    }
  });

  it('passes a server whose only route is the speech route, which refuses a body with nothing in it', async () => {
    const missing = { detail: [{ type: 'missing', loc: ['body', 'model'], msg: 'Field required', input: {} }] };
    for (const answer of [Response.json(missing, { status: 422 }), new Response('{"error":{"message":"you must provide a model parameter"}}', { status: 400 })]) {
      const { fetchImpl } = server(() => answer);
      await expect(compatible(fetchImpl).checkConnection!()).resolves.toBeUndefined();
    }
  });

  it('reports a key the speech route rejects', async () => {
    const { fetchImpl } = server(() => new Response('', { status: 401 }));
    await expect(compatible(fetchImpl).checkConnection!()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('sends no probe to a server that publishes a model list or a voice list', async () => {
    const models = server(() => notFound(), (url) => (url.endsWith('/v1/models') ? Response.json({ data: [{ id: 'm' }] }) : notFound()));
    await compatible(models.fetchImpl).checkConnection!();
    expect(models.asked).toEqual(['GET https://my-blog.example.com/v1/models']);

    const voices = server(() => notFound(), (url) => (url.endsWith('/v1/audio/voices') ? Response.json({ voices: ['Emily.wav'] }) : notFound()));
    await compatible(voices.fetchImpl).checkConnection!();
    expect(voices.asked).toEqual(['GET https://my-blog.example.com/v1/models', 'GET https://my-blog.example.com/v1/audio/voices']);
  });
});

describe('parsers', () => {
  it('parseVoiceIds splits on commas, semicolons and whitespace and drops duplicates', () => {
    expect(parseVoiceIds(' a, b;c\nd  a ')).toEqual(['a', 'b', 'c', 'd']);
    expect(parseVoiceIds('')).toEqual([]);
  });

  it('parseVoiceList reads the shapes OpenAI-compatible servers use', () => {
    expect(parseVoiceList({ voices: [{ id: 'x', name: 'X' }] })).toEqual([{ id: 'x', label: 'X' }]);
    expect(parseVoiceList({ voices: ['x', 'y'] })).toEqual([{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }]);
    expect(parseVoiceList({ data: [{ voice_id: 'v' }] })).toEqual([{ id: 'v', label: 'v' }]);
    expect(parseVoiceList(['a'])).toEqual([{ id: 'a', label: 'a' }]);
    expect(parseVoiceList({ voices: [{ name: 'only-name' }, {}, 7, ''] })).toEqual([{ id: 'only-name', label: 'only-name' }]);
    expect(parseVoiceList(null)).toEqual([]);
  });

  it('parseModelList reads OpenAI-style and bare lists', () => {
    expect(parseModelList({ data: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
    expect(parseModelList({ models: ['m'] })).toEqual(['m']);
    expect(parseModelList(['x', { id: 'y' }, 3])).toEqual(['x', 'y']);
    expect(parseModelList('nope')).toEqual([]);
  });
});

describe('SynthesisError', () => {
  it('carries the auth kind', () => {
    expect(new SynthesisError('auth').kind).toBe('auth');
  });
});

describe('checkSynthesis', () => {
  it('posts a tiny request to the speech endpoint with the configured model', async () => {
    const fetchImpl = vi.fn(async () => samples(1));
    await provider(fetchImpl).checkSynthesis!('alloy');
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hi' });
  });

  // OpenAI reports an exhausted balance as 429 insufficient_quota — the
  // same status as rate limiting, told apart only by the body
  it('tells quota exhaustion apart from rate limiting on 429', async () => {
    const quota = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }));
    await expect(provider(quota).checkSynthesis!('alloy')).rejects.toMatchObject({ kind: 'quota' });

    const rate = vi.fn(async () => new Response('slow down', { status: 429 }));
    await expect(provider(rate).checkSynthesis!('alloy')).rejects.toMatchObject({ kind: 'rate-limit' });
  });

  it('maps 401 to auth and an empty key to no-key without fetching', async () => {
    const rejected = vi.fn(async () => new Response('', { status: 401 }));
    await expect(provider(rejected).checkSynthesis!('alloy')).rejects.toMatchObject({ kind: 'auth' });

    const fetchImpl = vi.fn();
    await expect(provider(fetchImpl, { apiKey: '' }).checkSynthesis!('alloy')).rejects.toMatchObject({ kind: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('listModels on servers without a model list', () => {
  // Chatterbox-TTS-Server and friends answer 404 on /v1/models; that is
  // "no models published", not a broken connection
  it('treats 404/405 as an empty model list instead of a failure', async () => {
    for (const status of [404, 405]) {
      const fetchImpl = vi.fn(async () => new Response('', { status }));
      await expect(provider(fetchImpl).listModels!()).resolves.toEqual([]);
    }
  });

  it('still reports a rejected key', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await expect(provider(fetchImpl).listModels!()).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('extra headers and keyless servers', () => {
  it('sends the configured headers with every request, alongside Authorization', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v1/audio/voices')
        ? new Response(JSON.stringify({ voices: ['Emily.wav'] }), { status: 200 })
        : samples(1),
    );
    const headers = { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' };
    const p = provider(fetchImpl, { headers });
    await p.listVoices();
    await p.synthesize('Hello', opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of (fetchImpl as any).mock.calls) {
      expect(init.headers).toMatchObject({ ...headers, Authorization: 'Bearer sk-test' });
    }
  });

  it('lets a server go without a key when none is required, sending no Authorization at all', async () => {
    const fetchImpl = vi.fn(async () => samples(1));
    const p = provider(fetchImpl, { apiKey: '', baseURL: 'http://localhost:8004', keyRequired: false });
    await p.synthesize('Hello', opts);
    expect((fetchImpl as any).mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    await p.checkSynthesis!('Emily.wav');
    await p.listModels!();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('still insists on a key where the caller requires one, whatever the address', async () => {
    const fetchImpl = vi.fn();
    await expect(provider(fetchImpl, { apiKey: '', baseURL: 'http://localhost:8004', keyRequired: true }).synthesize('Hi', opts)).rejects.toMatchObject({
      kind: 'no-key',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// Some servers have no /v1/audio/speech at all — Xiaomi MiMo is one — and
// speak only through a chat completion with an `audio` object, the mp3 coming
// back as base64 inside the JSON reply.
describe('the chat completions route', () => {
  const chat: Partial<OpenAICompatibleConfig> = { route: 'chat', model: 'mimo-v2.5-tts', baseURL: 'https://api.xiaomimimo.com/v1', label: 'Xiaomi MiMo' };
  const audioReply = (bytes: string) =>
    new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', audio: { id: 'a1', data: btoa(bytes), transcript: null } } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  const textReply = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Hello!' } }] }), { status: 200 });

  it('posts the text as an assistant message with the audio object, and decodes the base64 mp3', async () => {
    const fetchImpl = vi.fn(async () => audioReply('mp3-bytes'));
    const result = await provider(fetchImpl, chat).synthesize('Hello there', { ...opts, voice: '冰糖' });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.signal).toBe(opts.signal);
    expect(JSON.parse(init.body)).toEqual({
      model: 'mimo-v2.5-tts',
      messages: [{ role: 'assistant', content: 'Hello there' }],
      audio: { format: 'mp3', voice: '冰糖' },
    });
    // This route carries base64 in JSON and names no sample rate, so its bytes
    // are reported as encoded rather than guessed at (ADR 0013)
    expect(result).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg' });
    expect(result.audio === 'encoded' && new TextDecoder().decode(result.bytes)).toBe('mp3-bytes');
    expect(result.timestamps).toBeUndefined();
    expect(result.note).toMatch(/chat\/completions/);
  });

  it('decodes binary audio faithfully', async () => {
    const bytes = Uint8Array.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x7f, 0x80, 0xfe]);
    const fetchImpl = vi.fn(async () => audioReply(String.fromCharCode(...bytes)));
    const result = await provider(fetchImpl, chat).synthesize('Hi', opts);
    expect(result.audio === 'encoded' && result.bytes).toEqual(bytes);
  });

  it('reports a reply without audio instead of handing the player empty bytes', async () => {
    await expect(provider(vi.fn(async () => textReply()), chat).synthesize('Hello', opts)).rejects.toMatchObject({
      kind: 'unknown',
      message: expect.stringMatching(/no audio/i),
    });
  });

  it('reports a reply that is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>not json</html>', { status: 200 }));
    await expect(provider(fetchImpl, chat).synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown' });
  });

  it('maps failures to typed errors, naming the route', async () => {
    const status = (code: number) => vi.fn(async () => new Response('', { status: code }));
    await expect(provider(status(401), chat).synthesize('x', opts)).rejects.toMatchObject({ kind: 'auth' });
    await expect(provider(status(429), chat).synthesize('x', opts)).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(provider(status(404), chat).synthesize('x', opts)).rejects.toMatchObject({
      kind: 'unknown',
      message: expect.stringMatching(/chat\/completions.*404/),
    });
    const offline = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(provider(offline, chat).synthesize('x', opts)).rejects.toMatchObject({ kind: 'network' });
  });

  it('goes keyless where no key is required, and insists on one where it is', async () => {
    const fetchImpl = vi.fn(async () => audioReply('x'));
    await provider(fetchImpl, { ...chat, apiKey: '', keyRequired: false }).synthesize('Hi', opts);
    expect((fetchImpl as any).mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    await expect(provider(vi.fn(), { ...chat, apiKey: '', keyRequired: true }).synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'no-key' });
  });

  describe('checkSynthesis', () => {
    it('probes the chat route with two characters and insists on audio back', async () => {
      const fetchImpl = vi.fn(async () => audioReply('x'));
      await provider(fetchImpl, chat).checkSynthesis!('mimo_default');
      const [url, init] = (fetchImpl as any).mock.calls[0];
      expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
      expect(JSON.parse(init.body)).toEqual({
        model: 'mimo-v2.5-tts',
        messages: [{ role: 'assistant', content: 'Hi' }],
        audio: { format: 'mp3', voice: 'mimo_default' },
      });
    });

    it('fails on a text-only reply, so a connection check says so before reading does', async () => {
      await expect(provider(vi.fn(async () => textReply()), chat).checkSynthesis!('mimo_default')).rejects.toMatchObject({
        kind: 'unknown',
        message: expect.stringMatching(/no audio/i),
      });
    });

    it('tells quota exhaustion apart from rate limiting on this route too', async () => {
      const quota = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 }));
      await expect(provider(quota, chat).checkSynthesis!('mimo_default')).rejects.toMatchObject({ kind: 'quota' });
    });
  });
});

describe("listVoices with a server's documented voices", () => {
  it('falls back to them when the server publishes no list', async () => {
    const voices = await provider(notFound, { defaultVoices: ['mimo_default', '冰糖'] }).listVoices();
    expect(voices).toEqual([
      { id: 'mimo_default', label: 'mimo_default', locale: MULTILINGUAL },
      { id: '冰糖', label: '冰糖', locale: MULTILINGUAL },
    ]);
  });

  it('still prefers what the user typed, then what the server publishes', async () => {
    expect((await provider(notFound, { defaultVoices: ['mimo_default'], voices: 'Mia' }).listVoices()).map((v) => v.id)).toEqual(['Mia']);
    const published = vi.fn(async () => new Response(JSON.stringify({ voices: ['Chloe'] }), { status: 200 }));
    expect((await provider(published, { defaultVoices: ['mimo_default'] }).listVoices()).map((v) => v.id)).toEqual(['Chloe']);
  });
});

// A refused request carries the server's own reason when it gives one in the
// OpenAI error shape — MiMo answers a wrong voice id with a 400 whose `param`
// lists the voices it has; OpenAI puts the detail in `message`.
describe("the server's reason for a refusal", () => {
  const chat: Partial<OpenAICompatibleConfig> = { route: 'chat', model: 'mimo-v2.5-tts', baseURL: 'https://api.xiaomimimo.com/v1' };
  const refused = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('quotes the longer of param and message after the status', async () => {
    const mimo = refused(400, { error: { code: '400', message: 'Param Incorrect', param: 'Unknown voice: alloy. Available voices: [mimo_default, 冰糖]', type: '' } });
    await expect(provider(mimo, chat).checkSynthesis!('alloy')).rejects.toMatchObject({
      kind: 'unknown',
      message: 'chat/completions audio: HTTP 400 — Unknown voice: alloy. Available voices: [mimo_default, 冰糖]',
    });
    const openai = refused(400, { error: { message: "Invalid value: 'nova2'. Supported values are: 'alloy', 'nova'.", type: 'invalid_request_error', param: 'voice', code: null } });
    await expect(provider(openai).synthesize('x', opts)).rejects.toMatchObject({
      message: "OpenAI speech: HTTP 400 — Invalid value: 'nova2'. Supported values are: 'alloy', 'nova'.",
    });
  });

  it('reads FastAPI\'s detail, a sentence or a list of fields and messages (#65)', async () => {
    await expect(provider(refused(404, { detail: 'Voice not found' })).synthesize('x', opts)).rejects.toMatchObject({ message: 'OpenAI speech: HTTP 404 — Voice not found' });
    const two = { detail: [{ loc: ['body', 'speed'], msg: 'Input should be less than 4' }, { loc: ['query'], msg: 'Extra inputs are not permitted' }] };
    await expect(provider(refused(422, two)).synthesize('x', opts)).rejects.toMatchObject({
      message: 'OpenAI speech: HTTP 422 — speed: Input should be less than 4; query: Extra inputs are not permitted',
    });
  });

  it('names the server the caller named', async () => {
    await expect(provider(vi.fn(async () => new Response('', { status: 502 })), { label: 'OpenAI Compatible' }).synthesize('x', opts)).rejects.toMatchObject({
      message: 'OpenAI Compatible speech: HTTP 502',
    });
  });

  it('leaves the message as the status alone when the body says nothing usable', async () => {
    await expect(provider(refused(400, { error: {} }), chat).synthesize('x', opts)).rejects.toMatchObject({ message: 'chat/completions audio: HTTP 400' });
    await expect(provider(vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 }))).synthesize('x', opts)).rejects.toMatchObject({
      message: 'OpenAI speech: HTTP 502',
    });
  });

  it('keeps auth and rate-limit refusals as they are', async () => {
    await expect(provider(refused(401, { error: { message: 'Invalid API Key' } }), chat).synthesize('x', opts)).rejects.toMatchObject({ kind: 'auth' });
    await expect(provider(refused(429, { error: { message: 'slow down' } }), chat).synthesize('x', opts)).rejects.toMatchObject({ kind: 'rate-limit' });
  });
});

describe("a 5xx, the server's passing failure (#237, ADR 0084)", () => {
  const chat: Partial<OpenAICompatibleConfig> = { route: 'chat', model: 'mimo-v2.5-tts', baseURL: 'https://api.xiaomimimo.com/v1' };
  const page = (status: number) => new Response('<!DOCTYPE html><title>Bad Gateway</title>', { status, headers: { 'Content-Type': 'text/html' } });
  /** Answers each status in turn, then what `then` gives. */
  const answering = (statuses: number[], then: () => Response) => {
    let n = 0;
    return vi.fn(async () => (n < statuses.length ? page(statuses[n++]) : then()));
  };
  const chatAudio = () => Response.json({ choices: [{ message: { audio: { data: btoa('mp3') } } }] });

  it('asks the speech route again, 500 ms and then 1 s later, and says so in the note', async () => {
    waits = [];
    const fetchImpl = answering([502, 503], () => samples(1, 2));
    expect(await provider(fetchImpl).synthesize('Hi', opts)).toMatchObject({ audio: 'pcm', note: 'after 2 retries of HTTP 502, 503' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 1000]);
  });

  it('asks once more after one 5xx, for OpenAI as for a server of the owner\'s', async () => {
    for (const status of [500, 502, 503, 504]) {
      waits = [];
      const fetchImpl = answering([status], () => samples(1, 2));
      expect(await provider(fetchImpl, { id: 'compatible', label: 'OpenAI Compatible' }).synthesize('Hi', opts)).toMatchObject({ note: `after a retry of HTTP ${status}` });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(waits).toEqual([500]);
    }
  });

  it('gives up after three tries in all, with the last status alone and nothing for a Download to ask a fourth time', async () => {
    waits = [];
    const fetchImpl = vi.fn(async () => page(503));
    await expect(provider(fetchImpl).synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'unknown', retriable: false, message: 'OpenAI speech: HTTP 503' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 1000]);
  });

  it('asks the chat route again too', async () => {
    waits = [];
    const fetchImpl = answering([502], chatAudio);
    expect(await provider(fetchImpl, chat).synthesize('Hi', opts)).toMatchObject({ audio: 'encoded', note: 'audio through /v1/chat/completions after a retry of HTTP 502' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const down = vi.fn(async () => page(500));
    await expect(provider(down, chat).synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'unknown', message: 'chat/completions audio: HTTP 500' });
    expect(down).toHaveBeenCalledTimes(3);
  });

  it('keeps the MP3 a server asked for after its refusal of PCM, when a 5xx comes between', async () => {
    waits = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unsupported response_format' } }), { status: 400 }))
      .mockResolvedValueOnce(mp3())
      .mockResolvedValueOnce(page(503))
      .mockResolvedValueOnce(mp3());
    const p = provider(fetchImpl);
    await p.synthesize('One', opts);
    expect(await p.synthesize('Two', opts)).toMatchObject({ audio: 'encoded', note: 'the server does not do PCM; asked for MP3 after a retry of HTTP 503' });
    expect([2, 3].map((i) => formatOf(fetchImpl, i))).toEqual([FALLBACK_FORMAT, FALLBACK_FORMAT]);
  });

  it('stops at once when the request is aborted during the pause, without asking again', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => page(503));
    const p = provider(fetchImpl, {}, async () => { controller.abort(); });
    await expect(p.synthesize('Hi', { voice: 'alloy', signal: controller.signal })).rejects.toMatchObject({ kind: 'unknown', message: expect.stringMatching(/aborted/) });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('a server that cannot be reached is named (#280)', () => {
  const offline = () => vi.fn(async () => { throw new TypeError('fetch failed: The Internet connection appears to be offline.'); });

  it('names the Address a sentence was asked of, on the speech route and on the chat route', async () => {
    await expect(provider(offline(), { id: 'compatible', label: 'OpenAI Compatible', baseURL: 'http://studio.local:8000/v1/' }).synthesize('Hi', opts)).rejects.toMatchObject({
      kind: 'network',
      message: 'Cannot reach http://studio.local:8000: TypeError: fetch failed: The Internet connection appears to be offline.',
    });
    await expect(provider(offline(), { route: 'chat', baseURL: 'https://api.xiaomimimo.com/v1' }).synthesize('Hi', opts)).rejects.toMatchObject({
      kind: 'network',
      message: expect.stringMatching(/^Cannot reach https:\/\/api\.xiaomimimo\.com: /),
    });
  });

  it('is not asked again: a connection that was never made is a Download\'s to retry, as before', async () => {
    const fetchImpl = offline();
    await expect(provider(fetchImpl).synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'network', retriable: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
