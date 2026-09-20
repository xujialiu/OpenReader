import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { useVoiceLists, type VoiceLists } from '../../src/app/use-voices';
import { voiceInList } from '../../src/app/voices';

const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  constructor(_directory: string, private name: string) {}
  get exists() { return disk.has(this.name); }
  textSync() { return disk.get(this.name); }
  write(value: string) { disk.set(this.name, value); }
} }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ secretsWritten: 0 }) }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'test-key' }),
  readGatewayHeaders: async () => ({ outcome: 'missing' }),
}));
const listed = vi.hoisted(() => vi.fn(async () => [
  { id: 'zh/example', label: 'Bingbing — Female professional (ZH)', locale: 'zh' },
]));
vi.mock('../../src/core/providers/factory', () => ({ createProvider: () => ({ listVoices: listed }) }));
// No native UI is rendered: this exercises the real hook across Reader lifetimes.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('keeps a known voice name when the reader closes and opens again, without another request', async () => {
  const settings = { ...DEFAULT_SETTINGS, provider: 'fish' as const, enabledProviders: ['fish'] as const, voice: 'zh/example' };
  let lists: VoiceLists;
  function Probe() { lists = useVoiceLists(settings); return null; }
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Probe)); });
  await act(async () => { lists.ask('fish'); });
  expect(voiceInList(lists!.voicesOf('fish'), settings.voice)?.label).toBe('Bingbing — Female professional (ZH)');
  await act(async () => { tree.unmount(); });
  await act(async () => { tree = create(createElement(Probe)); });
  try {
    expect(voiceInList(lists!.voicesOf('fish'), settings.voice)?.label).toBe('Bingbing — Female professional (ZH)');
    expect(listed).toHaveBeenCalledTimes(1);
  } finally { await act(async () => { tree.unmount(); }); }
});

it('restores caption names after a process restart without treating old names as a current voice list', async () => {
  vi.resetModules();
  const catalog = await import('../../src/app/voice-catalog');
  const settings = { ...DEFAULT_SETTINGS, provider: 'fish' as const, enabledProviders: ['fish'] as const, voice: 'zh/example' };
  expect(catalog.knownVoice(settings)?.label).toBe('Bingbing — Female professional (ZH)');
  expect(catalog.catalogVoices(catalog.voiceCatalogSnapshot(), settings, 'fish')).toBeNull();
});

it('keeps self-hosted voice names scoped to the server that supplied them', async () => {
  const catalog = await import('../../src/app/voice-catalog');
  const settings = { ...DEFAULT_SETTINGS, provider: 'compatible' as const, voice: 'same-id',
    compatible: { ...DEFAULT_SETTINGS.compatible, baseURL: 'https://one.example' } };
  catalog.rememberVoices(settings, 'compatible', [{ id: 'same-id', label: 'First server', locale: 'en' }]);
  expect(catalog.knownVoice(settings)?.label).toBe('First server');
  expect(catalog.knownVoice({ ...settings, compatible: { ...settings.compatible, baseURL: 'https://two.example' } })).toBeNull();
});


it('changes Fish selectable sources without losing a remembered voice caption', async () => {
  const catalog = await import('../../src/app/voice-catalog');
  const settings = { ...DEFAULT_SETTINGS, provider: 'fish' as const, voice: 'en/own-voice' };
  catalog.rememberVoices(settings, 'fish', [{ id: settings.voice, label: 'My voice', locale: 'en' }]);
  const changed = { ...settings, fish: { ...settings.fish, includeOwn: true } };
  expect(catalog.catalogVoices(catalog.voiceCatalogSnapshot(), changed, 'fish')).toBeNull();
  expect(catalog.knownVoice(changed)?.label).toBe('My voice');
});
