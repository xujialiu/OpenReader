import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleProvider } from '../../src/core/providers/openai-compatible';
import { OPENAI_DEFAULT_VOICES } from '../../src/core/providers/openai';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { useVoiceLists, voiceLists, type VoiceLists } from '../../src/app/use-voices';

// Doubled: the disk, the Keychain and the network. Everything else is the app's own.
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  constructor(_directory: string, private name: string) {}
  get exists() { return disk.has(this.name); }
  textSync() { return disk.get(this.name); }
  write(value: string) { disk.set(this.name, value); }
} }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'missing' }),
  readGatewayHeaders: async () => ({ outcome: 'missing' }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const answering = (reply: () => Response): typeof fetch => (async () => reply()) as unknown as typeof fetch;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the provider: a gateway error is not "this server publishes no voices"', () => {
  const make = (status: number) =>
    createOpenAICompatibleProvider(
      { id: 'compatible', label: 'OpenAI Compatible', apiKey: '', baseURL: 'https://tts.home.example', model: 'm', keyRequired: false, route: 'speech', defaultVoices: OPENAI_DEFAULT_VOICES },
      { fetch: answering(() => new Response('bad gateway', { status })) },
    );
  for (const status of [500, 502, 503, 504, 530, 429]) {
    it(`listVoices rejects on ${status}`, async () => {
      await expect(make(status).listVoices()).rejects.toMatchObject({ kind: status === 429 ? 'rate-limit' : 'network', retriable: true });
    });
  }
  it('404 still falls back (control)', async () => {
    expect((await make(404).listVoices()).length).toBe(OPENAI_DEFAULT_VOICES.length);
  });
});

describe('the app: the start-up listing, then the Voice list opened once the server is back', () => {
  const SERVER = { voices: ['Emily.wav', 'Olivia.wav'] };
  const settingsFor = (host: string) => ({ ...DEFAULT_SETTINGS, provider: 'compatible' as const, voice: 'Emily.wav',
    enabledProviders: ['compatible'] as const, compatible: { baseURL: `https://${host}.example`, model: 'chatterbox' } });

  /** The real hook, and the check the Voice Drawer makes as it opens (src/app/voice-sheet.tsx:118-119). */
  async function openVoiceList(settings: ReturnType<typeof settingsFor>) {
    let lists!: VoiceLists;
    function Probe() { lists = useVoiceLists(settings); return null; }
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(createElement(Probe)); });
    let asked = false;
    await act(async () => {
      if (lists.enabled.includes('compatible') && !lists.voicesOf('compatible')) { asked = true; lists.ask('compatible'); }
      await settle();
    });
    const result = { asked, shown: lists.voicesOf('compatible')?.map((voice) => voice.id) ?? null, note: lists.note };
    await act(async () => { tree.unmount(); });
    return result;
  }

  /** shell.tsx:144 at start with `atStart` as the network, then the server back, then the list opened. */
  async function startThenOpen(host: string, atStart: typeof fetch) {
    const settings = settingsFor(host);
    globalThis.fetch = atStart;
    voiceLists.prefetch(settings);
    await settle();
    globalThis.fetch = answering(() => Response.json(SERVER));
    return openVoiceList(settings);
  }

  for (const status of [500, 502, 503, 504, 530, 429]) {
    it(`asks again and lists the server's Voices after a ${status} at start`, async () => {
      expect(await startThenOpen(`gateway-${status}`, answering(() => new Response('bad gateway', { status }))))
        .toEqual({ asked: true, shown: SERVER.voices, note: null });
    });
  }
  it('asks again after a 200 whose body was lost, rather than treating it as an unusable complete list', async () => {
    const cut = answering(() => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection lost')); } })));
    expect(await startThenOpen('body-lost', cut)).toEqual({ asked: true, shown: SERVER.voices, note: null });
  });
  it('does so after a refused connection at start (control)', async () => {
    const refused = (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    expect(await startThenOpen('down', refused)).toEqual({ asked: true, shown: SERVER.voices, note: null });
  });
  it('keeps the documented names after a 404 at start (control)', async () => {
    const opened = await startThenOpen('no-list', answering(() => new Response('', { status: 404 })));
    expect(opened).toEqual({ asked: false, shown: [...OPENAI_DEFAULT_VOICES], note: null });
  });
});
