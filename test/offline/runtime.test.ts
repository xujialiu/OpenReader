import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { SynthesisResult } from '../../src/core/providers/types';

/**
 * The runtime is React Native code and this suite renders no native view
 * (test/README.md); what is mounted here is the one seam between the reading
 * and the offline store, with the platform behind test doubles. The rule under
 * test is #13's: the catalogue decides what is played from disk, never whether
 * anything is played at all.
 */
const mock = vi.hoisted(() => ({
  open: vi.fn<() => Promise<unknown>>(),
  synthesize: vi.fn<() => Promise<SynthesisResult>>(),
  keepWarm: vi.fn<(origin: string | null) => void>(),
  /** The platform's connectivity listener, once `startDownloads` has registered it. */
  connectivity: null as null | ((event: { connected: boolean }) => void),
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({
  offlineNative: {
    addListener(event: string, listener: (event: { connected: boolean }) => void) {
      if (event === 'connectivity') mock.connectivity = listener;
      return { remove() {} };
    },
    beginBackground: async () => true,
    endBackground: async () => {},
  },
}));
vi.mock('../../src/app/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/app/settings')>()),
  keepWarm: mock.keepWarm,
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
    id: 'openai-official', capabilities: { wordTimestamps: false }, listVoices: async () => [], synthesize: mock.synthesize,
  }),
}));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => mock.open() }));

const { downloadError, hasSavedVoice, offlineProvider, requestInventory, startDownloads } = await import('../../src/offline/runtime');
const { voiceKey } = await import('../../src/offline/catalog-keys');
const settings = { ...DEFAULT_SETTINGS, provider: 'openai-official' as const, enabledProviders: ['openai-official' as const], openai: { model: 'tts-1' }, voice: 'alloy' };
const spoken = (): SynthesisResult => ({ audio: 'encoded', bytes: new Uint8Array([1, 2, 3]), mediaType: 'audio/mp4' });
const options = { voice: 'alloy', signal: new AbortController().signal };
beforeEach(() => { vi.clearAllMocks(); mock.synthesize.mockImplementation(async () => spoken()); });

it('keeps reading over the network when the offline catalogue cannot open, and reports it once', async () => {
  const failure = new Error('Update the app to read this offline database.');
  mock.open.mockRejectedValue(failure);
  const provider = offlineProvider('doc', settings);
  expect((await provider.synthesize('Hello.', options)).audio).toBe('encoded');
  expect(mock.synthesize).toHaveBeenCalledTimes(1);
  expect(downloadError()).toBe(failure.message);
  expect((await provider.synthesize('And again.', options)).audio).toBe('encoded');
  expect(mock.synthesize).toHaveBeenCalledTimes(2);
  // Asked again for each utterance, so a store repaired underneath is used without a restart.
  expect(mock.open).toHaveBeenCalledTimes(2);
  expect(downloadError()).toBe(failure.message);
});

it('plays saved audio without asking the provider while the catalogue answers', async () => {
  const saved = spoken();
  mock.open.mockResolvedValue({ readClip: async () => ({ clip: saved, dropped: false }) });
  expect(await offlineProvider('doc', settings).synthesize('Saved.', options)).toBe(saved);
  expect(mock.synthesize).not.toHaveBeenCalled();
});

/**
 * A sentence with no saved audio goes to the Provider without re-reading the
 * inventory (#47). Measured on 2026-09-23 (notes/NOTES_2026-09-23.md, 13:48):
 * with one chapter downloaded, each such sentence cost a `readClip`, an
 * `inventory`, a `savedVoices` and a re-render of everything that watches the
 * downloads, in front of its request. Only a read that dropped a record whose
 * file had gone changes the saved audio, and only that one re-reads it.
 */
