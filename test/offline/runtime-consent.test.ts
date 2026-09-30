import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Recipient } from '../../src/app/consent';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { SynthesisError } from '../../src/core/providers/errors';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';

/**
 * #109, ADR 0064: the runtime is where a Reading and a download send a
 * Document's text, so it is where the owner is asked first. The platform is
 * behind the same test doubles as `runtime-reading.test.ts`. The question is
 * answered by the test, and a yes is kept in memory.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  /** Every text the Provider was actually sent. */
  sent: [] as string[],
  /** Texts the Provider takes and never answers, as a server that has stopped responding. */
  unanswered: new Set<string>(),
  /** Texts whose audio is saved on the phone, as a downloaded chapter's are. */
  saved: new Set<string>(),
  /** How often the Keychain and the store were read, for the claim that an allowed Provider costs neither. */
  reads: { keychain: 0, store: 0 },
  /** The questions put to the owner, oldest first, each with the answer the test gives it. */
  asked: [] as { recipient: Recipient; answer(yes: boolean): void }[],
  kept: new Set<string>(),
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener: () => ({ remove() {} }),
    beginBackground: async () => true,
    endBackground: async () => {},
    submitContinued: async () => false,
    updateContinued: async () => {},
    finishContinued: async () => {},
  },
}));
vi.mock('../../src/app/library', () => ({
  documentFile: () => { throw new Error('The document file is not read here.'); },
}));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => { mock.reads.keychain++; return { outcome: 'found', secret: 'test-key' }; },
  readGatewayHeaders: async () => { mock.reads.keychain++; return { outcome: 'found', secret: '' }; },
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: async (text: string): Promise<SynthesisResult> => {
      mock.sent.push(text);
      if (mock.unanswered.has(text)) return new Promise<SynthesisResult>(() => {});
      return { audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' };
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, offlineProvider, startDownload, startDownloads } = await import('../../src/offline/runtime');
const { configureConsent, consent } = await import('../../src/app/consent');
const { createClipFetcher, DEFAULT_SYNTHESIS_TIMEOUT_MS } = await import('../../src/playback/clips');

const settings: AppSettings = { ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george' };
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };

mock.open.mockResolvedValue({
  tasks: async () => [],
  catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
  plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [] }),
  chapter: async () => null,
  progress: async () => [],
  hasClip: async () => false,
  readClip: async (_document: string, _voice: unknown, text: string) => {
    mock.reads.store++;
    return mock.saved.has(text)
      ? { clip: { audio: 'encoded', bytes: new Uint8Array([2]), mediaType: 'audio/mp4' }, dropped: false }
      : { clip: null, dropped: false };
  },
  saveClip: async () => true,
  inventory: async () => [],
  savedVoices: async () => [],
});
configureConsent({
  kept: (key) => mock.kept.has(key),
  keep: (key) => { mock.kept.add(key); },
  ask: (recipient) => new Promise<boolean>((resolve) => { mock.asked.push({ recipient, answer: resolve }); }),
});
configureDownloads(settings);
startDownloads();
await vi.waitFor(() => expect(downloadsReady()).toBe(true));

/** The owner's answer to the question on screen. */
async function answer(yes: boolean) {
  await vi.waitFor(() => expect(mock.asked.some((question) => question.answer !== undefined)).toBe(true));
  mock.asked.shift()!.answer(yes);
}
const reading = () => offlineProvider('book', settings);
const speak = (text: string) => reading().synthesize(text, { voice: voice.voice, signal: new AbortController().signal });

