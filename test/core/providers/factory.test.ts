import { describe, expect, it, vi } from 'vitest';
import { SynthesisError } from '../../../src/core/providers/errors';
import { createProvider, type ProviderSettings } from '../../../src/core/providers/factory';
import type { ProviderId } from '../../../src/core/providers/types';

/**
 * The plugin's version of this file imported `DEFAULTS` from `core/settings.ts`,
 * which reaches `createZoteroPrefs()` and the Zotero global. That file has not
 * come across, and the settings the providers read are declared beside
 * `createProvider` instead — so the defaults live here, as plain values, which
 * is also what keeps this test pure dependency injection.
 *
 * The plugin's `system` case has gone with it: it was a value import of
 * `./system`, 1,190 lines of PowerShell and `osascript` plumbing behind one
 * `case`, and under ADR 0014 the operating system's own voices are a native
 * module rather than a member of this layer.
 */
const SETTINGS: ProviderSettings = {
  'openai-official': { apiKey: '', model: 'gpt-4o-mini-tts', voices: '' },
  compatible: { baseURL: 'http://localhost:8004', apiKey: '', model: 'tts-1', voices: '', headers: '' },
  speechify: { apiKey: '' },
  // `freeOnly` on, because an absent or unknown `model` header makes Fish fall
  // back to the paid model: the default that costs nothing is the one a test
  // fixture should carry.
  fish: { apiKey: '', freeOnly: true, voices: '' },
  local: { engine: 'kokoro', baseURL: 'http://localhost:8880', headers: '' },
};

const deps = { fetch: vi.fn() as unknown as typeof fetch };
const settings = (over: Partial<ProviderSettings>): ProviderSettings => ({ ...SETTINGS, ...over });
const opts = { voice: 'alloy', signal: new AbortController().signal };
const samples = () => new Response(new Uint8Array(4), { status: 200, headers: { 'Content-Type': 'audio/pcm' } });

describe('createProvider', () => {
  it('builds the OpenAI provider', () => {
    const p = createProvider('openai-official', SETTINGS, deps);
    expect(p.id).toBe('openai-official');
    expect(p.capabilities.wordTimestamps).toBe(false);
  });

  it('builds the OpenAI Compatible provider', () => {
    const p = createProvider('compatible', SETTINGS, deps);
    expect(p.id).toBe('compatible');
    expect(p.capabilities.wordTimestamps).toBe(false);
  });

  it('builds the Speechify provider', () => {
    const p = createProvider('speechify', SETTINGS, deps);
    expect(p.id).toBe('speechify');
    expect(p.capabilities.wordTimestamps).toBe(true);
  });

  it('builds the Fish Audio provider', () => {
    const p = createProvider('fish', SETTINGS, deps);
    expect(p.id).toBe('fish');
    expect(p.capabilities.wordTimestamps).toBe(true);
  });

  it('builds the configured local engine', () => {
    const p = createProvider('local', settings({ local: { engine: 'kokoro', baseURL: 'http://h:1', headers: '' } }), deps);
    expect(p.id).toBe('local');
    expect(p.capabilities.wordTimestamps).toBe(true);
  });

  it('throws a typed error when the configured local engine is not registered', () => {
    const s = settings({ local: { engine: 'piper', baseURL: 'http://h:1', headers: '' } });
    expect(() => createProvider('local', s, deps)).toThrow(SynthesisError);
  });

  // Word timings are a provider capability, not a client one (ADR 0005): the
  // factory reports what each provider can do so the caller can pick a
  // Highlight Level, and never claims one that cannot be delivered.
  //
  // `covered` is a Record over `ProviderId`, so a provider added to the union
  // without an answer here does not compile — which is how Fish arrived: three
  // of ADR 0005's providers report Word Timings over plain HTTP, and Fish is
  // the third. The plugin's azure, cloudflare, fishspeech, mimo and system are
  // absent from the union, not merely unlisted.
  it('builds every provider there is, and says of each whether it reports word timings', () => {
    const covered: Record<ProviderId, boolean> = {
      'openai-official': false,
      compatible: false,
      speechify: true,
      fish: true,
      local: true,
    };
    const ids = Object.keys(covered) as ProviderId[];
    expect(ids.map((id) => createProvider(id, SETTINGS, deps).capabilities.wordTimestamps)).toEqual(ids.map((id) => covered[id]));
    expect(ids.map((id) => createProvider(id, SETTINGS, deps).id)).toEqual(ids);
  });
});

