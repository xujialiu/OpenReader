import { describe, expect, it, vi } from 'vitest';

import { createMemoryCache } from '../../src/core/memory-cache';
import { SynthesisError } from '../../src/core/providers/errors';
import type { SynthesisResult, TTSProvider } from '../../src/core/providers/types';
import { clipCacheKey, toStored, type StoredClip } from '../../src/playback/clip-cache';
import { createClipFetcher, prepareClip, silence, type ClipProvider } from '../../src/playback/clips';

/**
 * Where the owner's money is spent, so it is where the promises about spending
 * it are tested: text that is not Speakable never reaches a Provider, a cached
 * Clip is not fetched again, the same text is not fetched twice at once, and a
 * request that never answers fails rather than hanging.
 */

const pcm = (frames: number, extra: Partial<SynthesisResult> = {}): SynthesisResult => ({
  audio: 'pcm',
  samples: new Uint8Array(frames * 2),
  sampleRate: 24_000,
  ...extra,
} as SynthesisResult);

/** A Provider that records what it was asked for. `fetch` is refused globally by test/setup.ts, so nothing here can reach the network by accident. */
function fakeProvider(synthesize: (text: string) => Promise<SynthesisResult>) {
  const asked: string[] = [];
  const provider: TTSProvider = {
    id: 'speechify',
    capabilities: { wordTimestamps: true },
    listVoices: async () => [],
    synthesize: (text) => {
      asked.push(text);
      return synthesize(text);
    },
  };
  return { provider, asked };
}

const cache = () => createMemoryCache<StoredClip>({ maxBytes: 1_000_000 });

