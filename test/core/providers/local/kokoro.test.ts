import { describe, expect, it, vi } from 'vitest';
import { kokoroAdapter, localeForKokoroVoice } from '../../../../src/core/providers/local/kokoro';

const opts = { voice: 'af_bella', signal: new AbortController().signal };

/** Every pause before a 5xx is asked again is skipped in the tests; `waits` keeps what was asked for. */
let waits: number[] = [];

function provider(fetchImpl: unknown, wait = async (ms: number) => void waits.push(ms)) {
  return kokoroAdapter.create('http://localhost:8880', { fetch: fetchImpl as typeof fetch, wait });
}

/**
 * base64 of the bytes [1,2,3]. Kokoro's captioned route answers JSON, so these
 * arrive with no Content-Type at all and are read as the samples that were
 * asked for — nothing in them looks like a container (ADR 0013).
 */
const AUDIO_B64 = 'AQID';
/** What the plain route answers, with the type a server declares on it. */
const pcmResponse = (...values: number[]) => new Response(Uint8Array.from(values), { status: 200, headers: { 'Content-Type': 'audio/pcm' } });

describe('localeForKokoroVoice', () => {
  it('derives the locale from the voice id prefix', () => {
    expect(localeForKokoroVoice('af_bella')).toBe('en-US');
    expect(localeForKokoroVoice('am_adam')).toBe('en-US');
    expect(localeForKokoroVoice('bf_emma')).toBe('en-GB');
    expect(localeForKokoroVoice('zf_xiaobei')).toBe('zh-CN');
    expect(localeForKokoroVoice('jf_alpha')).toBe('ja-JP');
  });

  it('falls back to en-US for an unrecognized prefix', () => {
    expect(localeForKokoroVoice('qq_mystery')).toBe('en-US');
    expect(localeForKokoroVoice('nodelimiter')).toBe('en-US');
  });
});

