import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { Recipient } from '../../src/app/consent';
import type { LookupHandle } from '../../src/app/use-lookup';
import type { ReaderBridge } from '../../src/renderer/reader-bridge';
import { DEFAULT_LOOKUP, type LookupSettings } from '../../src/translation/settings';

/**
 * #109, ADR 0064: a selection reaches a lookup service only once the owner has
 * allowed that service. This is the real hook, mounted with a null component
 * and a fake bridge, with the services behind a double that counts what it was
 * sent. A no sends nothing and closes the lookup, as its close button does.
 * The next selection asks again.
 */
const mock = vi.hoisted(() => ({
  lookup: vi.fn(async (request: { text: string }) => ({ source: 'Youdao', text: `about ${request.text}`, pronunciations: [] })),
  asked: [] as { recipient: Recipient; answer(yes: boolean): void }[],
  kept: new Set<string>(),
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../src/debug/debug-log', () => ({ debugLog: () => {}, cutText: (text: string) => text }));
vi.mock('../../src/debug/requests', () => ({ loggedFetch: (_what: string, _which: string, fetch: typeof globalThis.fetch) => fetch }));
vi.mock('../../src/keys/store', () => ({ readTranslationKey: async () => ({ outcome: 'absent' }) }));
vi.mock('../../src/translation/services', () => ({ lookup: mock.lookup }));
vi.mock('../../src/translation/pronunciation-audio', () => ({ playPronunciation: async () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { useLookup } = await import('../../src/app/use-lookup');
const { configureConsent, consent } = await import('../../src/app/consent');

configureConsent({
  kept: (key) => mock.kept.has(key),
  keep: (key) => { mock.kept.add(key); },
  ask: (recipient) => new Promise<boolean>((resolve) => { mock.asked.push({ recipient, answer: resolve }); }),
});

type Selected = Parameters<Parameters<ReaderBridge['onSelection']>[0]>[0];
let select: (message: Selected) => void = () => { throw new Error('The hook has not subscribed to selections.'); };
const bridge = {
  setLookupEnabled: vi.fn(),
  onSelection: (callback: (message: Selected) => void) => { select = callback; return () => {}; },
  closeLookup: vi.fn(),
} as unknown as ReaderBridge;
const reading = { bridge, pause: vi.fn(), play: vi.fn(), status: { playing: false } };

let handle: LookupHandle | null = null;
let tree: ReactTestRenderer | null = null;
/** The real hook, handing its result out through `seen`. */
function Probe({ settings, seen }: { settings: LookupSettings; seen(handle: LookupHandle): void }) {
  seen(useLookup(settings, reading, true));
  return null;
}
const seen = (next: LookupHandle) => { handle = next; };

async function mount(settings: LookupSettings = { ...DEFAULT_LOOKUP, enabled: true }) {
  await act(async () => { tree = create(createElement(Probe, { settings, seen })); });
}
/** A selection as the page reports it once the owner lets go. */
async function selected(text: string) {
  await act(async () => { select({ text, expanded: false, selecting: false } as Selected); });
}
async function answer(yes: boolean) {
  await vi.waitFor(() => expect(mock.asked.length).toBeGreaterThan(0));
  await act(async () => { mock.asked.shift()!.answer(yes); });
}

beforeEach(() => {
  mock.lookup.mockClear();
  mock.asked.length = 0;
  mock.kept.clear();
  consent.again();
  vi.mocked(bridge.closeLookup).mockClear();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = null;
  handle = null;
});

it('asks before the selection leaves, naming the service the lookup would reach', async () => {
  await mount();
  await selected('serendipity');
  await vi.waitFor(() => expect(mock.asked).toHaveLength(1));
  expect(mock.asked[0]!.recipient).toMatchObject({ key: 'lookup:youdao', name: 'Youdao', sends: 'selection' });
  expect(mock.lookup).not.toHaveBeenCalled();
  await answer(true);
  await vi.waitFor(() => expect(handle?.result?.text).toBe('about serendipity'));
  expect(mock.kept).toEqual(new Set(['lookup:youdao']));
});

it('sends nothing on a no and closes the lookup, then asks again at the next selection', async () => {
  await mount();
  await selected('ephemeral');
  await answer(false);
  await vi.waitFor(() => expect(bridge.closeLookup).toHaveBeenCalled());
  expect(handle?.selection).toBeNull();
  expect(handle?.error).toBeNull();
  expect(mock.lookup).not.toHaveBeenCalled();

  await selected('ephemeral');
  await vi.waitFor(() => expect(mock.asked).toHaveLength(1));
  await answer(true);
  await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(1));
});

it('looks up without a question once the service is allowed, and asks about another service on its own', async () => {
  mock.kept.add('lookup:youdao');
  await mount();
  await selected('quiet');
  await vi.waitFor(() => expect(mock.lookup).toHaveBeenCalledTimes(1));
  expect(mock.asked).toHaveLength(0);
  await act(async () => tree!.update(createElement(Probe, { settings: { ...DEFAULT_LOOKUP, enabled: true, direction: 'en-en' }, seen })));
  await selected('quiet');
  await vi.waitFor(() => expect(mock.asked).toHaveLength(1));
  expect(mock.asked[0]!.recipient.key).toBe('lookup:free-dictionary');
  await answer(false);
  expect(mock.lookup).toHaveBeenCalledTimes(1);
});
