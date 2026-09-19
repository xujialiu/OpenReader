import { describe, expect, it, vi } from 'vitest';
import { createOpenAIProvider, OPENAI_DEFAULT_VOICES, OPENAI_URL } from '../../../src/core/providers/openai';

// The OpenAI section: api.openai.com and nothing else, a key required,
// OpenAI's documented voices when nothing is typed — a proxy or a mirror goes
// through the OpenAI Compatible section instead.
const cfg = { apiKey: 'sk-test', model: 'gpt-4o-mini-tts', voices: '' };
const provider = (fetchImpl: unknown, over: Partial<typeof cfg> = {}) => createOpenAIProvider({ ...cfg, ...over }, { fetch: fetchImpl as typeof fetch });
const opts = { voice: 'alloy', signal: new AbortController().signal };

/** What `response_format: "pcm"` answers: raw 16-bit mono samples, 24 kHz, no header. */
const samples = () => new Response(new Uint8Array(4), { status: 200, headers: { 'Content-Type': 'audio/pcm' } });

describe('createOpenAIProvider', () => {
  it('is the openai provider, speaking to api.openai.com on the speech route', async () => {
    const fetchImpl = vi.fn(async () => samples());
    const p = provider(fetchImpl);
    expect(p.id).toBe('openai-official');
    expect(OPENAI_URL).toBe('https://api.openai.com');
    const result = await p.synthesize('Hello', opts);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    // OpenAI documents `pcm` as 24 kHz 16-bit signed little-endian, headerless,
    // which is exactly what the playback engine enqueues (ADR 0013)
    expect(JSON.parse(init.body)).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: 'Hello', response_format: 'pcm' });
    expect(result).toMatchObject({ audio: 'pcm', sampleRate: 24_000 });
  });

  // ADR 0005: OpenAI's speech API returns audio and nothing else, so its clips
  // are highlighted at utterance level and no timing is invented for them
  it('reports no word timings, and never estimates any', async () => {
    const fetchImpl = vi.fn(async () => samples());
    expect(provider(fetchImpl).capabilities.wordTimestamps).toBe(false);
    expect('timestamps' in (await provider(fetchImpl).synthesize('Hello', opts))).toBe(false);
  });

  it('insists on a key before any request', async () => {
    const fetchImpl = vi.fn();
    await expect(provider(fetchImpl, { apiKey: '' }).synthesize('Hi', opts)).rejects.toMatchObject({ kind: 'no-key', message: 'OpenAI API key is not set' });
    await expect(provider(fetchImpl, { apiKey: '' }).listModels!()).rejects.toMatchObject({ kind: 'no-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("offers OpenAI's documented voices, which the API does not list, unless the user typed some", async () => {
    const notFound = vi.fn(async () => new Response('', { status: 404 }));
    expect((await provider(notFound).listVoices()).map((v) => v.id)).toEqual([...OPENAI_DEFAULT_VOICES]);
    expect((await provider(notFound, { voices: 'alloy, verse' }).listVoices()).map((v) => v.id)).toEqual(['alloy', 'verse']);
    expect(OPENAI_DEFAULT_VOICES).toContain('alloy');
  });
});
