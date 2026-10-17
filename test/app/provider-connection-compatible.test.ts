import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { testProviderConnection } from '../../src/app/provider-connection';

/**
 * #209. OpenAI Compatible's Test connection, through the real factory, Provider
 * and fetch wiring, against servers answering 404 to both lists. Only the
 * Keychain and the global fetch are doubled.
 */
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'none' }),
  readGatewayHeaders: async () => ({ outcome: 'none' }),
}));

const real = globalThis.fetch;
afterEach(() => { globalThis.fetch = real; });

function serve(speech: () => Response) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${url}`);
    return url.endsWith('/v1/audio/speech') ? speech() : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return asked;
}
const at = (baseURL: string) => ({ ...DEFAULT_SETTINGS, compatible: { ...DEFAULT_SETTINGS.compatible, baseURL, model: 'tts-1' } });

describe('OpenAI Compatible connection test where neither list is published', () => {
  for (const baseURL of ['https://my-blog.example.com', 'https://tts.example.com/v1/audio/speech']) {
    it(`fails at ${baseURL}, which has no speech API under it, naming the Address`, async () => {
      const asked = serve(() => new Response('not found', { status: 404 }));
      await expect(testProviderConnection(at(baseURL), 'compatible')).rejects.toThrow(
        `OpenAI Compatible: nothing at ${baseURL} answers /v1/audio/speech (HTTP 404). Check the Address.`,
      );
      expect(asked).toEqual([`GET ${baseURL}/v1/models`, `GET ${baseURL}/v1/audio/voices`, `POST ${baseURL}/v1/audio/speech`]);
    });
  }

  it('passes a server whose only route is the speech route, and offers OpenAI\'s documented Voices for it', async () => {
    serve(() => Response.json({ detail: [{ type: 'missing', loc: ['body', 'model'], msg: 'Field required', input: {} }] }, { status: 422 }));
    const voices = await testProviderConnection(at('http://speech-only.home.example:8004'), 'compatible');
    expect(voices.map((voice) => voice.id)).toContain('alloy');
  });
});
