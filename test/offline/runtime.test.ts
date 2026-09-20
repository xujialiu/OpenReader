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
}));
vi.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  Platform: { OS: 'ios' },
}));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: null }));
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

const { downloadError, offlineProvider } = await import('../../src/offline/runtime');
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
  mock.open.mockResolvedValue({ readClip: async () => saved });
  expect(await offlineProvider('doc', settings).synthesize('Saved.', options)).toBe(saved);
  expect(mock.synthesize).not.toHaveBeenCalled();
});