describe('prepareClip', () => {
  it('turns pcm into samples at the rate the Provider reported', () => {
    const clip = prepareClip(3, pcm(120));
    expect(clip.audio).toBe('samples');
    if (clip.audio !== 'samples') throw new Error('unreachable');
    expect(clip.samples.length).toBe(120);
    expect(clip.sampleRate).toBe(24_000);
    expect(clip.utterance).toBe(3);
  });

  it('keeps encoded bytes as bytes, because the decoder is in the graph (ADR 0013)', () => {
    const clip = prepareClip(0, { audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' });
    expect(clip.audio).toBe('encoded');
    if (clip.audio !== 'encoded') throw new Error('unreachable');
    expect(clip.mediaType).toBe('audio/mpeg');
  });

  it('carries the Word Timings through unscaled', () => {
    // Scaling happens once per Clip, on the way to the renderer (rate.ts).
    const timestamps = [{ start: 0, end: 1, charStart: 0, charEnd: 4 }];
    expect(prepareClip(0, pcm(10, { timestamps })).words).toEqual(timestamps);
  });

  it('reads an empty timings array as no timings', () => {
    expect(prepareClip(0, pcm(10, { timestamps: [] })).words).toBeNull();
  });

  it('turns a reply with no samples into silence', () => {
    // Speechify answers unspeakable text with zero samples and a note saying so,
    // and AudioBuffer refuses a length of zero — "The number of frames provided
    // (0) is less than or equal to the minimum bound" — so this has to become
    // something playable before it reaches the graph.
    const clip = prepareClip(5, pcm(0, { note: 'no speakable text' }));
    expect(clip.audio).toBe('silence');
    expect(clip.utterance).toBe(5);
  });

  it('turns an empty encoded reply into silence too', () => {
    const clip = prepareClip(0, { audio: 'encoded', bytes: new Uint8Array(0), mediaType: 'audio/mpeg' });
    expect(clip.audio).toBe('silence');
  });
});

describe('silence', () => {
  it('lasts a beat and carries no timings', () => {
    const clip = silence(2);
    expect(clip.audio).toBe('silence');
    if (clip.audio !== 'silence') throw new Error('unreachable');
    expect(clip.seconds).toBeCloseTo(0.3, 12);
    expect(clip.words).toBeNull();
  });
});

describe('createClipFetcher', () => {
  it('never sends text that is not Speakable to a Provider', async () => {
    // CONTEXT.md: "Text that is not speakable is never sent to a provider; it
    // becomes silence." The plugin measured the price of asking anyway: 60
    // seconds and a 502 from Speechify for `* * *`.
    const { provider, asked } = fakeProvider(async () => pcm(10));
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: cache() });
    const clip = await fetcher.fetch(9, '* * *', false);
    expect(clip.audio).toBe('silence');
    expect(asked).toEqual([]);
  });

  it('asks the Provider once and answers from the cache afterwards', async () => {
    const store = cache();
    const { provider, asked } = fakeProvider(async () => pcm(24));
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: store });
    await fetcher.fetch(0, 'Call me Ishmael.', true);
    await fetcher.fetch(0, 'Call me Ishmael.', true);
    expect(asked).toEqual(['Call me Ishmael.']);
  });

  it('files the Clip under provider, voice and text', async () => {
    const store = cache();
    const { provider } = fakeProvider(async () => pcm(24));
    await createClipFetcher({ provider, voice: 'ava', cache: store }).fetch(0, 'Hello.', true);
    expect(await store.match(clipCacheKey('speechify', 'ava', 'Hello.'))).not.toBeNull();
  });

  it('answers a Voice change from the Provider rather than from another Voice’s Clip', async () => {
    const store = cache();
    const { provider, asked } = fakeProvider(async () => pcm(24));
    await createClipFetcher({ provider, voice: 'ava', cache: store }).fetch(0, 'Hello.', true);
    await createClipFetcher({ provider, voice: 'kate', cache: store }).fetch(0, 'Hello.', true);
    expect(asked).toEqual(['Hello.', 'Hello.']);
  });

  it('synthesizes a repeated sentence once, however many Utterances ask at once', async () => {
    // A refrain, or a heading that recurs. Two concurrent fetches of the same
    // text would otherwise both be billed (ADR 0002, philosophy rule 4).
    let release!: (result: SynthesisResult) => void;
    const pending = new Promise<SynthesisResult>((resolve) => {
      release = resolve;
    });
    const { provider, asked } = fakeProvider(async () => pending);
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: cache() });
    const first = fetcher.fetch(4, 'Nevermore.', true);
    const second = fetcher.fetch(17, 'Nevermore.', true);
    release(pcm(24));
    const [a, b] = await Promise.all([first, second]);
    expect(asked).toEqual(['Nevermore.']);
    // One synthesis, but each caller gets its own Utterance back.
    expect(a.utterance).toBe(4);
    expect(b.utterance).toBe(17);
  });

  it('lets a later fetch of the same text start once the first has finished', async () => {
    const { provider, asked } = fakeProvider(async () => pcm(24));
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: cache() });
    await fetcher.fetch(0, 'A.', true);
    await fetcher.fetch(1, 'B.', true);
    expect(asked).toEqual(['A.', 'B.']);
  });

  it('fails a request that never answers instead of hanging', async () => {
    // Philosophy rule 1. The owner cannot tell a slow server from a dead one,
    // and a spinner that never stops is the worst of the three.
    const { provider } = fakeProvider(() => new Promise<SynthesisResult>(() => {}));
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: cache(), timeoutMs: 5 });
    await expect(fetcher.fetch(0, 'Hello.', true)).rejects.toBeInstanceOf(SynthesisError);
  });

  it('aborts the request it gave up on, so it is not left running', async () => {
    let seen: AbortSignal | undefined;
    const { provider } = fakeProvider(() => new Promise<SynthesisResult>(() => {}));
    const wrapped: TTSProvider = {
      ...provider,
      synthesize: (text, options) => {
        seen = options.signal;
        return provider.synthesize(text, options);
      },
    };
    const fetcher = createClipFetcher({ provider: wrapped, voice: 'ava', cache: cache(), timeoutMs: 5 });
    await expect(fetcher.fetch(0, 'Hello.', true)).rejects.toBeInstanceOf(SynthesisError);
    expect(seen?.aborted).toBe(true);
  });

  it('does not cache a failure, so a seek back to it asks again', async () => {
    let calls = 0;
    const { provider } = fakeProvider(async () => {
      calls++;
      if (calls === 1) throw new SynthesisError('rate-limit', 'slow down');
      return pcm(24);
    });
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: cache() });
    await expect(fetcher.fetch(0, 'Hello.', true)).rejects.toBeInstanceOf(SynthesisError);
    expect((await fetcher.fetch(0, 'Hello.', true)).audio).toBe('samples');
  });

  it('asks for no speed, because SynthesisOptions has none (ADR 0009)', async () => {
    let options: Record<string, unknown> | undefined;
    const { provider } = fakeProvider(async () => pcm(24));
    const wrapped: TTSProvider = {
      ...provider,
      synthesize: (text, o) => {
        options = o as unknown as Record<string, unknown>;
        return provider.synthesize(text, o);
      },
    };
    await createClipFetcher({ provider: wrapped, voice: 'ava', cache: cache() }).fetch(0, 'Hello.', true);
    expect(Object.keys(options ?? {}).sort()).toEqual(['signal', 'voice']);
  });

  /**
   * The **Speech Text** seam (CONTEXT.md, ADR 0028). `core/speech-text.ts` has
   * its own tests for the stripping and the offset arithmetic; what is tested
   * here is that `clips.ts` applies them in the right order and on the right
   * side of the cache — which is the part that can be wrong while both halves
   * are right.
   */
  it('asks the Provider for the Speech Text and hands back timings in the document\'s coordinates', async () => {
    const { provider, asked } = fakeProvider(async () =>
      // `<Log in>` spoken is `Log in`: the Provider's own offsets cover 0..6 of
      // the six characters it was given.
      pcm(24, { timestamps: [{ start: 0, end: 0.4, charStart: 0, charEnd: 3 }, { start: 0.4, end: 0.8, charStart: 4, charEnd: 6 }] }));
    const fetcher = createClipFetcher({ provider, voice: 'ava', cache: cache(), brackets: { strip: true, pairs: '<> []' } });
    const clip = await fetcher.fetch(0, '<Log in>', true);

    expect(asked).toEqual(['Log in']);
    // Shifted by the one character the opening bracket occupies, so the
    // highlight lands on `Log` and `in` inside the original text rather than
    // one character to the left of each.
    expect(clip.words).toEqual([
      { start: 0, end: 0.4, charStart: 1, charEnd: 4 },
      { start: 0.4, end: 0.8, charStart: 5, charEnd: 7 },
    ]);
  });

  it('keys the cache on the Speech Text, so changing the setting cannot pair a Clip with the wrong offsets', async () => {
    const { provider, asked } = fakeProvider(async () => pcm(24));
    const shared = cache();
    await createClipFetcher({ provider, voice: 'ava', cache: shared, brackets: { strip: true, pairs: '<> []' } }).fetch(0, '<Log in>', true);
    // The same document text with stripping off is a different string spoken,
    // so it is a different Clip and is fetched rather than mistaken for the one
    // above.
    await createClipFetcher({ provider, voice: 'ava', cache: shared, brackets: { strip: false, pairs: '<> []' } }).fetch(0, '<Log in>', true);
    expect(asked).toEqual(['Log in', '<Log in>']);
    expect(await shared.match(clipCacheKey('speechify', 'ava', 'Log in'))).toBeTruthy();
  });

  it('leaves text alone when the owner has not asked, and when the list does not validate', async () => {
    for (const brackets of [undefined, { strip: false, pairs: '<> []' }, { strip: true, pairs: 'not a list' }]) {
      const { provider, asked } = fakeProvider(async () => pcm(24));
      await createClipFetcher({ provider, voice: 'ava', cache: cache(), brackets }).fetch(0, '<Log in>', true);
      expect(asked).toEqual(['<Log in>']);
    }
  });
});

