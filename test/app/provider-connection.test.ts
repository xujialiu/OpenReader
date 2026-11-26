import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { testProviderConnection } from '../../src/app/provider-connection';
const mock = vi.hoisted(() => ({
  check: vi.fn(async () => {}), list: vi.fn(async () => [{ id: 'a', label: 'A', locale: 'en' }]),
  create: vi.fn(), key: vi.fn(async () => ({ outcome: 'found', secret: 'test-key' })),
}));
vi.mock('../../src/keys/store', () => ({ readProviderKey: mock.key, readGatewayHeaders: async () => ({ outcome: 'found', secret: 'test-headers' }) }));
vi.mock('../../src/core/providers/factory', () => ({ createProvider: (...args: unknown[]) => {
  mock.create(...args); return { checkConnection: mock.check, listVoices: mock.list };
} }));
beforeEach(() => { vi.clearAllMocks(); mock.check.mockResolvedValue(undefined); });
describe('connection test', () => {
  it('tests a disabled provider with its own credentials without selecting or enabling it', async () => {
    const settings = { ...DEFAULT_SETTINGS, compatible: { baseURL: 'https://example.invalid', model: 'tts-1' } };
    await testProviderConnection(settings, 'compatible');
    expect(mock.create.mock.calls[0][0]).toBe('compatible');
    expect(mock.create.mock.calls[0][1]).toMatchObject({ compatible: { apiKey: 'test-key', headers: 'test-headers' }, 'openai-official': { apiKey: '' } });
    expect(settings.enabledProviders).toEqual([]);
    expect(settings.provider).toBe('openai-official');
  });
  it('does not accept a static voice list as a successful connection', async () => {
    mock.check.mockRejectedValueOnce(new Error('invalid key'));
    await expect(testProviderConnection({ ...DEFAULT_SETTINGS, openai: { model: 'tts-1' } }, 'openai-official')).rejects.toThrow('invalid key');
    expect(mock.list).not.toHaveBeenCalled();
  });
  it('does not send requests when required configuration is missing', async () => {
    await expect(testProviderConnection(DEFAULT_SETTINGS, 'compatible')).rejects.toThrow('needs');
    expect(mock.create).not.toHaveBeenCalled();
  });
});

it.each(['openai-official', 'azure', 'fish', 'speechify', 'compatible', 'local'] as const)(
  'gives applicable timeout guidance for %s', async (id) => {
    vi.useFakeTimers();
    try {
      mock.check.mockImplementationOnce(() => new Promise<void>(() => {}));
      const settings = { ...DEFAULT_SETTINGS, openai: { model: 'tts-1' }, azure: { region: 'eastasia' },
        compatible: { baseURL: 'https://example.invalid', model: 'tts-1' },
        local: { ...DEFAULT_SETTINGS.local, baseURL: 'https://example.invalid' } };
      const guidance = id === 'compatible' || id === 'local' ? 'the address' : 'your connection';
      const result = expect(testProviderConnection(settings, id)).rejects.toThrow(
        `Connection timed out. Check ${guidance} and try again.`);
      await vi.advanceTimersByTimeAsync(15_000);
      await result;
    } finally { vi.useRealTimers(); }
  },
);
