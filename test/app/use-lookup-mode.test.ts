import { createElement, useEffect, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupHandle } from '../../src/app/use-lookup';
import { SELECTION_MESSAGE } from '../../src/renderer/messages';
import type { ReaderBridge } from '../../src/renderer/reader-bridge';
import { DEFAULT_LOOKUP, parseLookupSettings, type LookupMode } from '../../src/translation/settings';

const mock = vi.hoisted(() => ({
  lookup: vi.fn(async (request: { text: string }) => ({ source: 'test', text: request.text, pronunciations: [] })),
}));
vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove() {} }) } }));
vi.mock('../../src/debug/debug-log', () => ({ debugLog() {}, cutText: (text: string) => text }));
vi.mock('../../src/debug/requests', () => ({ loggedFetch: (_what: string, _which: string, fetch: typeof globalThis.fetch) => fetch }));
vi.mock('../../src/keys/store', () => ({ readTranslationKey: async () => ({ outcome: 'absent' }) }));
vi.mock('../../src/translation/services', () => ({ lookup: mock.lookup }));
vi.mock('../../src/translation/pronunciation-audio', () => ({ playPronunciation: async () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { useLookup } = await import('../../src/app/use-lookup');
const { configureConsent } = await import('../../src/app/consent');
configureConsent({ kept: () => true, keep() {}, ask: async () => true });

type Selected = Parameters<Parameters<ReaderBridge['onSelection']>[0]>[0];
let select: (message: Selected) => void;
const reading = {
  bridge: { setLookupEnabled() {}, onSelection(callback: typeof select) { select = callback; return () => {}; }, closeLookup() {} } as unknown as ReaderBridge,
  pause() {}, play() {}, carryOn() {}, status: { playing: false },
};
let disk: string;
let writes: LookupMode[];
let handle: LookupHandle;
let tree: ReactTestRenderer | null = null;
function Probe() {
  // Disk serialization/projection is real; the native settings filesystem is not.
  const [settings, setSettings] = useState(() => parseLookupSettings(JSON.parse(disk)));
  const remember = (preferredMode: LookupMode) => {
    const next = parseLookupSettings({ ...settings, preferredMode });
    disk = JSON.stringify(next);
    writes.push(preferredMode);
    setSettings(next);
  };
  const lookup = useLookup(settings, reading, true, reading.pause, remember);
  useEffect(() => { handle = lookup; }, [lookup]);
  return null;
}
async function mount() {
  await act(async () => { tree = create(createElement(Probe)); });
}
async function selected(text: string, multipleWords = false, selecting = false) {
  await act(async () => { select({ type: SELECTION_MESSAGE, text, multipleWords, selecting }); });
}
beforeEach(() => {
  disk = JSON.stringify({ ...DEFAULT_LOOKUP, enabled: true, direction: 'en-zh', target: 'en', preferredMode: 'dictionary' });
  writes = [];
  mock.lookup.mockClear();
});
afterEach(async () => { await act(async () => tree?.unmount()); tree = null; });

describe('explicit lookup preference versus the current result (#323)', () => {
  it('remembers both manual choices across close, new words, and a remount/restart', async () => {
    await mount();
    await selected('give');
    expect(handle.selection?.mode).toBe('dictionary');
    await act(async () => handle.mode('translation'));
    expect(writes).toEqual(['translation']);
    await act(async () => handle.close());
    await selected('other');
    expect(handle.selection?.mode).toBe('translation');
    await act(async () => tree?.unmount());
    await mount();
    await selected('another');
    expect(handle.selection?.mode).toBe('translation');
    await act(async () => handle.mode('dictionary'));
    await act(async () => handle.close());
    await selected('word');
    expect(handle.selection?.mode).toBe('dictionary');
    expect(writes).toEqual(['translation', 'dictionary']);
  });

  it('automatic Translation never writes the preference and shrinking restores it', async () => {
    await mount();
    await selected('give');
    await selected('give up', true);
    expect(handle.selection?.mode).toBe('translation');
    expect(writes).toEqual([]);
    await selected('give', false);
    expect(handle.selection?.mode).toBe('dictionary');
    await selected('other');
    expect(handle.selection?.mode).toBe('dictionary');
    expect(writes).toEqual([]);
  });

  it('preserves the manual override through release and Retry until the selected text changes', async () => {
    await mount();
    await selected('give up', true);
    await act(async () => handle.mode('dictionary'));
    await selected('give up', true, true);
    expect(handle.selection?.mode).toBe('dictionary');
    expect(handle.loading).toBe(false);
    await selected('give up', true, false);
    expect(handle.selection?.mode).toBe('dictionary');
    await act(async () => handle.retry());
    expect(handle.selection?.mode).toBe('dictionary');
    await selected('give up hope', true);
    expect(handle.selection?.mode).toBe('translation');
    await selected('give', false);
    expect(handle.selection?.mode).toBe('dictionary');
    expect(writes).toEqual(['dictionary']);
  });

  it('saving a manual mode does not send a second identical network request', async () => {
    await mount();
    await selected('give');
    const before = mock.lookup.mock.calls.length;
    await act(async () => handle.mode('translation'));
    expect(mock.lookup).toHaveBeenCalledTimes(before + 1);
    expect(writes).toEqual(['translation']);
  });

  it('does not remember a mode click when no lookup is open', async () => {
    await mount();
    await act(async () => handle.mode('translation'));
    expect(writes).toEqual([]);
    expect(handle.selection).toBeNull();
  });
});