describe('kokoroAdapter', () => {
  it('declares that it can produce word timestamps', () => {
    expect(kokoroAdapter.capabilities.wordTimestamps).toBe(true);
  });

  it('lists voices from the voices endpoint with derived locales', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voices: ['af_bella', 'zf_xiaobei'] }));
    const voices = await provider(fetchImpl).listVoices();

    expect((fetchImpl as any).mock.calls[0][0]).toBe('http://localhost:8880/v1/audio/voices');
    expect(voices).toEqual([
      { id: 'af_bella', label: 'af_bella', locale: 'en-US' },
      { id: 'zf_xiaobei', label: 'zf_xiaobei', locale: 'zh-CN' },
    ]);
  });

  // Current Kokoro-FastAPI answers `{ voices: [{ id, name }] }`; reading only
  // strings returned an empty list, so no local voice was ever offered
  it('accepts the object form of the voices list that current servers return', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ voices: [{ id: 'af_bella', name: 'Bella' }, { id: 'zf_xiaobei' }, { name: 'no id' }, 7] }),
    );
    const voices = await provider(fetchImpl).listVoices();
    expect(voices).toEqual([
      { id: 'af_bella', label: 'Bella', locale: 'en-US' },
      { id: 'zf_xiaobei', label: 'zf_xiaobei', locale: 'zh-CN' },
    ]);
  });

  // The caller bounds each provider's listing and aborts one that runs past
  // the bound, so the request must carry the caller's signal
  it("passes the caller's signal to the voice list request", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voices: ['af_bella'] }));
    const { signal } = new AbortController();
    await provider(fetchImpl).listVoices({ signal });
    expect((fetchImpl as any).mock.calls[0][1].signal).toBe(signal);
  });

  it("accepts an address written with the OpenAI SDK's /v1 suffix", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voices: [] }));
    await kokoroAdapter.create('http://localhost:8880/v1/', { fetch: fetchImpl as unknown as typeof fetch }).listVoices();
    expect((fetchImpl as any).mock.calls[0][0]).toBe('http://localhost:8880/v1/audio/voices');
  });

  it('posts to the captioned endpoint and decodes base64 audio', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ audio: AUDIO_B64, timestamps: [] }));
    const result = await provider(fetchImpl).synthesize('Hello', opts);

    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('http://localhost:8880/dev/captioned_speech');
    expect(JSON.parse(init.body)).toMatchObject({
      input: 'Hello',
      voice: 'af_bella',
      return_timestamps: true,
      // Samples, not mp3: ADR 0013, and Kokoro-FastAPI's format list has them
      response_format: 'pcm',
      // Without this the server streams newline-delimited JSON chunks,
      // which is not one JSON document and fails to parse
      stream: false,
    });
    // No speed: the clip is made at the voice's Natural Pace and the playback layer stretches it (ADR 0009)
    expect(JSON.parse(init.body)).not.toHaveProperty('speed');
    expect(result).toMatchObject({ audio: 'pcm', samples: Uint8Array.from([1, 2, 3]), sampleRate: 24_000 });
  });

  it('aligns returned word timings onto source character offsets', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        audio: AUDIO_B64,
        timestamps: [
          { word: 'Hello', start_time: 0, end_time: 0.5 },
          { word: 'world', start_time: 0.5, end_time: 1 },
        ],
      }),
    );
    const result = await provider(fetchImpl).synthesize('Hello world', opts);
    expect(result.timestamps).toEqual([
      { start: 0, end: 0.5, charStart: 0, charEnd: 5 },
      { start: 0.5, end: 1, charStart: 6, charEnd: 11 },
    ]);
    expect(result.note).toBeUndefined();
  });

  it('bridges a word the server spelled differently and says so in the note (issue #86)', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        audio: AUDIO_B64,
        timestamps: [
          { word: 'Hello', start_time: 0, end_time: 0.5 },
          { word: 'three', start_time: 0.5, end_time: 0.8 },
          { word: 'world', start_time: 0.8, end_time: 1 },
        ],
      }),
    );
    const result = await provider(fetchImpl).synthesize('Hello 3 world', opts);
    expect(result.timestamps).toEqual([
      { start: 0, end: 0.5, charStart: 0, charEnd: 5 },
      { start: 0.5, end: 0.8, charStart: 6, charEnd: 7 },
      { start: 0.8, end: 1, charStart: 8, charEnd: 13 },
    ]);
    expect(result.note).toBe('1 bridged');
  });

  it('omits timestamps, and says so, when none of the returned words is in the text', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ audio: AUDIO_B64, timestamps: [{ word: 'twenty', start_time: 0, end_time: 0.5 }] }));
    const result = await provider(fetchImpl).synthesize('29', opts);
    expect('timestamps' in result).toBe(false);
    expect(result.note).toBe('none of the 1 words the server returned is in the text');
  });

  // A server old enough to ignore `response_format` sends MP3 to a request that
  // asked for samples. Playing those bytes as samples would be noise out of the
  // speaker, so what the bytes actually are decides, not what was asked for.
  it('reports encoded bytes when the captioned reply carries a container instead of samples', async () => {
    const id3 = btoa('ID3\u0004\u0000\u0000');
    const fetchImpl = vi.fn(async () => Response.json({ audio: id3, timestamps: [{ word: 'Hello', start_time: 0, end_time: 0.5 }] }));
    const result = await provider(fetchImpl).synthesize('Hello', opts);
    expect(result).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg' });
    // The word timings are the server's own either way, and are still reported
    expect(result.timestamps).toEqual([{ start: 0, end: 0.5, charStart: 0, charEnd: 5 }]);
  });

  it('omits timestamps when the server returns none', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ audio: AUDIO_B64 }));
    const result = await provider(fetchImpl).synthesize('Hello', opts);
    expect('timestamps' in result).toBe(false);
  });

  it('falls back to the plain speech endpoint when captioned speech is missing', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(pcmResponse(9, 0));

    const result = await provider(fetchImpl).synthesize('Hello', opts);

    expect((fetchImpl as any).mock.calls[1][0]).toBe('http://localhost:8880/v1/audio/speech');
    expect(result).toMatchObject({ audio: 'pcm', samples: Uint8Array.from([9, 0]) });
    expect('timestamps' in result).toBe(false);
  });

  // A try is the captioned request and its fallback, as one synthesis always was (#237, ADR 0084)
  it('asks again when both routes answer a 5xx, 500 ms and then 1 s later, and says so in the note', async () => {
    waits = [];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ audio: AUDIO_B64, timestamps: [{ word: 'Hello', start_time: 0, end_time: 0.4 }] }));
    const result = await provider(fetchImpl).synthesize('Hello', opts);
    expect(result).toMatchObject({ audio: 'pcm', note: 'after 2 retries of HTTP 502, 503' });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(waits).toEqual([500, 1000]);
  });

  it('gives up after three tries in all, with the last status, and nothing for a Download to ask a fourth time', async () => {
    waits = [];
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    await expect(provider(fetchImpl).synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', retriable: false, message: 'Kokoro speech returned 503' });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    expect(waits).toEqual([500, 1000]);
  });

  it('does not ask again after a refusal that is not a 5xx, nor after a 5xx the plain route answered', async () => {
    waits = [];
    const missing = vi.fn(async () => new Response('', { status: 404 }));
    await expect(provider(missing).synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', message: 'Kokoro speech returned 404' });
    expect(missing).toHaveBeenCalledTimes(2);
    const fellBack = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(pcmResponse(9, 0));
    expect(await provider(fellBack).synthesize('Hello', opts)).toMatchObject({ note: '/dev/captioned_speech returned 503; fell back to /v1/audio/speech' });
    expect(waits).toEqual([]);
  });

  it('stops at once when the request is aborted during the pause', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }));
    const p = provider(fetchImpl, async () => { controller.abort(); });
    await expect(p.synthesize('Hello', { voice: 'af_bella', signal: controller.signal })).rejects.toMatchObject({ message: expect.stringMatching(/aborted/) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // This message is shown as it is: it names the address that was tried and
  // asks whether the server is running, with the system's reason after it
  it('reports a refused connection as local-server-down, naming the address', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('NetworkError when attempting to fetch resource.');
    });
    await expect(provider(fetchImpl).synthesize('Hello', opts)).rejects.toMatchObject({
      kind: 'local-server-down',
      message: 'Cannot reach Kokoro at http://localhost:8880. Is the server running? (TypeError: NetworkError when attempting to fetch resource.)',
    });
  });

  // #210. On the phone the system's reason is in the error's text (the shape
  // notes/NOTES_2026-09-22.md recorded at 22:12). When it is about the secure
  // connection, the server was reached or never asked, and the question would
  // send the owner to look at a server that is running.
  it('does not ask whether the server is running when the system refused the connection over its security', async () => {
    const reasons = [
      'A TLS error caused the secure connection to fail.',
      'An SSL error has occurred and a secure connection to the server cannot be made.',
      'The certificate for this server is invalid. You might be connecting to a server that is pretending to be “mac-mini.tailnet.ts.net” which could put your confidential information at risk.',
      'The resource could not be loaded because the App Transport Security policy requires the use of a secure connection.',
    ];
    for (const reason of reasons) {
      const fetchImpl = vi.fn(async () => {
        throw new Error(`fetch failed: UnexpectedException: ${reason}`);
      });
      await expect(provider(fetchImpl).synthesize('Hello', opts)).rejects.toMatchObject({
        kind: 'local-server-down',
        message: `Cannot reach Kokoro at http://localhost:8880. (Error: fetch failed: UnexpectedException: ${reason})`,
      });
    }
  });

  it('still asks when the system says the server could not be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed: UnexpectedException: Could not connect to the server.');
    });
    await expect(provider(fetchImpl).listVoices()).rejects.toMatchObject({
      message: 'Cannot reach Kokoro at http://localhost:8880. Is the server running? (Error: fetch failed: UnexpectedException: Could not connect to the server.)',
    });
  });

  it('reports invalid base64 audio as decode-failed', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ audio: 'not-valid-base64!!!', timestamps: [] }));
    await expect(provider(fetchImpl).synthesize('Hello', opts)).rejects.toMatchObject({
      kind: 'decode-failed',
    });
  });

  it('reports non-JSON listVoices response as decode-failed', async () => {
    const fetchImpl = vi.fn(async () => new Response('not json', { status: 200 }));
    await expect(provider(fetchImpl).listVoices()).rejects.toMatchObject({
      kind: 'decode-failed',
    });
  });

  it('falls back to plain endpoint when captioned response has no audio field', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ timestamps: [] }))
      .mockResolvedValueOnce(pcmResponse(7, 0));

    const result = await provider(fetchImpl).synthesize('Hello', opts);

    expect((fetchImpl as any).mock.calls[1][0]).toBe('http://localhost:8880/v1/audio/speech');
    expect(result).toMatchObject({ audio: 'pcm', samples: Uint8Array.from([7, 0]) });
    expect('timestamps' in result).toBe(false);
  });

  // An empty string is no audio either, and is not a silence to play (#235)
  it('falls back to the plain endpoint when the captioned audio is the empty string', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ audio: '', timestamps: [] }))
      .mockResolvedValueOnce(pcmResponse(7, 0));

    const result = await provider(fetchImpl).synthesize('Hello', opts);

    expect((fetchImpl as any).mock.calls[1][0]).toBe('http://localhost:8880/v1/audio/speech');
    expect(result).toMatchObject({ audio: 'pcm', samples: Uint8Array.from([7, 0]), note: 'the captioned reply had no audio; fell back to /v1/audio/speech' });
  });

  it('refuses a sentence neither route gave audio for, without asking again', async () => {
    waits = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ audio: '', timestamps: [] }))
      .mockResolvedValueOnce(new Response(new Uint8Array(0), { status: 200 }));

    await expect(provider(fetchImpl).synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'unknown', retriable: false, message: expect.stringMatching(/no audio/) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([]);
  });
});

