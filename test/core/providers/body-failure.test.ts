import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFishProvider } from '../../../src/core/providers/fish';
import { createOpenAICompatibleProvider } from '../../../src/core/providers/openai-compatible';
import { createSpeechifyProvider } from '../../../src/core/providers/speechify';
import { kokoroAdapter } from '../../../src/core/providers/local/kokoro';
import type { TTSProvider } from '../../../src/core/providers/types';

/** Real Providers; only the transport is controlled. Native terminal states are also checked on iOS. */
const compatible = (fetch: typeof globalThis.fetch, route: 'speech' | 'chat' = 'speech') =>
  createOpenAICompatibleProvider({ id: 'compatible', label: 'Fixture', apiKey: '', baseURL: 'https://fixture.example', model: 'm', keyRequired: false, route }, { fetch });
const cases: { name: string; voice: string; create(fetch: typeof globalThis.fetch): TTSProvider }[] = [
  { name: 'Fish event stream', voice: `zh/${'a'.repeat(32)}`, create: fetch => createFishProvider({ apiKey: 'fixture', model: 's2.1-pro-free', voices: '' }, { fetch }) },
  { name: 'OpenAI/Compatible raw audio', voice: 'alloy', create: fetch => compatible(fetch) },
  { name: 'OpenAI chat JSON', voice: 'alloy', create: fetch => compatible(fetch, 'chat') },
  { name: 'Speechify JSON', voice: 'en-US/george', create: fetch => createSpeechifyProvider({ apiKey: 'fixture' }, { fetch }) },
  { name: 'Kokoro captioned JSON', voice: 'af_bella', create: fetch => kokoroAdapter.create('https://fixture.example', { fetch }) },
  { name: 'Kokoro raw fallback', voice: 'af_bella', create: fetch => kokoroAdapter.create('https://fixture.example', {
    fetch: (url, init) => String(url).endsWith('/dev/captioned_speech') ? Promise.resolve(new Response('', { status: 404 })) : fetch(url, init),
  }) },
];
afterEach(() => vi.useRealTimers());

for (const fixture of cases) describe(fixture.name, () => {
  it('reports a transfer lost after the response arrived as a retriable network error, not bad JSON', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array([123]));
      setTimeout(() => controller.error(new TypeError('connection lost during body')), 10);
    } })));
    const result = fixture.create(fetch).synthesize('one two three four five', { voice: fixture.voice, signal: new AbortController().signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'SynthesisError', kind: 'network', retriable: true, message: expect.stringContaining('connection lost during body') });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1); // No new synthesis retry in the Provider.
  });

  it('also reports a body that failed before consumption began', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ start(controller) {
      controller.error(new TypeError('already lost'));
    } })));
    await expect(fixture.create(fetch).synthesize('one two three four five', { voice: fixture.voice, signal: new AbortController().signal }))
      .rejects.toMatchObject({ kind: 'network', retriable: true, message: expect.stringContaining('already lost') });
  });

  it('keeps a known authentication refusal even if its error body is lost', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new ReadableStream({ start(controller) {
      controller.error(new TypeError('error body lost'));
    } }), { status: 401 }));
    await expect(fixture.create(fetch).synthesize('one two three four five', { voice: fixture.voice, signal: new AbortController().signal }))
      .rejects.toMatchObject({ kind: 'auth', retriable: false });
  });

  it('ends an aborted body read without retrying, even if the platform read ignores abort', async () => {
    const controller = new AbortController();
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const response = new Response('');
    const held = () => { reading(); return new Promise<never>(() => {}); };
    vi.spyOn(response, 'text').mockImplementation(held);
    vi.spyOn(response, 'arrayBuffer').mockImplementation(held);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const result = fixture.create(fetch).synthesize('one two three four five', { voice: fixture.voice, signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ name: 'SynthesisError', retriable: false, message: expect.stringContaining('aborted') });
    await started;
    controller.abort();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not turn a cancelled request before headers into a retriable failure', async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    await expect(fixture.create(fetch).synthesize('one two three four five', { voice: fixture.voice, signal: controller.signal }))
      .rejects.toMatchObject({ retriable: false });
  });
});
