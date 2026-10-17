import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { Chapter, NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';

/**
 * #202. A server that refuses PCM (the owner's Chatterbox answered 422, #65) is
 * asked for PCM once, and for MP3 from then on, by a Reading and by a Download,
 * although both build a Provider for every sentence they send.
 *
 * The real runtime, createProvider and OpenAI Compatible Provider. Doubled: the
 * platform and the catalogue, as in runtime-reading.test.ts, and the global
 * fetch, which answers 422 to `pcm` as FastAPI does and MP3 bytes otherwise.
 * Each test has an Address of its own: what is learnt is kept for the module.
 */
const mock = vi.hoisted(() => ({ open: vi.fn<() => Promise<unknown>>(), asked: [] as string[] }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener: () => ({ remove() {} }), beginBackground: async () => true, endBackground: async () => {},
    submitContinued: async () => false, updateContinued: async () => {}, finishContinued: async () => {},
  },
}));
vi.mock('../../src/app/library', () => ({ documentFile: () => { throw new Error('not read here'); } }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'missing' }),
  readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, enqueue, offlineProvider, startDownloads } = await import('../../src/offline/runtime');
(await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });

const settingsAt = (baseURL: string): AppSettings => ({
  ...DEFAULT_SETTINGS, provider: 'compatible', enabledProviders: ['compatible'], voice: 'Emily.wav',
  compatible: { ...DEFAULT_SETTINGS.compatible, baseURL, model: 'm' },
});
const voice = { provider: 'compatible' as const, voice: 'Emily.wav', label: 'Emily' };
const chapter: Chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: [], textCount: 0, textsLoaded: false, prepared: true };
const texts = ['Down one.', 'Down two.', 'Down three.'];

function serve(settings: AppSettings) {
  const saved = new Set<string>();
  mock.open.mockResolvedValue({
    tasks: async () => [],
    catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
    plan: async (): Promise<NarrationPlan> => ({ version: 2, chapters: [chapter] }),
    chapter: async () => ({ ...chapter, texts, textCount: texts.length, textsLoaded: true }),
    progress: async () => [],
    hasClip: async (_d: string, _v: unknown, text: string) => saved.has(text),
    readClip: async () => ({ clip: null, dropped: false }),
    saveClip: async (_d: string, _v: unknown, text: string) => { saved.add(text); return true; },
    inventory: async () => [],
    savedVoices: async () => [],
  });
  configureDownloads(settings);
}

beforeEach(() => {
  mock.asked.length = 0;
  // After test/setup.ts, which forbids the global fetch: a fake, nothing reaches the network.
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const format = JSON.parse(init.body).response_format as string;
    mock.asked.push(format);
    return format === 'pcm'
      ? new Response('{"detail":"bad format"}', { status: 422 })
      : new Response(Uint8Array.from([0x49, 0x44, 0x33, 0x04]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  }) as unknown as typeof fetch;
});

it('a Reading of three sentences asks a server that refuses PCM for PCM once', async () => {
  const settings = settingsAt('https://reading.home.example');
  serve(settings);
  const stop = startDownloads();
  try {
    await vi.waitFor(() => expect(downloadsReady()).toBe(true));
    const provider = offlineProvider('reading', settings);
    const signal = new AbortController().signal;
    for (const text of ['Read one.', 'Read two.', 'Read three.']) await provider.synthesize(text, { voice: voice.voice, signal });
    expect(mock.asked).toEqual(['pcm', 'mp3', 'mp3', 'mp3']);
  } finally {
    stop();
  }
});

it('a Download of three sentences asks a server that refuses PCM for PCM once', async () => {
  const settings = settingsAt('https://download.home.example');
  serve(settings);
  const stop = startDownloads();
  try {
    await vi.waitFor(() => expect(downloadsReady()).toBe(true));
    enqueue('download', voice, ['a']);
    await vi.waitFor(() => expect(downloadTasks('download')[0]!.state).toBe('done'));
    expect(mock.asked).toEqual(['pcm', 'mp3', 'mp3', 'mp3']);
  } finally {
    stop();
  }
});