describe('extra headers and gateways', () => {
  const headers = { 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' };
  const behindGateway = (fetchImpl: unknown) => kokoroAdapter.create('http://localhost:8880', { fetch: fetchImpl as typeof fetch, headers });

  it('sends the configured headers with the voice list and with every synthesis request', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/v1/audio/voices') ? Response.json({ voices: ['af_bella'] }) : Response.json({ audio: AUDIO_B64, timestamps: [] }),
    );
    const p = behindGateway(fetchImpl);
    await p.listVoices();
    await p.synthesize('Hello', opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of (fetchImpl as any).mock.calls) expect(init.headers).toMatchObject(headers);
    expect((fetchImpl as any).mock.calls[1][1].headers['Content-Type']).toBe('application/json');
  });

  it('reports rejected credentials as an auth problem, not as a server that is down', async () => {
    const forbidden = vi.fn(async () => new Response('', { status: 403 }));
    await expect(behindGateway(forbidden).listVoices()).rejects.toMatchObject({ kind: 'auth' });
    await expect(behindGateway(forbidden).synthesize('Hello', opts)).rejects.toMatchObject({ kind: 'auth' });
    // No fallback to /v1/audio/speech after a 403: it sits behind the same gateway
    expect(forbidden).toHaveBeenCalledTimes(2);
  });
});

