import { expect, it, vi } from 'vitest';
import { DEFAULT_SENTENCES_AT_ONCE, DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';
import type { Chapter, NarrationPlan } from '../../src/offline/model';
import { speechKeying } from '../../src/offline/speech';

/**
 * #75: a Download goes on while a Reading plays. The runtime used to hold the
 * scheduler back for as long as the reader said it was playing, so a download
 * stood still for the whole of a Reading. Nothing about a Reading holds a
 * download back now; what keeps the Reading ahead is the Provider's own queue
 * where it has one, and Speechify's is told which requests are a download's.
 * The platform is behind the same test doubles as `runtime.test.ts`.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  /** Each synthesis the runtime sent, with the Speechify settings its provider was built with. */
  sent: [] as { text: string; speechify: unknown }[],
  /** The Reading's request, held out until the test lets it go. */
  reading: null as null | ((clip: SynthesisResult) => void),
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
  createProvider: (_id: string, configuration: { speechify: unknown }) => ({
    id: 'speechify', capabilities: { wordTimestamps: true }, listVoices: async () => [],
    synthesize: (text: string) => {
      mock.sent.push({ text, speechify: configuration.speechify });
      const clip: SynthesisResult = { audio: 'encoded', bytes: new Uint8Array([1]), mediaType: 'audio/mp4' };
      return text === 'Read now.' ? new Promise<SynthesisResult>((resolve) => { mock.reading = resolve; }) : Promise.resolve(clip);
    },
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { configureDownloads, downloadTasks, downloadsReady, enqueue, offlineProvider, startDownloads } = await import('../../src/offline/runtime');

const settings: AppSettings = {
  ...DEFAULT_SETTINGS, provider: 'speechify', enabledProviders: ['speechify'], voice: 'en-US/george',
  sentencesAtOnce: { ...DEFAULT_SENTENCES_AT_ONCE, speechify: 2 },
};
const chapter: Chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, texts: [], textCount: 2, textsLoaded: false, prepared: true };
const plan: NarrationPlan = { version: 2, chapters: [chapter] };

it('writes a queued download while a Reading\'s request is out, and tells Speechify which requests are the download\'s', async () => {
  const saveClip = vi.fn(async () => true);
  mock.open.mockResolvedValue({
    tasks: async () => [],
    catalog: { saveTasks: async () => {}, speechKeying: async () => speechKeying(settings) },
    plan: async () => plan,
    chapter: async () => ({ ...chapter, texts: ['One.', 'Two.'], textsLoaded: true }),
    progress: async () => [],
    hasClip: async () => false,
    readClip: async () => ({ clip: null, dropped: false }),
    saveClip,
    inventory: async () => [],
    savedVoices: async () => [],
  });
  configureDownloads(settings);
  const stop = startDownloads();
  try {
    await vi.waitFor(() => expect(downloadsReady()).toBe(true));
    const voice = { provider: 'speechify' as const, voice: 'en-US/george', label: 'George' };
    const reading = offlineProvider('book', settings).synthesize('Read now.', { voice: voice.voice, signal: new AbortController().signal });
    await vi.waitFor(() => expect(mock.reading).not.toBeNull());

    enqueue('book', voice, ['a']);
    await vi.waitFor(() => expect(saveClip).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(downloadTasks('book')[0]?.state).toBe('done'));
    // Both clips were saved while the Reading's own request was still out.
    expect(mock.sent.map((request) => request.text)).toEqual(['Read now.', 'One.', 'Two.']);
    // The Reading's request is not marked, so it goes ahead of the download's still waiting (#75);
    // the download's carries the owner's Sentences at once for Speechify (#64).
    expect(mock.sent[0]!.speechify).toEqual({ apiKey: 'test-key' });
    expect(mock.sent[1]!.speechify).toEqual({ apiKey: 'test-key', atOnce: 2, download: true });

    mock.reading!({ audio: 'encoded', bytes: new Uint8Array([2]), mediaType: 'audio/mp4' });
    expect((await reading).audio).toBe('encoded');
  } finally {
    stop();
  }
});