beforeEach(async () => {
  // A question a failed test left open would otherwise stand for every test after it.
  for (const question of mock.asked.splice(0)) question.answer(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  mock.sent.length = 0;
  mock.kept.clear();
  mock.unanswered.clear();
  mock.saved.clear();
  mock.reads = { keychain: 0, store: 0 };
  consent.again();
});

/** Where a promise has got to, readable without awaiting it. */
function watch<T>(promise: Promise<T>) {
  const seen: { state: 'pending' | 'resolved' | 'rejected'; value?: unknown } = { state: 'pending' };
  promise.then((value) => { seen.state = 'resolved'; seen.value = value; }, (error: unknown) => { seen.state = 'rejected'; seen.value = error; });
  return seen;
}

describe('a Reading', () => {
  it('asks before its first sentence goes out, naming the Provider, and a no sends nothing', async () => {
    const first = speak('One: a no.');
    await answer(false);
    await expect(first).rejects.toMatchObject({ kind: 'declined', message: 'Speechify was not allowed to receive this document\'s text.' });
    await expect(first).rejects.toBeInstanceOf(SynthesisError);
    expect(mock.sent).toEqual([]);
    expect(mock.kept.size).toBe(0);
  });

  it('asks once for the sentences the read-ahead wants together, and a no holds for the ones behind them until Play', async () => {
    const together = [speak('Two: together.'), speak('Three: together.')];
    await answer(false);
    for (const request of together) await expect(request).rejects.toMatchObject({ kind: 'declined' });
    // The read-ahead moving on to the next sentence: refused without a second alert.
    await expect(speak('Four: behind.')).rejects.toMatchObject({ kind: 'declined' });
    expect(mock.asked).toHaveLength(0);
    // Play pressed again: asked again, and this time allowed.
    consent.again();
    const again = speak('Four: behind.');
    await answer(true);
    await expect(again).resolves.toMatchObject({ audio: 'encoded' });
    expect(mock.sent).toEqual(['Four: behind.']);
  });

  it('keeps a yes, and sends the next sentence without asking', async () => {
    const first = speak('Five: a yes.');
    await answer(true);
    await first;
    expect(mock.kept).toEqual(new Set(['provider:speechify']));
    await speak('Six: no question.');
    expect(mock.sent).toEqual(['Five: a yes.', 'Six: no question.']);
    expect(mock.asked).toHaveLength(0);
  });
});

describe('a download started from the drawer', () => {
  it('asks before its task exists: a no leaves nothing, and the next press asks again', async () => {
    const refused = startDownload('book', voice, ['a']);
    await answer(false);
    expect(await refused).toBe(false);
    expect(downloadTasks('book')).toEqual([]);

    const allowed = startDownload('book', voice, ['a']);
    await answer(true);
    expect(await allowed).toBe(true);
    expect(downloadTasks('book')).toHaveLength(1);
    expect(mock.kept).toEqual(new Set(['provider:speechify']));
  });

  it('starts without a question once the Provider is allowed', async () => {
    mock.kept.add('provider:speechify');
    expect(await startDownload('another', voice, ['a'])).toBe(true);
    expect(mock.asked).toHaveLength(0);
  });
});

/**
 * The simulator run of 2026-09-30 (#109). A Provider was not yet allowed, Play
 * was pressed, and the alert was left alone. At 60.09 s the player said
 * `no audio within 60s` in red under the still-open alert, and the Reading
 * paused. A Don't Allow afterwards sent nothing, but the note stayed. The clip
 * fetcher's clock (`clips.ts`) had counted the owner's answer as the Provider's
 * silence: unfixed, the fetch below is rejected at 60 s with
 * `SynthesisError('network', 'speechify: no audio within 60s')`. Here the
 * fetcher is the real one, with its own default clock, over the runtime's
 * Provider, as `use-reading.ts` gives it to the engine. The engine stops
 * quietly where a refusal leaves it (ADR 0027, `isDeclined` in
 * `use-reading.ts`). What went wrong was a timeout arriving before the owner
 * had answered.
 */
describe('a Reading whose question is left open longer than the engine\'s clock (#109)', () => {
  const clipFor = (text: string) => createClipFetcher({ provider: reading(), voice: voice.voice }).fetch(7, text, true);
  const openLonger = () => vi.advanceTimersByTimeAsync(DEFAULT_SYNTHESIS_TIMEOUT_MS + 30_000);

  it('neither gives up nor sends while the question is up, and a no afterwards is a quiet refusal, not a timeout', async () => {
    vi.useFakeTimers();
    try {
      const clip = watch(clipFor('Seven: left open, then refused.'));
      await vi.waitFor(() => expect(mock.asked).toHaveLength(1));
      await openLonger();
      expect(clip.state).toBe('pending');
      expect(mock.sent).toEqual([]);
      await answer(false);
      await vi.waitFor(() => expect(clip.state).toBe('rejected'));
      expect(clip.value).toMatchObject({ kind: 'declined', retriable: false });
      expect(mock.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays the sentence once the owner allows it, however long the question was up', async () => {
    vi.useFakeTimers();
    try {
      const clip = watch(clipFor('Seven: left open, then allowed.'));
      await vi.waitFor(() => expect(mock.asked).toHaveLength(1));
      await openLonger();
      expect(clip.state).toBe('pending');
      await answer(true);
      await vi.waitFor(() => expect(clip.state).toBe('resolved'));
      expect(clip.value).toMatchObject({ utterance: 7, audio: 'encoded' });
      expect(mock.sent).toEqual(['Seven: left open, then allowed.']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still gives up on a Provider that stops answering once the owner has allowed it, a full clock after the answer', async () => {
    vi.useFakeTimers();
    try {
      mock.unanswered.add('Seven: allowed, then silence.');
      const clip = watch(clipFor('Seven: allowed, then silence.'));
      await vi.waitFor(() => expect(mock.asked).toHaveLength(1));
      await openLonger();
      await answer(true);
      await vi.waitFor(() => expect(mock.sent).toEqual(['Seven: allowed, then silence.']));
      await vi.advanceTimersByTimeAsync(DEFAULT_SYNTHESIS_TIMEOUT_MS - 1_000);
      expect(clip.state).toBe('pending');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(clip.state).toBe('rejected');
      expect(clip.value).toMatchObject({ kind: 'network', message: 'speechify: no audio within 60s' });
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * The step the clip fetcher takes before its clock (`ensureConsent`, #109). It
 * asks exactly when `synthesize` would. So a sentence that would not be sent
 * asks nothing. A sentence that could not be sent anyway asks nothing either,
 * and `synthesize` says why. A Provider already allowed costs no Keychain or
 * store read here, because this runs once for every sentence a Reading speaks.
 */
describe('the step before the clock', () => {
  const ask = (text: string, provider = reading()) => provider.ensureConsent!(text, { voice: voice.voice });

  it('asks nothing for a sentence whose audio is already on the phone, saved or in memory, and a no stops nothing it plays', async () => {
    mock.saved.add('Eight: downloaded.');
    await ask('Eight: downloaded.');
    await expect(speak('Eight: downloaded.')).resolves.toMatchObject({ bytes: new Uint8Array([2]) });

    // Fetched this run while allowed, then the yes taken away: still in memory, so nothing is asked.
    mock.kept.add('provider:speechify');
    await speak('Nine: in memory.');
    mock.kept.clear();
    await ask('Nine: in memory.');
    expect(mock.asked).toHaveLength(0);
    expect(mock.sent).toEqual(['Nine: in memory.']);
  });

  it('asks nothing for a sentence that could not be sent anyway, and synthesize says why without asking either', async () => {
    const unready = offlineProvider('book', { ...settings, enabledProviders: [] });
    await ask('Ten: nothing enabled.', unready);
    await expect(unready.synthesize('Ten: nothing enabled.', { voice: voice.voice, signal: new AbortController().signal }))
      .rejects.toMatchObject({ kind: 'no-key' });
    expect(mock.asked).toHaveLength(0);
    expect(mock.sent).toEqual([]);
  });

  it('asks once for everything waiting on the same Provider, and afterwards synthesize sends without asking again', async () => {
    const waiting = [ask('Eleven: first.'), ask('Twelve: second.')];
    await answer(true);
    await Promise.all(waiting);
    expect(mock.asked).toHaveLength(0);
    await speak('Eleven: first.');
    expect(mock.sent).toEqual(['Eleven: first.']);
  });

  it('reads neither the Keychain nor the store for a Provider already allowed', async () => {
    mock.kept.add('provider:speechify');
    await ask('Thirteen: allowed.');
    expect(mock.reads).toEqual({ keychain: 0, store: 0 });
  });
});
