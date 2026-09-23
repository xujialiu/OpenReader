import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWarmConnections,
  KEEP_WARM_MS,
  originOf,
  QUIET_MS,
  WARM_UP_TIMEOUT_MS,
} from '../../src/core/warm-connections';

/**
 * The first request after a quiet spell, and the connection it would go over
 * (#26, ADR 0040).
 *
 * Measured on 2026-09-22 and 2026-09-23 (notes/NOTES_2026-09-22.md, 02:29;
 * notes/NOTES_2026-09-23.md, 12:57): a Provider's connection that has idled for
 * a minute or more can be dead, and the next request over it stalls for about
 * seven seconds and fails with "The network connection was lost". CFNetwork
 * retries a GET on a fresh connection; it never retries a POST, and every
 * synthesis is a POST. So a POST that follows a quiet spell is preceded by a GET
 * that nobody reads, and saved audio keeps the connection from going quiet.
 *
 * The network and the clock are fakes: every request is recorded, and a test
 * answers it when it wants to.
 */

interface Sent {
  url: string;
  method: string;
  init: RequestInit | undefined;
  answer(status?: number): void;
  refuse(error: Error): void;
}

function network() {
  const sent: Sent[] = [];
  /** Answered at once unless a test holds requests back. */
  let holding = false;
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
    return new Promise<Response>((resolve, reject) => {
      const request: Sent = {
        url,
        method,
        init,
        answer: (status = 200) => resolve(new Response(null, { status })),
        refuse: reject,
      };
      sent.push(request);
      if (!holding) request.answer();
    });
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    sent,
    /** What went out, in order, as `METHOD url`. */
    lines: () => sent.map((request) => `${request.method} ${request.url}`),
    hold() { holding = true; },
  };
}

function clock(at = 1_000_000) {
  return { now: () => at, pass(ms: number) { at += ms; }, set(value: number) { at = value; } };
}