/**
 * #109, ADR 0064: a Provider may have to hear from the owner before it is sent
 * anything, as the runtime's does. That wait is the owner's and not the
 * Provider's, so it comes before the clock above starts, however long it takes.
 * A no rejects without sending, and once the owner has answered yes the clock
 * bounds the Provider as it always has.
 */
describe('createClipFetcher, when the Provider has to hear from the owner first (#109)', () => {
  /** A Provider whose `ensureConsent` waits for the test's answer, recording each text it was asked about. */
  function gated(synthesize: (text: string) => Promise<SynthesisResult> = async () => pcm(24)) {
    const { provider, asked: sent } = fakeProvider(synthesize);
    const answers: ((yes: boolean) => void)[] = [];
    const ensureConsent = vi.fn((_text: string, _options: { voice: string }) => new Promise<void>((resolve, reject) => {
      answers.push((yes) => (yes ? resolve() : reject(new SynthesisError('declined', 'Speechify was not allowed to receive this document\'s text.'))));
    }));
    const gatedProvider: ClipProvider = { ...provider, ensureConsent };
    return { provider: gatedProvider, sent, ensureConsent, answer: (yes: boolean) => answers.shift()!(yes) };
  }
  /** Longer than every clock below: 5 ms. */
  const longer = () => new Promise((resolve) => setTimeout(resolve, 40));
  function watch<T>(promise: Promise<T>) {
    const seen: { state: 'pending' | 'resolved' | 'rejected'; value?: unknown } = { state: 'pending' };
    promise.then((value) => { seen.state = 'resolved'; seen.value = value; }, (error: unknown) => { seen.state = 'rejected'; seen.value = error; });
    return seen;
  }

  it('waits for the owner outside its clock and sends nothing meanwhile, then sends the Speech Text', async () => {
    const g = gated();
    const fetcher = createClipFetcher({ provider: g.provider, voice: 'ava', cache: cache(), timeoutMs: 5, brackets: { strip: true, pairs: '<>' } });
    const clip = watch(fetcher.fetch(0, 'Hello <there>.', true));
    await longer();
    expect(clip.state).toBe('pending');
    expect(g.sent).toEqual([]);
    expect(g.ensureConsent).toHaveBeenCalledWith('Hello there.', { voice: 'ava' });
    g.answer(true);
    await vi.waitFor(() => expect(clip.state).toBe('resolved'));
    expect(g.sent).toEqual(['Hello there.']);
  });

  it('rejects with the refusal and sends nothing', async () => {
    const g = gated();
    const fetcher = createClipFetcher({ provider: g.provider, voice: 'ava', cache: cache(), timeoutMs: 5 });
    const clip = fetcher.fetch(0, 'Hello.', true);
    await longer();
    g.answer(false);
    await expect(clip).rejects.toMatchObject({ kind: 'declined' });
    expect(g.sent).toEqual([]);
  });

  it('starts the clock at the answer, so a Provider that then stops answering still fails rather than hangs', async () => {
    const g = gated(() => new Promise<SynthesisResult>(() => {}));
    const fetcher = createClipFetcher({ provider: g.provider, voice: 'ava', cache: cache(), timeoutMs: 5 });
    const clip = fetcher.fetch(0, 'Hello.', true);
    await longer();
    g.answer(true);
    await expect(clip).rejects.toMatchObject({ kind: 'network', message: 'speechify: no audio within 0s' });
    expect(g.sent).toEqual(['Hello.']);
  });

  it('asks once for the same text however many Utterances want it', async () => {
    const g = gated();
    const fetcher = createClipFetcher({ provider: g.provider, voice: 'ava', cache: cache(), timeoutMs: 5 });
    const both = Promise.all([fetcher.fetch(0, 'Again.', true), fetcher.fetch(9, 'Again.', true)]);
    await longer();
    expect(g.ensureConsent).toHaveBeenCalledTimes(1);
    g.answer(true);
    expect((await both).map((clip) => clip.utterance)).toEqual([0, 9]);
    expect(g.sent).toEqual(['Again.']);
  });

  it('asks nothing for a Clip that needs no Provider: text that is not Speakable, and one already cached', async () => {
    const g = gated();
    const kept = cache();
    await kept.put(clipCacheKey('speechify', 'ava', 'Cached.'), toStored(pcm(24)));
    const fetcher = createClipFetcher({ provider: g.provider, voice: 'ava', cache: kept, timeoutMs: 5 });
    expect((await fetcher.fetch(0, '* * *', false)).audio).toBe('silence');
    expect((await fetcher.fetch(1, 'Cached.', true)).audio).toBe('samples');
    expect(g.ensureConsent).not.toHaveBeenCalled();
    expect(g.sent).toEqual([]);
  });

  it('says when a Clip no longer waits on the owner: at once without a Provider, at the answer otherwise, and never on a no', async () => {
    const g = gated();
    const kept = cache();
    await kept.put(clipCacheKey('speechify', 'ava', 'Cached.'), toStored(pcm(24)));
    const fetcher = createClipFetcher({ provider: g.provider, voice: 'ava', cache: kept, timeoutMs: 5 });
    const cleared: number[] = [];
    await fetcher.fetch(0, '* * *', false, () => cleared.push(0));
    await fetcher.fetch(1, 'Cached.', true, () => cleared.push(1));
    expect(cleared).toEqual([0, 1]);

    const allowed = fetcher.fetch(2, 'Allowed.', true, () => cleared.push(2));
    await longer();
    expect(cleared).toEqual([0, 1]);
    g.answer(true);
    await allowed;
    expect(cleared).toEqual([0, 1, 2]);

    const refused = fetcher.fetch(3, 'Refused.', true, () => cleared.push(3));
    await longer();
    g.answer(false);
    await expect(refused).rejects.toMatchObject({ kind: 'declined' });
    await longer();
    expect(cleared).toEqual([0, 1, 2]);
  });
});