// ---- a non-Kokoro server behind the Kokoro provider ------------------------

describe('checkWordTimestamps', () => {
  it('confirms word timestamps when the captioned endpoint answers with them', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ audio: AUDIO_B64, timestamps: [{ word: 'Test', start_time: 0, end_time: 0.4 }] }));
    const p = provider(fetchImpl);
    expect(await p.checkWordTimestamps!('af_bella')).toEqual({ ok: true });
    expect((fetchImpl as any).mock.calls[0][0]).toBe('http://localhost:8880/dev/captioned_speech');
    const payload = JSON.parse((fetchImpl as any).mock.calls[0][1].body);
    expect(payload.voice).toBe('af_bella');
    expect(payload.stream).toBe(false);
    expect(payload.return_timestamps).toBe(true);
  });

  it('names the missing endpoint and points at the OpenAI provider when the server is not Kokoro-FastAPI', async () => {
    const result = await provider(vi.fn(async () => new Response('nope', { status: 404 }))).checkWordTimestamps!('af_bella');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/\/dev\/captioned_speech returned 404/);
    expect(result.detail).toMatch(/OpenAI provider/);
  });

  it('says so when the endpoint answers without word timestamps', async () => {
    const result = await provider(vi.fn(async () => Response.json({ audio: AUDIO_B64, timestamps: [] }))).checkWordTimestamps!('af_bella');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/without word timestamps/);
  });

  it('treats a non-JSON 200 as a wrong server, not as a crash', async () => {
    const result = await provider(vi.fn(async () => new Response('RIFFbinary', { status: 200 }))).checkWordTimestamps!('af_bella');
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/OpenAI provider/);
  });

  it('propagates auth and server-down as errors, not as capability answers', async () => {
    await expect(provider(vi.fn(async () => new Response('no', { status: 403 }))).checkWordTimestamps!('af_bella')).rejects.toMatchObject({ kind: 'auth' });
    await expect(
      provider(
        vi.fn(async () => {
          throw new TypeError('NetworkError when attempting to fetch resource.');
        }),
      ).checkWordTimestamps!('af_bella'),
    ).rejects.toMatchObject({ kind: 'local-server-down' });
  });
});

describe('fallback notes', () => {
  it('notes why the timestamps are missing when it falls back to the plain endpoint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(pcmResponse(9, 0));
    const result = await provider(fetchImpl).synthesize('Hello', opts);
    expect(result.note).toMatch(/captioned_speech returned 404/);
  });

  it('notes a captioned answer that carried no word timestamps', async () => {
    const result = await provider(vi.fn(async () => Response.json({ audio: AUDIO_B64 }))).synthesize('Hello', opts);
    expect(result.note).toMatch(/without word timestamps/);
  });
});