function catalogue(read: () => unknown) {
  const repository = {
    rememberVoice: vi.fn(async () => {}),
    inventory: vi.fn(async () => [{ voice: voiceKey({ provider: 'openai-official', voice: 'alloy' }), count: 72, bytes: 3_119_331 }]),
    savedVoices: vi.fn(async () => [{ provider: 'openai-official' as const, voice: 'alloy', label: 'alloy' }]),
    readClip: vi.fn(async () => read()),
  };
  mock.open.mockResolvedValue(repository);
  return repository;
}

it('sends a sentence with no saved audio straight to the provider, reading the inventory no further', async () => {
  const repository = catalogue(() => ({ clip: null, dropped: false }));
  await requestInventory('doc-with-a-chapter', { provider: 'openai-official', voice: 'alloy' });
  expect(hasSavedVoice('doc-with-a-chapter', 'openai-official', 'alloy')).toBe(true);
  repository.inventory.mockClear();
  repository.savedVoices.mockClear();

  const provider = offlineProvider('doc-with-a-chapter', settings);
  await provider.synthesize('Not downloaded.', options);
  await provider.synthesize('Nor this one.', options);
  expect(mock.synthesize).toHaveBeenCalledTimes(2);
  expect(repository.readClip).toHaveBeenCalledTimes(2);
  expect(repository.inventory).not.toHaveBeenCalled();
  expect(repository.savedVoices).not.toHaveBeenCalled();
});

it('reads the inventory again, once, after a read dropped a record whose file had gone', async () => {
  const repository = catalogue(() => ({ clip: null, dropped: true }));
  await requestInventory('doc-with-a-lost-file', { provider: 'openai-official', voice: 'alloy' });
  repository.inventory.mockClear();
  repository.savedVoices.mockClear();

  await offlineProvider('doc-with-a-lost-file', settings).synthesize('Its file is gone.', options);
  expect(repository.inventory).toHaveBeenCalledTimes(1);
  expect(repository.savedVoices).toHaveBeenCalledTimes(1);
  // And the sentence is still read, over the network.
  expect(mock.synthesize).toHaveBeenCalledTimes(1);
});

/**
 * Saved audio sends no request, so while a downloaded chapter plays the
 * Provider's connection idles — and a connection idle past about a minute can be
 * dead, so the first sentence of the next chapter, which is not downloaded, is
 * refused (#26; notes/NOTES_2026-09-23.md, 12:57). Each saved sentence served to
 * the reading asks for that connection to be kept warm; `keepWarm` decides how
 * often anything is actually sent (ADR 0040).
 */
it('keeps the Provider’s synthesis connection warm while it serves saved audio', async () => {
  const saved = spoken();
  mock.open.mockResolvedValue({ readClip: async () => ({ clip: saved, dropped: false }) });
  expect(await offlineProvider('doc', settings).synthesize('Saved.', options)).toBe(saved);
  expect(mock.keepWarm).toHaveBeenCalledTimes(1);
  expect(mock.keepWarm).toHaveBeenCalledWith('https://api.openai.com');
});

it('asks for nothing to be kept warm for a sentence it sends over the network', async () => {
  mock.open.mockResolvedValue({ readClip: async () => ({ clip: null, dropped: false }) });
  await offlineProvider('doc', settings).synthesize('Not saved.', options);
  expect(mock.synthesize).toHaveBeenCalledTimes(1);
  expect(mock.keepWarm).not.toHaveBeenCalled();
});

it('keeps nothing warm while the device is offline', async () => {
  mock.open.mockResolvedValue({
    readClip: async () => ({ clip: spoken(), dropped: false }),
    tasks: async () => [],
    catalog: { saveTasks: async () => {}, speechKeying: async () => null },
  });
  const stop = startDownloads();
  try {
    mock.connectivity!({ connected: false });
    await offlineProvider('doc', settings).synthesize('Saved, with no network.', options);
    expect(mock.keepWarm).not.toHaveBeenCalled();
    mock.connectivity!({ connected: true });
    await offlineProvider('doc', settings).synthesize('Saved, and back online.', options);
    expect(mock.keepWarm).toHaveBeenCalledWith('https://api.openai.com');
  } finally {
    stop();
  }
});
