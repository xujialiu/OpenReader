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
  readProviderKey: async () => ({ outcome: 'found', secret: 'test-key' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: () => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: async (text: string): Promise<SynthesisResult> => {
      mock.sent.push(text);
      return { audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' };
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, offlineProvider, startDownload, startDownloads } = await import('../../src/offline/runtime');
const { configureConsent, consent } = await import('../../src/app/consent');

const settings: AppSettings = { ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george' };
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };

mock.open.mockResolvedValue({
  tasks: async () => [],
  catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
  plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [] }),
  chapter: async () => null,
  progress: async () => [],
  hasClip: async () => false,
  readClip: async () => ({ clip: null, dropped: false }),
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

beforeEach(() => {
  mock.sent.length = 0;
  mock.asked.length = 0;
  mock.kept.clear();
  consent.again();
});

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
