import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SENTENCES_AT_ONCE, DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { Chapter, DownloadTask, NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';

/**
 * #148, ADR 0075: a launch with a download left going on. Whether read-aloud
 * may go on is read before anything goes on by itself: locked, the download is
 * paused and no continued task is submitted; allowed, it goes on as before,
 * even when what is owned takes a moment to read. Each case loads the runtime
 * afresh, as a launch does.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  sent: [] as string[],
  submitContinued: vi.fn(async (): Promise<boolean> => false),
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
    submitContinued: mock.submitContinued,
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

const settings: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george',
  sentencesAtOnce: { ...DEFAULT_SENTENCES_AT_ONCE, speechify: 1 },
};
const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };
const chapter: Chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: [], textCount: 0, textsLoaded: false, prepared: true };
const NOW = Date.UTC(2026, 9, 9, 12);

/** A launch with one download left going on, and an App Store whose first read takes a moment. */
async function launch(owned: { unlocked: boolean; trialStartedAt: number | null }) {
  vi.resetModules();
  mock.sent.length = 0;
  mock.submitContinued.mockClear();
  const left: DownloadTask = { id: 't', document: 'book', voice, chapters: ['a'], state: 'downloading', error: null, failed: [] };
  const saved = new Set<string>();
  mock.open.mockResolvedValue({
    tasks: async () => [left],
    catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
    plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [chapter] }),
    chapter: async () => ({ ...chapter, texts: ['Left going on.'], textCount: 1, textsLoaded: true }),
    progress: async () => [],
    hasClip: async (_d: string, _v: unknown, text: string) => saved.has(text),
    readClip: async () => ({ clip: null, dropped: false }),
    saveClip: async (_d: string, _v: unknown, text: string) => { saved.add(text); return true; },
    inventory: async () => [],
    savedVoices: async () => [],
  });
  const runtime = await import('../../src/offline/runtime');
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  const { configurePurchases } = await import('../../src/app/purchase');
  const { createPurchases } = await import('../../src/purchase/purchases');
  const { createFakeStore, FAKE_UNLOCKED } = await import('../../src/purchase/fake-store');
  const store = createFakeStore({ ...FAKE_UNLOCKED, ...owned }, { now: () => NOW });
  // What is owned is read a few milliseconds late, as StoreKit may be.
  const slow = { ...store, entitlements: () => new Promise<Awaited<ReturnType<typeof store.entitlements>>>((resolve) => setTimeout(() => resolve(store.entitlements()), 20)) };
  let record = { unlocked: false, trialStartedAt: null as number | null };
  configurePurchases(createPurchases({
    lockOn: true, store: slow, record: { load: () => record, save: (next) => { record = next; } },
    now: () => NOW, log: () => {},
    ask: { canAsk: () => true, trial: async () => 'not-now', ended: async () => 'not-now', unavailable: async () => {} },
  }));
  runtime.configureDownloads(settings);
  runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  return runtime;
}

describe('a launch with a download left going on', () => {
  it('pauses it while read-aloud is locked, and submits no continued task', async () => {
    const runtime = await launch({ unlocked: false, trialStartedAt: NOW - 31 * 24 * 60 * 60 * 1000 });
    await vi.waitFor(() => expect(runtime.downloadTasks('book')[0]?.state).toBe('paused'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runtime.downloadTasks('book')[0]?.paused).toEqual(['a']);
    expect(mock.sent).toEqual([]);
    expect(mock.submitContinued).not.toHaveBeenCalled();
  });

  it('lets it go on with the Unlock, though what is owned is read only after the launch began', async () => {
    const runtime = await launch({ unlocked: true, trialStartedAt: null });
    await vi.waitFor(() => expect(runtime.downloadTasks('book')[0]?.state).toBe('done'));
    expect(mock.sent).toEqual(['Left going on.']);
    expect(mock.submitContinued).toHaveBeenCalled();
  });
});
