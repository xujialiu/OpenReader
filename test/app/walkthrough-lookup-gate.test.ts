import { createRequire } from 'node:module';

import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { BuildVariant } from '../../build-variant';
import type { LookupGateStatus } from '../../src/app/walkthrough-lookup-gate';
import type { LookupHandle } from '../../src/app/use-lookup';
import type { ReaderBridge } from '../../src/renderer/reader-bridge';

/** HOST ONLY: the actual file pollers, lookup hook, Consent and service parser;
 * fetch, Expo File, native AppState and renderer input are doubles, not Mac input.
 */
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), opened: [] as string[], writes: [] as string[], failWrite: false }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'Documents' },
  File: class {
    path: string;
    constructor(directory: string, name: string) { this.path = `${directory}/${name}`; disk.opened.push(this.path); }
    get exists() { return disk.files.has(this.path); }
    textSync() { return disk.files.get(this.path)!; }
    write(text: string) {
      if (disk.failWrite) throw new Error('Synthetic disk refusal');
      disk.files.set(this.path, text); disk.writes.push(text);
    }
  },
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../src/keys/store', () => ({ readTranslationKey: async () => ({ outcome: 'absent' }) }));
vi.mock('../../src/translation/pronunciation-audio', () => ({ playPronunciation: async () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const nativeFetch = globalThis.fetch;
// The installed React Native fetch polyfill, not Node's different null handling.
const { Request: RuntimeRequest } = createRequire(import.meta.url)('whatwg-fetch') as { Request: typeof Request };
const endpoint = (word: string) => `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
function definition(text = 'The original response definition.') {
  return new Response(JSON.stringify([{ meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: text }] }] }]), { status: 200 });
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const readStatus = () => JSON.parse(disk.files.get('Documents/lookup-gate-status.json') ?? 'null') as LookupGateStatus | null;
let tree: ReactTestRenderer | undefined;
let handle: LookupHandle;
let select: Parameters<ReaderBridge['onSelection']>[0];
let seq = 1_794_090_813_387_150;
let harness: typeof import('../../src/app/walkthrough-harness');
let settings: typeof import('../../src/translation/settings')['DEFAULT_LOOKUP'];
let Probe: (props: { width: number }) => null;

async function mount(variant: BuildVariant = 'debug', kept = true) {
  vi.doMock('../../src/build/variant', () => ({ BUILD_VARIANT: variant }));
  harness = await import('../../src/app/walkthrough-harness');
  const { useLookup } = await import('../../src/app/use-lookup');
  const { DEFAULT_LOOKUP } = await import('../../src/translation/settings');
  const { configureConsent } = await import('../../src/app/consent');
  configureConsent({ kept: () => kept, keep: () => {}, ask: async () => false });
  settings = { ...DEFAULT_LOOKUP, enabled: true, direction: 'en-en' };
  const bridge = {
    setLookupEnabled() {}, closeLookup() {},
    onSelection(callback: typeof select) { select = callback; return () => {}; },
  } as unknown as ReaderBridge;
  const reading = { bridge, pause() {}, play() {}, carryOn() {}, status: { playing: false } };
  Probe = function LookupHarnessProbe() {
    // The mounted shell alone handles existing fetch commands. New gate commands
    // must run once even when Reader/ReaderScreen have their own file pollers.
    harness.useHarnessCommands(command => {
      if (command.do === 'unbreakfetch') harness.unbreakFetch();
      if (command.do === 'watchfetch') harness.watchFetch(String(command.host));
      if (command.do === 'breakfetch') harness.breakFetch(String(command.host), Number(command.from));
    });
    harness.useHarnessCommands(() => {});
    harness.useHarnessCommands(() => {});
    handle = useLookup(settings, reading, true, reading.pause, () => {});
    return null;
  };
  await act(async () => { tree = create(createElement(Probe, { width: 900 })); });
}
async function command(action: string, fields: Record<string, unknown> = {}) {
  disk.files.set('Documents/harness.json', JSON.stringify({ seq: ++seq, do: 'lookupgate', action, run: 'host-m7', ...fields }));
  await act(async () => { vi.advanceTimersByTime(250); });
  return readStatus();
}
async function selected(text: string) {
  await act(async () => { select({ type: 'openreader:selection', text, multipleWords: false, selecting: false }); });
}

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(1_794_090_813_400);
  disk.files.clear(); disk.opened = []; disk.writes = []; disk.failWrite = false;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { tree?.unmount(); }); tree = undefined;
  harness?.unbreakFetch();
  globalThis.fetch = nativeFetch;
  vi.doUnmock('../../src/build/variant'); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

it('HOST: holds an already received original Response across a pending layout rerender, then parses it and restores fetch', async () => {
  const network = deferred<Response>();
  const original = vi.fn<typeof fetch>(() => network.promise);
  globalThis.fetch = original;
  await mount();
  expect((await command('hold', { service: 'free-dictionary' }))?.command).toMatchObject({ ok: true, action: 'hold' });
  await selected('hope');
  expect(original).toHaveBeenCalledTimes(1);
  const response = definition();
  const json = vi.spyOn(response, 'json');
  await act(async () => { network.resolve(response); });
  expect(readStatus()?.gate).toMatchObject({ installed: true, count: 1, held: 1, pending: 1 });
  expect(handle.loading).toBe(true); expect(handle.result).toBeNull();
  expect(json).not.toHaveBeenCalled(); expect(response.bodyUsed).toBe(false);
  await act(async () => { tree!.update(createElement(Probe, { width: 670 })); });
  expect(handle.loading).toBe(true); expect(original).toHaveBeenCalledTimes(1);
  expect((await command('state'))?.gate?.requests[0]).toMatchObject({ query: 'hope', state: 'held', startedAt: expect.any(Number), heldAt: expect.any(Number) });
  expect((await command('release'))?.command).toMatchObject({ ok: true, released: 1 });
  expect(json).toHaveBeenCalledTimes(1);
  expect(handle.loading).toBe(false); expect(handle.result?.text).toContain('The original response definition.');
  expect(readStatus()?.gate?.requests[0]).toMatchObject({ state: 'released', releasedAt: expect.any(Number), abortedAt: null });
  expect((await command('restore'))?.gate).toMatchObject({ installed: false, count: 1, pending: 0, stoppedBy: 'restore' });
  expect(globalThis.fetch).toBe(original);
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect(vi.getTimerCount()).toBe(0);
});

it('counts same-URL duplicates and a different word independently, releasing the identical unread Responses', async () => {
  const responses = [definition(), definition(), definition()];
  let index = 0;
  const original = vi.fn<typeof fetch>(async () => responses[index++]!);
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const waits = [fetch(endpoint('hope')), fetch(endpoint('hope')), fetch(endpoint('chapter'))];
  await act(async () => {});
  expect(readStatus()?.gate).toMatchObject({ count: 3, held: 3, pending: 3 });
  expect(readStatus()?.gate?.requests.map(request => [request.id, request.query, request.state])).toEqual([
    [1, 'hope', 'held'], [2, 'hope', 'held'], [3, 'chapter', 'held'],
  ]);
  expect((await command('release'))?.command).toMatchObject({ ok: true, released: 3 });
  const delivered = await Promise.all(waits);
  delivered.forEach((response, i) => { expect(response).toBe(responses[i]); expect(response.bodyUsed).toBe(false); });
  // Keep watching after release; a layout-caused request must not be hidden.
  const fourth = fetch(endpoint('another'));
  await act(async () => {});
  expect(readStatus()?.gate?.count).toBe(4);
  const rejected = fourth.catch(error => error);
  await command('restore');
  expect((await rejected).name).toBe('AbortError');
  expect(globalThis.fetch).toBe(original);
});

it('only gates the exact existing service GET route, never similar hosts, other services, credentials or POSTs', async () => {
  const original = vi.fn<typeof fetch>(async () => definition());
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const inputs: [RequestInfo | URL, RequestInit?][] = [
    ['https://api.dictionaryapi.dev.evil.invalid/api/v2/entries/en/hope'],
    ['https://evil.invalid/api.dictionaryapi.dev/api/v2/entries/en/hope'],
    ['http://api.dictionaryapi.dev/api/v2/entries/en/hope'],
    ['https://api.dictionaryapi.dev:8443/api/v2/entries/en/hope'],
    ['https://name:private-value@api.dictionaryapi.dev/api/v2/entries/en/hope'],
    [endpoint('hope') + '?key=private-value'], [endpoint('hope') + '#private-value'],
    ['https://api.dictionaryapi.dev/api/v2/entries/fr/hope'],
    ['https://www.youdao.com/w/hope/'], ['https://aidemo.youdao.com/trans', { method: 'POST', body: 'q=private-selection' }],
    ['https://api.openai.com/v1/audio/speech', { method: 'POST', body: 'private-body' }],
    ['https://sync.invalid/folder'], [endpoint('hope'), { method: 'POST', body: 'private-body' }],
    [new Request(endpoint('hope'), { method: 'POST', body: 'private-body' })],
  ];
  for (const [input, init] of inputs) await fetch(input, init);
  expect(readStatus()?.gate?.count).toBe(0);
  expect(original).toHaveBeenCalledTimes(inputs.length);
  inputs.forEach(([input, init], i) => { expect(original.mock.calls[i]).toEqual([input, init]); });
  await command('restore');
  const status = JSON.stringify(readStatus());
  for (const forbidden of ['private', 'headers', 'body', 'authorization', 'openai', 'youdao', 'sync.invalid']) expect(status).not.toContain(forbidden);
});

it('counts non-word and malformed queries without retaining arbitrary text; status never reads secrets or response content', async () => {
  const original = vi.fn<typeof fetch>(async () => definition('private-response-content'));
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const headers = { Authorization: 'Bearer private-credential' };
  const queries = ['one two', 'x'.repeat(81), 'line\nprivate', 'chapter'];
  const waits = queries.map(query => fetch(endpoint(query), { headers }));
  waits.push(fetch(endpoint('bad') + '%ZZ'));
  await act(async () => {});
  expect(readStatus()?.gate?.requests.map(request => request.query)).toEqual([null, null, null, 'chapter', null]);
  const encoded = JSON.stringify(readStatus());
  for (const forbidden of ['private', 'Authorization', 'Bearer', 'headers', 'response-content', 'one two', 'x'.repeat(81)]) expect(encoded).not.toContain(forbidden);
  await command('release'); await Promise.all(waits);
  await command('restore');
});

it.each(['requested', 'held'] as const)('a caller abort while %s cancels the entire control and restores fetch, even if the network ignores abort', async state => {
  const network = deferred<Response>();
  const original = vi.fn<typeof fetch>(() => network.promise);
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const parent = new AbortController();
  const wait = fetch(new Request(endpoint('hope'), { signal: parent.signal })).catch(error => error);
  if (state === 'held') await act(async () => { network.resolve(definition()); });
  await act(async () => { parent.abort(); });
  expect((await wait).name).toBe('AbortError');
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'aborted' });
  expect(readStatus()?.gate?.requests[0]).toMatchObject({ state: 'aborted', releasedAt: null, abortedAt: expect.any(Number) });
  expect(globalThis.fetch).toBe(original);
  await act(async () => { network.resolve(definition()); });
  expect(readStatus()?.gate?.held).toBe(0);
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect(vi.getTimerCount()).toBe(0);
});

it('handles a signal already aborted before fetch without starting an unowned network request', async () => {
  const original = vi.fn<typeof fetch>(async () => definition());
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const parent = new AbortController(); parent.abort();
  await expect(fetch(endpoint('hope'), { signal: parent.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(original).not.toHaveBeenCalled(); expect(globalThis.fetch).toBe(original);
  expect(readStatus()?.gate?.stoppedBy).toBe('aborted');
});

it.each(['requested', 'held'] as const)('the fixed 12s delivery deadline while %s settles the promise, aborts network and removes the wrapper', async state => {
  const network = deferred<Response>();
  const original = vi.fn<typeof fetch>(() => network.promise);
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const wait = fetch(endpoint('hope')).catch(error => error);
  if (state === 'held') await act(async () => { network.resolve(definition()); });
  await act(async () => { vi.advanceTimersByTime(12_000); });
  expect((await wait).name).toBe('AbortError');
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'deadline' });
  expect(readStatus()?.gate?.requests[0]?.state).toBe('deadline');
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect(globalThis.fetch).toBe(original);
  await act(async () => { network.resolve(definition()); tree!.unmount(); }); tree = undefined;
  expect(vi.getTimerCount()).toBe(0);
});

it('also refuses a late release when the runtime clock passes the deadline before its timer executes', async () => {
  const original = vi.fn<typeof fetch>(async () => definition());
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const wait = fetch(endpoint('hope')).catch(error => error);
  await act(async () => {});
  vi.setSystemTime(Date.now() + 12_000);
  expect((await command('release'))?.command).toMatchObject({ ok: false, released: 0 });
  expect((await wait).name).toBe('AbortError'); expect(globalThis.fetch).toBe(original);
});

it.each(['requested', 'held'] as const)('unbreakfetch while %s settles without releasing a fake success and leaves no orphan', async state => {
  const network = deferred<Response>();
  const original = vi.fn<typeof fetch>(() => network.promise);
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const staleWrapper = globalThis.fetch;
  const wait = fetch(endpoint('hope')).catch(error => error);
  if (state === 'held') await act(async () => { network.resolve(definition()); });
  disk.files.set('Documents/harness.json', JSON.stringify({ seq: ++seq, do: 'unbreakfetch' }));
  await act(async () => { vi.advanceTimersByTime(250); });
  expect((await wait).name).toBe('AbortError'); expect(globalThis.fetch).toBe(original);
  expect(readStatus()?.gate).toMatchObject({ pending: 0, stoppedBy: 'unbreakfetch' });
  await act(async () => { network.resolve(definition()); });
  await staleWrapper(endpoint('chapter'));
  expect(readStatus()?.gate?.count).toBe(1);
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['throw', 'reject'] as const)('an underlying fetch %s preserves its real error and cleans up the gate', async how => {
  const failure = new TypeError('private-underlying-error');
  const original = vi.fn<typeof fetch>(() => { if (how === 'throw') throw failure; return Promise.reject(failure); });
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  await expect(fetch(endpoint('hope'))).rejects.toBe(failure);
  expect(globalThis.fetch).toBe(original);
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'failed' });
  expect(readStatus()?.gate?.requests[0]?.state).toBe('failed');
  expect(JSON.stringify(readStatus())).not.toContain('private-underlying-error');
});

it('preserves the caller’s abort ownership for the original streaming body even after release and restore', async () => {
  const original = vi.fn<typeof fetch>((_input, init) => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      controller.enqueue(new TextEncoder().encode('partial'));
    } });
    return Promise.resolve(new Response(stream));
  });
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const parent = new AbortController();
  const waiting = fetch(endpoint('hope'), { signal: parent.signal });
  await act(async () => {}); await command('release');
  const response = await waiting;
  const body = response.text().catch(error => error);
  await command('restore');
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(false);
  parent.abort(); expect((await body).name).toBe('AbortError');
  expect(readStatus()?.gate?.requests[0]?.state).toBe('released');
});

it('does not stack with breakfetch/watchfetch/unknown observers and refuses other observers while installed', async () => {
  const original = vi.fn<typeof fetch>(async () => definition());
  globalThis.fetch = original;
  await mount();
  for (const install of [() => harness.breakFetch('unrelated.invalid', 1), () => harness.watchFetch('unrelated.invalid'), () => { globalThis.fetch = (input, init) => original(input, init); }]) {
    install(); const observer = globalThis.fetch;
    expect((await command('hold', { service: 'free-dictionary' }))?.command).toMatchObject({ ok: false, error: 'fetch-observer-present' });
    expect(globalThis.fetch).toBe(observer); harness.unbreakFetch();
  }
  await command('hold', { service: 'free-dictionary' });
  const gate = globalThis.fetch;
  harness.watchFetch('api.dictionaryapi.dev'); harness.breakFetch('api.dictionaryapi.dev', 1);
  expect(globalThis.fetch).toBe(gate);
  expect((await command('hold', { service: 'free-dictionary' }))?.command.error).toBe('fetch-observer-present');
  await command('restore'); expect(globalThis.fetch).toBe(original);
});

it('reports invalid, absent, wrong-run and premature commands truthfully without changing the active gate', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount();
  expect((await command('release'))?.command).toMatchObject({ ok: false, error: 'gate-run-mismatch' });
  expect((await command('hold', { service: 'youdao' }))?.command.error).toBe('unsupported-service');
  expect((await command('hold', { service: 'free-dictionary', headers: 'private-value' }))?.command.error).toBe('invalid-command');
  expect(JSON.stringify(readStatus())).not.toContain('private-value');
  await command('hold', { service: 'free-dictionary' });
  expect((await command('release'))?.command).toMatchObject({ ok: false, error: 'no-held-response', released: 0 });
  expect((await command('restore', { run: 'different-run' }))?.command.error).toBe('gate-run-mismatch');
  expect(readStatus()?.gate?.installed).toBe(true);
  await command('restore');
  expect((await command('release'))?.command.error).toBe('gate-not-installed');
});

it('consumes a gate command once globally and ignores stale/replayed sequence numbers without reinstalling', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount();
  const held = await command('hold', { service: 'free-dictionary' });
  expect(held?.command).toMatchObject({ ok: true, seq });
  await command('restore');
  disk.files.delete('Documents/harness.json');
  disk.files.set('Documents/harness.json', JSON.stringify({ seq: seq - 1, do: 'lookupgate', action: 'hold', run: 'host-m7', service: 'free-dictionary' }));
  await act(async () => { vi.advanceTimersByTime(500); });
  expect(globalThis.fetch).toBe(original); expect(readStatus()?.command.seq).toBe(seq);
});

it('bounds the idle gate lifetime and request metadata, restores fetch on overflow and cancels every pending promise', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  await act(async () => { vi.advanceTimersByTime(120_000); });
  expect(readStatus()?.gate).toMatchObject({ installed: false, stoppedBy: 'expired' });
  expect(globalThis.fetch).toBe(original);
  await command('hold', { service: 'free-dictionary' });
  const waits = Array.from({ length: 65 }, () => fetch(endpoint('hope')).catch(error => error));
  await Promise.all(waits);
  expect(readStatus()?.gate).toMatchObject({ installed: false, count: 65, pending: 0, overflow: true, stoppedBy: 'overflow' });
  expect(readStatus()?.gate?.requests).toHaveLength(64);
  expect(disk.files.get('Documents/lookup-gate-status.json')!.length).toBeLessThan(20_000);
  expect(globalThis.fetch).toBe(original);
});

it('a failed immediate status write restores fetch and cancels the test control instead of silently holding', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  disk.failWrite = true;
  await expect(fetch(endpoint('hope'))).rejects.toMatchObject({ name: 'AbortError' });
  expect(original).not.toHaveBeenCalled(); expect(globalThis.fetch).toBe(original);
  disk.failWrite = false;
  expect((await command('state'))?.gate?.stoppedBy).toBe('status-write-failed');
});

it('keeps legitimate Consent ahead of the gate and sends nothing after refusal', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount('debug', false); await command('hold', { service: 'free-dictionary' });
  await selected('hope');
  expect(original).not.toHaveBeenCalled(); expect(readStatus()?.gate?.count).toBe(0);
  expect(handle.selection).toBeNull();
  await command('restore');
});

it.each(['formal', 'free'] as const)('the actual %s role ignores all gate commands, constructs no File, and cannot install a fetch hook', async variant => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  vi.stubGlobal('__DEV__', true);
  await mount(variant);
  for (const action of ['hold', 'state', 'release', 'restore']) await command(action, { service: 'free-dictionary' });
  harness.breakFetch('api.dictionaryapi.dev', 1); harness.watchFetch('api.dictionaryapi.dev'); harness.unbreakFetch();
  expect(disk.opened).toEqual([]); expect(readStatus()).toBeNull();
  expect(globalThis.fetch).toBe(original); expect(vi.getTimerCount()).toBe(0);
  await selected('hope');
  expect(handle.result?.text).toContain('The original response definition.');
  expect(original).toHaveBeenCalledTimes(1);
});

it('unmounting the final real harness poller cancels a held response and clears every owned timer', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const pending = fetch(endpoint('hope')).catch(error => error);
  await act(async () => {});
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect((await pending).name).toBe('AbortError');
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'unmounted' });
  expect(globalThis.fetch).toBe(original); expect(vi.getTimerCount()).toBe(0);
});

it('the real lookup hook owns selection cancellation; a new query cannot revive the old held result', async () => {
  const first = deferred<Response>();
  const original = vi.fn<typeof fetch>().mockImplementationOnce(() => first.promise).mockImplementation(async () => definition('The new query definition.'));
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  await selected('hope');
  await act(async () => { first.resolve(definition('The old query definition.')); });
  expect(readStatus()?.gate?.held).toBe(1);
  await selected('chapter');
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'aborted' });
  expect(original).toHaveBeenCalledTimes(2);
  expect(handle.selection?.text).toBe('chapter'); expect(handle.result?.text).toContain('The new query definition.');
  expect(handle.result?.text).not.toContain('The old query definition.'); expect(globalThis.fetch).toBe(original);
});

it('real HTTP refusal semantics survive held delivery instead of becoming a fake dictionary success', async () => {
  const response = new Response('{"message":"not found"}', { status: 404 });
  const original = vi.fn<typeof fetch>(async () => response); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  await selected('unknownword');
  expect(readStatus()?.gate?.held).toBe(1); expect(handle.error).toBeNull();
  await command('release');
  expect(handle.error).toBe('No dictionary entry found.'); expect(handle.result).toBeNull();
  expect(response.status).toBe(404); expect(response.bodyUsed).toBe(false);
  await command('restore');
});

it('honors RequestInit signal override rather than cancelling from the Request’s superseded signal', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const superseded = new AbortController(); superseded.abort();
  const current = new AbortController();
  const pending = fetch(new Request(endpoint('hope'), { signal: superseded.signal }), { signal: current.signal });
  await act(async () => {}); expect(readStatus()?.gate?.held).toBe(1);
  await command('release'); expect((await pending).ok).toBe(true);
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(false);
  await command('restore');
});

it('invalidates a replaced fetch observer during state readback without overwriting the observer it no longer owns', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const pending = fetch(endpoint('hope')).catch(error => error);
  await act(async () => {});
  const replacement: typeof fetch = (input, init) => original(input, init);
  globalThis.fetch = replacement;
  expect((await command('state'))?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'observer-changed' });
  expect((await pending).name).toBe('AbortError'); expect(globalThis.fetch).toBe(replacement);
  await command('restore');
  await act(async () => { tree!.unmount(); }); tree = undefined;
  expect(globalThis.fetch).toBe(replacement); expect(vi.getTimerCount()).toBe(0);
});

it('an inactive old gate cannot erase a newly installed hook, while legacy unbreakfetch retains its separate restore contract', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  await command('restore');
  harness.watchFetch('unrelated.invalid');
  const replacement = globalThis.fetch;
  expect((await command('restore'))?.gate).toMatchObject({ installed: false, pending: 0 });
  expect(globalThis.fetch).toBe(replacement);
  harness.unbreakFetch(); expect(globalThis.fetch).toBe(original);
});

it('a new hold refuses a foreign observer instead of erasing it during the previous gate snapshot', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const pending = fetch(endpoint('hope')).catch(error => error);
  await act(async () => {});
  const replacement: typeof fetch = (input, init) => original(input, init);
  globalThis.fetch = replacement;
  expect((await command('hold', { service: 'free-dictionary', run: 'next-control' }))?.command).toMatchObject({ ok: false, error: 'fetch-observer-present' });
  expect(globalThis.fetch).toBe(replacement);
  expect(readStatus()?.gate).toMatchObject({ run: 'host-m7', installed: false, pending: 0, stoppedBy: 'observer-changed' });
  expect((await pending).name).toBe('AbortError');
});

it.each(['restore', 'deadline', 'unmount'] as const)('%s cleanup cancels only owned work and preserves a replacement fetch identity', async exit => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const pending = fetch(endpoint('hope')).catch(error => error);
  await act(async () => {});
  const replacement: typeof fetch = (input, init) => original(input, init);
  globalThis.fetch = replacement;
  if (exit === 'restore') await command('restore');
  if (exit === 'deadline') await act(async () => { vi.advanceTimersByTime(12_000); });
  if (exit === 'unmount') { await act(async () => { tree!.unmount(); }); tree = undefined; }
  expect(globalThis.fetch).toBe(replacement);
  expect((await pending).name).toBe('AbortError');
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0 });
  await act(async () => { tree?.unmount(); }); tree = undefined;
  expect(vi.getTimerCount()).toBe(0); expect(globalThis.fetch).toBe(replacement);
});

it('an active restore publishes both complete provisional and finalized matching receipts', async () => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  disk.writes = [];
  await command('restore');
  const writes = disk.writes.map(text => JSON.parse(text) as LookupGateStatus);
  expect(writes).toHaveLength(2);
  expect(writes.map(status => status.command)).toEqual([
    { seq, action: 'restore', run: 'host-m7', ok: false, error: null, released: 0 },
    { seq, action: 'restore', run: 'host-m7', ok: true, error: null, released: 0 },
  ]);
  for (const status of writes) {
    expect(status.observedAt).toBe(Date.now());
    expect(status.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'restore' });
  }
});

it.each([
  ['requested', undefined], ['held', undefined], ['requested', null], ['held', null],
] as const)('%s delivery inherits the installed runtime Request signal when init.signal is %s', async (state, signal) => {
  const network = deferred<Response>();
  const original = vi.fn<typeof fetch>(() => network.promise); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const parent = new AbortController();
  const input = new RuntimeRequest(endpoint('hope'), { signal: parent.signal });
  expect(new RuntimeRequest(input, { signal }).signal).toBe(parent.signal);
  const pending = fetch(input, { signal }).catch(error => error);
  if (state === 'held') await act(async () => { network.resolve(definition()); });
  await act(async () => { parent.abort(); });
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'aborted' });
  expect((await pending).name).toBe('AbortError');
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect(globalThis.fetch).toBe(original);
  await act(async () => { network.resolve(definition()); });
});

it.each([undefined, null] as const)('does not start network for an already aborted runtime Request with init.signal %s', async signal => {
  const original = vi.fn<typeof fetch>(async () => definition()); globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const parent = new AbortController(); parent.abort();
  const input = new RuntimeRequest(endpoint('hope'), { signal: parent.signal });
  expect(new RuntimeRequest(input, { signal }).signal).toBe(parent.signal);
  const pending = fetch(input, { signal }).catch(error => error);
  expect(original).not.toHaveBeenCalled();
  expect((await pending).name).toBe('AbortError');
  expect(readStatus()?.gate).toMatchObject({ installed: false, pending: 0, stoppedBy: 'aborted' });
});

it.each([undefined, null] as const)('preserves original Response identity, read count and released stream abort with runtime init.signal %s', async signal => {
  let response!: Response;
  const original = vi.fn<typeof fetch>((_input, init) => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      controller.enqueue(new TextEncoder().encode('[{"partial":'));
    } });
    response = new Response(stream);
    return Promise.resolve(response);
  });
  globalThis.fetch = original;
  await mount(); await command('hold', { service: 'free-dictionary' });
  const parent = new AbortController();
  const input = new RuntimeRequest(endpoint('hope'), { signal: parent.signal });
  const pending = fetch(input, { signal });
  const json = vi.spyOn(response, 'json');
  await act(async () => {});
  expect(json).not.toHaveBeenCalled(); expect(response.bodyUsed).toBe(false);
  await command('release');
  const delivered = await pending; expect(delivered).toBe(response);
  const body = delivered.json().catch(error => error);
  expect(json).toHaveBeenCalledTimes(1);
  await command('restore');
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(false);
  parent.abort();
  expect(original.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  expect((await body).name).toBe('AbortError'); expect(json).toHaveBeenCalledTimes(1);
});
