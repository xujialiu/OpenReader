import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { speechKeying } from '../../src/offline/speech';
import { BLOCK_WALK } from '../../src/renderer/highlighter';

/** Real runtime, scheduler, factory, Providers and Reading Clip fetcher. Only
 * native I/O, credentials and the catalogue boundary are doubled. No network. */
const h = vi.hoisted(() => ({ open: vi.fn<() => Promise<unknown>>() }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: {
  addListener: () => ({ remove() {} }), beginBackground: async () => true, endBackground: async () => {},
  submitContinued: async () => false, updateContinued: async () => {}, finishContinued: async () => {},
} }));
vi.mock('../../src/app/library', () => ({ documentFile: () => { throw new Error('Already prepared'); } }));
vi.mock('../../src/keys/store', () => ({ readProviderKey: async () => ({ outcome: 'found', secret: 'fixture' }), readGatewayHeaders: async () => ({ outcome: 'found', secret: '' }) }));
vi.mock('../../src/offline/database', () => ({ offlineRepository: () => h.open() }));
let stop = () => {};
beforeEach(() => vi.resetModules());
afterEach(() => { stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const VOICE = 'alloy';
const sentence = 'One two three four five.';
const pcm = () => new Response(new Uint8Array([0, 1, 0, 2]), { headers: { 'Content-Type': 'audio/pcm' } });
const broken = () => new Response(new ReadableStream({ start(controller) {
  controller.enqueue(new Uint8Array([123]));
  setTimeout(() => controller.error(new TypeError('connection lost during body')), 10);
} }));

async function fixture(fish = false) {
  const voice = { provider: fish ? 'fish' as const : 'compatible' as const, voice: fish ? `zh/${'a'.repeat(32)}` : VOICE, label: 'Fixture' };
  const settings: AppSettings = { ...DEFAULT_SETTINGS, provider: voice.provider, voice: voice.voice, enabledProviders: [voice.provider],
    compatible: { ...DEFAULT_SETTINGS.compatible, baseURL: 'https://fixture.example', model: 'm' } };
  const chapter = { id: 'a', title: 'A', depth: 0, parent: null, section: 0, prepared: true, texts: [sentence], textCount: 1, textsLoaded: true };
  const saved = new Set<string>();
  const saveClip = vi.fn(async (_document: string, _voice: unknown, text: string) => { saved.add(text); return true; });
  h.open.mockResolvedValue({
    tasks: async () => [], catalog: { saveTasks: async () => {}, preparedWalk: async () => BLOCK_WALK, speechKeying: async () => speechKeying(settings) },
    plan: async () => ({ version: 2, chapters: [chapter] }), chapter: async () => chapter, progress: async () => [],
    hasClip: async (_document: string, _voice: unknown, text: string) => saved.has(text),
    readClip: async () => ({ clip: null, dropped: false }), saveClip, inventory: async () => [], savedVoices: async () => [],
  });
  (await import('../../src/app/consent')).configureConsent({ kept: () => true, keep: () => {}, ask: async () => true });
  const runtime = await import('../../src/offline/runtime');
  runtime.configureDownloads(settings);
  stop = runtime.startDownloads();
  await vi.waitFor(() => expect(runtime.downloadsReady()).toBe(true));
  // Drain startup before controlling the request and retry clocks.
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.useFakeTimers();
  return { runtime, voice, settings, saveClip };
}

it('the Reading reports a Fish body failure immediately rather than at its 60-second deadline', async () => {
  const { runtime, voice, settings } = await fixture(true);
  vi.stubGlobal('fetch', vi.fn(async () => broken()));
  const { createClipFetcher } = await import('../../src/playback/clips');
  const fetcher = createClipFetcher({ provider: runtime.offlineProvider('book', settings), voice: voice.voice });
  let result: unknown = 'pending';
  void fetcher.fetch(0, sentence, true).catch(error => { result = error; });
  await vi.advanceTimersByTimeAsync(20);
  expect(result).toMatchObject({ kind: 'network', retriable: true, message: expect.stringContaining('connection lost during body') });
});

it('a Download retries a failed body under the existing retry policy and saves only the completed Clip', async () => {
  const { runtime, voice, saveClip } = await fixture();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementationOnce(async () => broken()).mockImplementation(async () => pcm());
  vi.stubGlobal('fetch', fetch);
  runtime.enqueue('book', voice, ['a']);
  await vi.advanceTimersByTimeAsync(20);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(saveClip).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(saveClip).toHaveBeenCalledTimes(1);
  expect(runtime.downloadTasks('book')[0]).toMatchObject({ state: 'done', failed: [] });
});

it('neither caches nor saves a non-audio response; a later Reading can ask again after recovery', async () => {
  const { runtime, voice, settings, saveClip } = await fixture();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: { message: 'Insufficient balance' } }));
  vi.stubGlobal('fetch', fetch);
  runtime.enqueue('book', voice, ['a']);
  await vi.advanceTimersByTimeAsync(20);
  expect(saveClip).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1); // Not retried as a lost connection.
  expect(runtime.downloadTasks('book')[0].failed).toEqual(['a']);
  const provider = runtime.offlineProvider('book', settings);
  const options = { voice: voice.voice, signal: new AbortController().signal };
  await expect(provider.synthesize(sentence, options)).rejects.toThrow('Insufficient balance');
  expect(fetch).toHaveBeenCalledTimes(2); // Not cached by the Download.
  fetch.mockImplementation(async () => pcm());
  await expect(provider.synthesize(sentence, options)).resolves.toMatchObject({ audio: 'pcm' });
  expect(fetch).toHaveBeenCalledTimes(3); // Not cached by the failed Reading either.
});

it('keeps the full timeout for a genuinely stalled transfer that reports no failure', async () => {
  const { runtime, voice, settings } = await fixture(true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([123])); } }))));
  const { createClipFetcher } = await import('../../src/playback/clips');
  let result: unknown = 'pending';
  void createClipFetcher({ provider: runtime.offlineProvider('book', settings), voice: voice.voice }).fetch(0, sentence, true)
    .catch(error => { result = error; });
  await vi.advanceTimersByTimeAsync(59999);
  expect(result).toBe('pending');
  await vi.advanceTimersByTimeAsync(1);
  expect(result).toMatchObject({ kind: 'network', message: 'fish: no audio within 60s' });
});