// Each provider is built from its own section, so nothing typed for one ever
// reaches another
describe('the OpenAI and OpenAI Compatible sections', () => {
  it('sends the OpenAI section to api.openai.com with its key', async () => {
    const fetchImpl = vi.fn(async () => samples());
    const s = settings({
      'openai-official': { ...SETTINGS['openai-official'], apiKey: 'sk-1' },
      compatible: { ...SETTINGS.compatible, headers: 'X-Token: abc' },
    });
    await createProvider('openai-official', s, { fetch: fetchImpl as unknown as typeof fetch }).synthesize('Hello', opts);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-1' });
    expect(init.headers).not.toHaveProperty('X-Token');
  });

  it('hands the OpenAI Compatible section its address and the headers typed, and goes without a key', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith('/v1/audio/voices') ? Response.json({ voices: ['Emily.wav'] }) : samples()));
    const s = settings({
      'openai-official': { ...SETTINGS['openai-official'], apiKey: 'sk-openai' },
      compatible: { ...SETTINGS.compatible, baseURL: 'http://localhost:8004', headers: 'X-Token: abc; CF-Access-Client-Id: id' },
    });
    const p = createProvider('compatible', s, { fetch: fetchImpl as unknown as typeof fetch });
    await p.synthesize('Hello', { ...opts, voice: 'Emily.wav' });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('http://localhost:8004/v1/audio/speech');
    expect(init.headers).toMatchObject({ 'X-Token': 'abc', 'CF-Access-Client-Id': 'id' });
    expect(init.headers).not.toHaveProperty('Authorization');
    expect((await p.listVoices()).map((v) => v.id)).toEqual(['Emily.wav']);
  });
});

describe('the Fish Audio section', () => {
  it('sends its own key and its own free-model switch, and no other section’s key', async () => {
    const stream = () =>
      new Response(`data: ${JSON.stringify({ audio_base64: btoa('\xff\xfb\x90\x01'), chunk_seq: 0, alignment: null })}\n\n`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    const fetchImpl = vi.fn(async () => stream());
    const s = settings({
      'openai-official': { ...SETTINGS['openai-official'], apiKey: 'sk-openai' },
      fish: { apiKey: 'sk-fish', freeOnly: false, voices: '' },
    });
    await createProvider('fish', s, { fetch: fetchImpl as unknown as typeof fetch }).synthesize('Hello', { ...opts, voice: `mul/default` });
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.fish.audio/v1/tts/stream/with-timestamp');
    // `freeOnly: false` is the paid model, and it is named rather than left to
    // Fish's own fallback — which is the paid one whatever was meant.
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-fish', model: 's2.1-pro' });
  });

  it('takes the pasted model ids from its own field, links and all', async () => {
    const id = 'a'.repeat(32);
    const fetchImpl = vi.fn(async () => Response.json({ _id: id, title: 'Pasted', languages: ['en'], type: 'tts', state: 'trained' }));
    const s = settings({ fish: { apiKey: 'sk-fish', freeOnly: true, voices: `https://fish.audio/m/${id}/`, includeOfficial: false, includeOwn: false } });
    const voices = await createProvider('fish', s, { fetch: fetchImpl as unknown as typeof fetch }).listVoices();
    expect((fetchImpl as any).mock.calls[0][0]).toBe(`https://api.fish.audio/model/${id}`);
    expect(voices.map((v) => v.label)).toEqual(['Pasted']);
  });
});

describe('Local engine extra headers', () => {
  it('hands the engine the headers typed into the settings', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ voices: ['af_bella'] }));
    const s = settings({ local: { ...SETTINGS.local, headers: 'CF-Access-Client-Id: id' } });
    await createProvider('local', s, { fetch: fetchImpl as unknown as typeof fetch }).listVoices();
    expect((fetchImpl as any).mock.calls[0][1].headers).toMatchObject({ 'CF-Access-Client-Id': 'id' });
  });
});