/** Lets every settled promise run on. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const FISH = 'https://api.fish.audio';
const TTS = `${FISH}/v1/tts`;
const SYNTHESIS: RequestInit = {
  method: 'POST',
  headers: { Authorization: 'Bearer the-owners-key', model: 's2.1-pro-free', 'Content-Type': 'application/msgpack' },
  body: 'the sentence',
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the numbers', () => {
  it('warms after 30 s of quiet, keeps warm every 20 s, and waits for a warm-up at most 15 s', () => {
    // Below the 60 s after which the measured proxy drops an idle connection,
    // with room for a sentence or two of saved audio between two keep-warms.
    expect(QUIET_MS).toBe(30_000);
    expect(KEEP_WARM_MS).toBe(20_000);
    expect(WARM_UP_TIMEOUT_MS).toBe(15_000);
  });
});

describe('a request that is not a GET, after a quiet spell', () => {
  it('is preceded by exactly one GET to the origin root, carrying none of its headers', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`, { headers: { Authorization: 'Bearer the-owners-key' } });
    time.pass(QUIET_MS);
    const response = await warm.fetch(TTS, SYNTHESIS);

    expect(response.status).toBe(200);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`]);
    // No key, no model header, no body: a GET to the root spends nothing and
    // tells nobody anything (philosophy rule 3).
    const warmUp = net.sent[1].init!;
    expect(warmUp.headers).toBeUndefined();
    expect(warmUp.body).toBeUndefined();
    expect(warmUp.credentials).toBe('omit');
    // Its answer is not followed anywhere: the connection it proves is this origin's.
    expect(warmUp.redirect).toBe('manual');
    // The request itself goes out exactly as it was asked for.
    expect(net.sent[2].init).toBe(SYNTHESIS);
  });

  it('waits for the warm-up before it goes out', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(107_000);
    net.hold();
    const synthesis = warm.fetch(TTS, SYNTHESIS);
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`]);
    net.sent[1].answer(404);
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`]);
    net.sent[2].answer();
    expect((await synthesis).status).toBe(200);
  });

  it('shares one warm-up among requests sent together, as the read-ahead sends two', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(107_000);
    net.hold();
    const both = [warm.fetch(TTS, SYNTHESIS), warm.fetch(TTS, SYNTHESIS)];
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`]);
    net.sent[1].answer();
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`, `POST ${TTS}`]);
    net.sent[2].answer();
    net.sent[3].answer();
    await Promise.all(both);
  });

  it('counts a Request’s own method, in any case', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS);
    await warm.fetch(new Request(TTS, { method: 'POST', body: 'x' }));
    time.pass(QUIET_MS);
    await warm.fetch(TTS, { method: 'post', body: 'x' });
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`, `GET ${FISH}/`, `POST ${TTS}`]);
  });
});

describe('what goes straight out', () => {
  it('sends a request within 30 s of the last one straight out', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS - 1);
    await warm.fetch(TTS, SYNTHESIS);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `POST ${TTS}`]);
  });

  it('never warms before a GET, which CFNetwork retries on a fresh connection by itself', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(206_000);
    await warm.fetch(`${FISH}/model?page=2`);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/model?page=2`]);
  });

  it('warms nothing for an origin it has never reached, where no connection is waiting to be reused', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(TTS, SYNTHESIS);
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS);
    await warm.fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', body: '{}' });
    expect(net.lines()).toEqual([`POST ${TTS}`, `GET ${FISH}/model`, 'POST https://api.openai.com/v1/audio/speech']);
  });

  it('keeps each origin’s quiet to itself', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS);
    await warm.fetch('https://api.openai.com/v1/models');
    await warm.fetch(TTS, SYNTHESIS);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, 'GET https://api.openai.com/v1/models', `GET ${FISH}/`, `POST ${TTS}`]);
  });
});

describe('a warm-up that does not help', () => {
  it('lets the request go on when it is refused', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS);
    net.hold();
    const synthesis = warm.fetch(TTS, SYNTHESIS);
    await settle();
    net.sent[1].refuse(new TypeError('fetch failed: UnexpectedException: The network connection was lost.'));
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`]);
    net.sent[2].answer();
    expect((await synthesis).status).toBe(200);
  });

  it('lets the request go on after 15 s without an answer, and abandons the warm-up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS);
    net.hold();
    const synthesis = warm.fetch(TTS, SYNTHESIS);
    await settle();
    await vi.advanceTimersByTimeAsync(WARM_UP_TIMEOUT_MS - 1);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`]);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`]);
    expect(net.sent[1].init!.signal!.aborted).toBe(true);
    net.sent[2].answer();
    expect((await synthesis).status).toBe(200);
  });

  it('passes the request’s own answer and its own failure through unchanged', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    net.hold();
    const refused = warm.fetch(TTS, SYNTHESIS);
    await settle();
    const lost = new TypeError('The network connection was lost.');
    net.sent[0].refuse(lost);
    await expect(refused).rejects.toBe(lost);
  });
});

describe('contact', () => {
  it('is recorded when a request settles, not when it is sent', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    net.hold();
    const slow = warm.fetch(`${FISH}/model`);
    await settle();
    time.pass(20_000);
    net.sent[0].answer();
    await slow;
    // 45 s after it was sent, 25 s after it answered: not quiet.
    time.pass(25_000);
    const synthesis = warm.fetch(TTS, SYNTHESIS);
    await settle();
    net.sent[1].answer();
    await synthesis;
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `POST ${TTS}`]);
  });

  it('is recorded for a request that failed, which still used the connection', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    net.hold();
    const refused = warm.fetch(`${FISH}/model`);
    await settle();
    net.sent[0].refuse(new TypeError('refused'));
    await expect(refused).rejects.toThrow('refused');
    time.pass(QUIET_MS - 1);
    const synthesis = warm.fetch(TTS, SYNTHESIS);
    await settle();
    net.sent[1].answer();
    await synthesis;
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `POST ${TTS}`]);
  });
});

describe('keepWarm, while saved audio is being read', () => {
  it('sends at most one GET per 20 s of quiet, and waits for none of them', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    // A sentence from disk every few seconds; nothing goes out until 20 s of quiet.
    time.pass(KEEP_WARM_MS - 1);
    warm.keepWarm(FISH);
    expect(net.lines()).toEqual([`GET ${FISH}/model`]);
    net.hold();
    time.pass(1);
    expect(warm.keepWarm(FISH)).toBeUndefined();
    // Unanswered, and asked again: still the one GET.
    warm.keepWarm(FISH);
    time.pass(3_000);
    warm.keepWarm(FISH);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`]);
    net.sent[1].answer();
    await settle();
    // Its answer is contact: the next one is 20 s after it.
    time.pass(KEEP_WARM_MS - 1);
    warm.keepWarm(FISH);
    expect(net.sent).toHaveLength(2);
    time.pass(1);
    warm.keepWarm(FISH);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `GET ${FISH}/`]);
  });

  it('counts a warm-up that failed as contact, so a failing network is not asked again at every sentence', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(KEEP_WARM_MS);
    net.hold();
    warm.keepWarm(FISH);
    net.sent[1].refuse(new TypeError('fetch failed: UnexpectedException: The network connection was lost.'));
    await settle();
    time.pass(3_000);
    warm.keepWarm(FISH);
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`]);
  });

  it('sends nothing for an origin never reached', () => {
    const net = network();
    const warm = createWarmConnections({ fetch: net.fetch, now: clock().now });
    warm.keepWarm(FISH);
    expect(net.sent).toHaveLength(0);
  });

  it('is the warm-up a request after 30 s of quiet waits for, rather than a second one', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch(`${FISH}/model`);
    time.pass(QUIET_MS);
    net.hold();
    warm.keepWarm(FISH);
    const synthesis = warm.fetch(TTS, SYNTHESIS);
    await settle();
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`]);
    net.sent[1].answer();
    await settle();
    net.sent[2].answer();
    await synthesis;
    expect(net.lines()).toEqual([`GET ${FISH}/model`, `GET ${FISH}/`, `POST ${TTS}`]);
  });

  it('takes any address on the origin', async () => {
    const net = network();
    const time = clock();
    const warm = createWarmConnections({ fetch: net.fetch, now: time.now });
    await warm.fetch('http://localhost:8880/v1/audio/voices');
    time.pass(KEEP_WARM_MS);
    warm.keepWarm('http://localhost:8880/v1');
    expect(net.lines()).toEqual(['GET http://localhost:8880/v1/audio/voices', 'GET http://localhost:8880/']);
  });
});

describe('originOf', () => {
  it('is the scheme and the host, and the port when it is not the scheme’s own', () => {
    expect(originOf('https://api.fish.audio/v1/tts')).toBe('https://api.fish.audio');
    expect(originOf('http://localhost:8880/v1')).toBe('http://localhost:8880');
    expect(originOf('https://api.fish.audio:443/v1/tts')).toBe('https://api.fish.audio');
    expect(originOf('http://192.168.31.28:80')).toBe('http://192.168.31.28');
    expect(originOf('http://[::1]:8880/v1')).toBe('http://[::1]:8880');
    expect(originOf('https://api.fish.audio?key=1#top')).toBe('https://api.fish.audio');
  });

  it('reads an address as it is typed: any case, with spaces around it', () => {
    expect(originOf('  HTTPS://API.Fish.Audio/V1  ')).toBe('https://api.fish.audio');
  });

  it('never keeps a user name or password written into the address', () => {
    // The warm-up is sent to the origin, and credentials must not travel with it.
    expect(originOf('https://owner:secret@gateway.example/v1')).toBe('https://gateway.example');
  });

  it('reads a URL and a Request without asking either for an origin', () => {
    expect(originOf(new URL('https://api.openai.com/v1/audio/speech'))).toBe('https://api.openai.com');
    expect(originOf(new Request('https://api.speechify.ai/v1/audio/speech', { method: 'POST' }))).toBe('https://api.speechify.ai');
    expect(originOf({ url: 'https://api.fish.audio/v1/tts' })).toBe('https://api.fish.audio');
  });

  it('is null for anything that is not an http or https address', () => {
    expect(originOf('')).toBeNull();
    expect(originOf('api.fish.audio/v1/tts')).toBeNull();
    expect(originOf('/v1/tts')).toBeNull();
    expect(originOf('wss://eastasia.tts.speech.microsoft.com/cognitiveservices/websocket/v1')).toBeNull();
    expect(originOf('https:///nothing')).toBeNull();
  });
});
