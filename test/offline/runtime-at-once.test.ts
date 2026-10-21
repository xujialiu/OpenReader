import { expect, it, vi } from 'vitest';
import { DEFAULT_SENTENCES_AT_ONCE, DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { Chapter, NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';
import { BLOCK_WALK } from '../../src/renderer/highlighter';
import { SEGMENTATION } from '../../src/core/segmenter/revision';

/**
 * #311: Sentences at once is read each time a place in a download's window is
 * to be filled, and a change to it in Settings wakes the running download, so
 * a higher number is used at once rather than when the next request comes
 * back. The platform is behind the same test doubles as `runtime-reading.test.ts`.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  sent: [] as string[],
  pending: new Map<string, () => void>(),
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
    id: 'fish', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: (text: string) => {
      mock.sent.push(text);
      const clip: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' };
      return new Promise<SynthesisResult>((resolve) => { mock.pending.set(text, () => resolve(clip)); });
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, enqueue, startDownloads } = await import('../../src/offline/runtime');
(await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });

const settings = (fish: number): AppSettings => ({
  ...DEFAULT_SETTINGS, provider: 'fish', enabledProviders: ['fish'], voice: 'narrator',
  sentencesAtOnce: { ...DEFAULT_SENTENCES_AT_ONCE, fish },
});
const voice = { provider: 'fish' as const, voice: 'narrator', label: 'Narrator' };
const texts = ['One.', 'Two.', 'Three.', 'Four.'];
const chapter: Chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: [], textCount: texts.length, textsLoaded: false, prepared: true };

it('uses a higher Sentences at once at once, with the request already out still out', async () => {
  const saved = new Set<string>();
  mock.open.mockResolvedValue({
    tasks: async () => [],
    catalog: { saveTasks: async () => {}, preparedWalk: async () => BLOCK_WALK, preparedSegmentation: async () => SEGMENTATION, speechKeying: async () => speechKeying(settings(1)) },
    plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [chapter] }),
    chapter: async () => ({ ...chapter, texts, textsLoaded: true }),
    progress: async () => [],
    hasClip: async (_document: string, _voice: unknown, text: string) => saved.has(text),
    readClip: async () => ({ clip: null, dropped: false }),
    saveClip: async (_document: string, _voice: unknown, text: string) => { saved.add(text); return true; },
    inventory: async () => [],
    savedVoices: async () => [],
  });
  configureDownloads(settings(1));
  const stop = startDownloads();
  try {
    await vi.waitFor(() => expect(downloadsReady()).toBe(true));
    enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(mock.sent).toEqual(['One.']));
    // Settings › Fish Audio › Sentences at once: three.
    configureDownloads(settings(3));
    await vi.waitFor(() => expect(mock.sent).toEqual(['One.', 'Two.', 'Three.']));
    expect(mock.pending.has('One.')).toBe(true);
    for (const text of ['One.', 'Two.', 'Three.']) mock.pending.get(text)!();
    await vi.waitFor(() => expect(mock.sent).toEqual(texts));
    mock.pending.get('Four.')!();
    await vi.waitFor(() => expect(downloadTasks('book')[0]!.state).toBe('done'));
  } finally {
    stop();
  }
});
