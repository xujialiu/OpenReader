import { describe, expect, it } from 'vitest';
import { createOpenAICompatibleProvider } from '../../../src/core/providers/openai-compatible';
import { kokoroAdapter } from '../../../src/core/providers/local/kokoro';
import type { TTSProvider } from '../../../src/core/providers/types';

const JSON_ERROR = '{"error":{"message":"Insufficient balance"}}';
const providers: { name: string; create(fetch: typeof globalThis.fetch): TTSProvider }[] = [
  { name: 'OpenAI/Compatible speech', create: fetch => createOpenAICompatibleProvider({ id: 'compatible', label: 'Fixture', apiKey: '', baseURL: 'https://fixture.example', model: 'm', keyRequired: false, route: 'speech' }, { fetch }) },
  { name: 'Kokoro raw fallback', create: fetch => kokoroAdapter.create('https://fixture.example', {
    fetch: (url, init) => String(url).endsWith('/dev/captioned_speech') ? Promise.resolve(new Response('', { status: 404 })) : fetch(url, init),
  }) },
];
for (const fixture of providers) describe(fixture.name, () => {
  const speak = (response: () => Response) => fixture.create(async () => response()).synthesize('A sentence.', { voice: 'alloy', signal: new AbortController().signal });
  it.each([
    ['application/json', JSON_ERROR],
    ['text/html; charset=utf-8', '<html>Sign in</html>'],
    ['text/plain', 'quota exceeded'],
  ])('rejects a 200 %s reply rather than returning PCM', async (type, body) => {
    await expect(speak(() => new Response(body, { headers: { 'Content-Type': type } })))
      .rejects.toMatchObject({ name: 'SynthesisError', retriable: false });
  });
  it('preserves the server message in a JSON error answered with 200', async () => {
    await expect(speak(() => new Response(JSON_ERROR, { headers: { 'Content-Type': 'application/json' } })))
      .rejects.toThrow('Insufficient balance');
  });
  it.each([null, 'application/octet-stream', 'audio/pcm;rate=24000'])('keeps valid raw samples under %s', async type => {
    const result = await speak(() => new Response(new Uint8Array([0, 1, 0, 2]), { headers: type ? { 'Content-Type': type } : {} }));
    expect(result).toMatchObject({ audio: 'pcm', sampleRate: 24000, samples: new Uint8Array([0, 1, 0, 2]) });
  });
  it('keeps the container signature authoritative when a PCM request receives encoded audio', async () => {
    const result = await speak(() => new Response(new Uint8Array([0x49, 0x44, 0x33, 4]), { headers: { 'Content-Type': 'audio/pcm' } }));
    expect(result).toMatchObject({ audio: 'encoded', mediaType: 'audio/mpeg' });
  });
});
