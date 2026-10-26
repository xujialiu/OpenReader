import { readFileSync } from 'node:fs';
import { createContext, createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pin } from '../structural';

/**
 * The reader's `Debug` row and its alert (#305, ADR 0082). The alert and a
 * Document's actions drawer are rendered with the phone's views drawn as plain
 * elements that keep their props, as `rename-alert.test.ts` and
 * `document-actions-names.test.ts` do; the Debug Log is the real writer over a
 * folder in memory, and the clipboard a stand-in. What only the phone can run
 * (the reader's answer, the grant) is guarded over the source text, as
 * `reader-actions-drawer.test.ts` explains.
 */
const native = vi.hoisted(() => ({ value: '', get() { return this.value; } }));
const clipboard = vi.hoisted(() => ({ copied: [] as string[], refuse: null as Error | null }));
const hosts = vi.hoisted(() => async (...names: string[]) => {
  const { createElement: element } = await import('react');
  return Object.fromEntries(names.map((name) => [name, ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => element(name, props, children)]));
});
vi.mock('../../src/debug/mode', () => ({ DEBUG_MODE: true }));
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: vi.fn() } }));
vi.mock('expo-clipboard', () => ({
  setStringAsync: async (text: string) => {
    if (clipboard.refuse) throw clipboard.refuse;
    clipboard.copied.push(text);
    return true;
  },
}));
vi.mock('../../src/app/controls', () => ({ SchemeContext: createContext(null), INK: { attention: 'red' } }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: (value: boolean) => ({ disabled: value }) }));
vi.mock('@expo/ui/swift-ui', async () => {
  const views = await hosts('Alert', 'Trigger', 'Actions', 'Message', 'Button', 'Host', 'Text', 'TextField');
  return { ...views, Alert: Object.assign(views.Alert, { Trigger: views.Trigger, Actions: views.Actions, Message: views.Message }), useNativeState: () => native };
});
vi.mock('../../src/app/drawer', () => hosts('Drawer', 'DrawerChevron', 'DrawerFooter', 'DrawerRow', 'DrawerRowText', 'DrawerScroll'));
vi.mock('../../src/app/appearance-sheet', () => hosts('AppearanceControls', 'FontList'));
vi.mock('../../src/app/download-sheet', () => hosts('DownloadContent'));
vi.mock('../../src/app/highlight-section', () => hosts('HighlightPage'));
vi.mock('../../src/app/folder-actions', () => ({ useMovePage: () => ({ header: {}, body: null, restart() {} }) }));
vi.mock('../../src/app/reading-host', () => ({ useHeldReading: () => ({ current: null }) }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({
  library: { entries: [{ id: 'sha256:5f1c9a2b7e0d4c3a', title: 'The Count of Monte Cristo', position: null }], folderSnapshot: { tree: { documents: {} } } },
  settings: { appearance: {}, provider: 'openai', voice: '' }, setSettings: vi.fn(),
}) }));
vi.mock('../../src/app/settings', () => ({ PROVIDER_LABELS: {} }));
vi.mock('../../src/app/share-document', () => ({ shareDocument: vi.fn() }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/renderer', () => ({ spineIndexOf: () => 0 }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { DebugNoteAlert } = await import('../../src/app/debug-note-alert');
const { ReaderActions } = await import('../../src/app/reader-actions');
const { createDebugLog, localStamp, setDebugLogWriter } = await import('../../src/debug/debug-log');

const TIME = '2026-10-20 14:03:12.345 +08:00';

async function alert() {
  let view!: ReactTestRenderer;
  const onSave = vi.fn();
  const onCancel = vi.fn();
  native.value = '';
  await act(async () => { view = create(createElement(DebugNoteAlert, { time: TIME, onCancel, onSave })); });
  const all = (type: string) => view.root.findAll((node) => String(node.type) === type);
  const text = (node: { children: unknown[] }): string => node.children.map((child) => typeof child === 'string' ? child : text(child as { children: unknown[] })).join('');
  return { view, onSave, onCancel, all, text,
    button: (label: string) => all('Button').find((node) => node.props.label === label)!,
    unmount: () => act(async () => view.unmount()) };
}

describe('the Debug Note alert (#305)', () => {
  it('is titled Debug Note and shows the time it copies, once', async () => {
    const a = await alert();
    expect(a.all('Alert')[0].props.title).toBe('Debug Note');
    expect(a.all('Message').map((node) => a.text(node))).toEqual([TIME]);
    await a.unmount();
  });

  it('asks in one field, What went wrong, and offers Cancel and Save and Copy', async () => {
    const a = await alert();
    expect(a.all('TextField').map((node) => node.props.placeholder)).toEqual(['What went wrong']);
    expect(a.all('Button').map((node) => node.props.label)).toEqual(['Cancel', 'Save and Copy']);
    expect(a.button('Cancel').props.role).toBe('cancel');
    await a.unmount();
  });

  it('saves what the field holds, a blank comment too', async () => {
    const a = await alert();
    native.value = 'the highlight fell behind';
    await act(async () => a.button('Save and Copy').props.onPress());
    native.value = '';
    await act(async () => a.button('Save and Copy').props.onPress());
    expect(a.onSave.mock.calls).toEqual([['the highlight fell behind'], ['']]);
    expect(a.button('Save and Copy').props.modifiers).toBeUndefined();
    await a.unmount();
  });

  it('cancels without saving', async () => {
    const a = await alert();
    await act(async () => a.button('Cancel').props.onPress());
    expect(a.onCancel).toHaveBeenCalledOnce();
    expect(a.onSave).not.toHaveBeenCalled();
    await a.unmount();
  });
});

const SOURCE = new URL('../../src/app/', import.meta.url).pathname;
/** The code without its comments, which name the rules in the words they guard. */
function code(name: string): string {
  return readFileSync(SOURCE + name, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe("the reader's Debug row (#305)", () => {
  const ID = 'sha256:5f1c9a2b7e0d4c3a';
  /** 2026-10-20 14:03:12.345 in UTC+8; the Debug Note's time is in the machine's zone, as the phone's is in its own. */
  const TAPPED = Date.UTC(2026, 9, 20, 6, 3, 12, 345);
  let log: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(TAPPED);
    clipboard.copied = [];
    clipboard.refuse = null;
    native.value = '';
    log = new Map();
    setDebugLogWriter(createDebugLog({ now: () => Date.now(), files: {
      list: () => [...log.keys()], size: (name) => (log.get(name) ?? '').length,
      append: (name, more) => void log.set(name, (log.get(name) ?? '') + more), remove: (name) => void log.delete(name),
    } }));
  });
  afterEach(() => {
    setDebugLogWriter(null);
    vi.useRealTimers();
  });

  async function drawer(debugNote: boolean) {
    let view!: ReactTestRenderer;
    const onClose = vi.fn();
    await act(async () => { view = create(createElement(ReaderActions, { document: ID as never, appearance: true, debugNote, onClose })); });
    const all = (type: string) => view.root.findAll((node) => String(node.type) === type);
    const words = (node: { children: unknown[] }): string => node.children.map((child) => typeof child === 'string' ? child : words(child as { children: unknown[] })).join('');
    return { view, onClose, all, words,
      rows: () => all('DrawerRow').map((row) => ({ icon: row.props.icon, text: words(row) })),
      press: (label: string) => act(async () => { all('DrawerRow').find((row) => words(row) === label)!.props.onPress(); }),
      button: (label: string) => all('Button').find((node) => node.props.label === label)!,
      lines: () => (log.get('debug-log-000001.txt') ?? '').trim().split('\n').filter(Boolean),
      unmount: () => act(async () => view.unmount()) };
  }

  it('is the last row of the menu, named Debug, with the bug icon, only where it is granted', async () => {
    const granted = await drawer(true);
    expect(granted.rows().at(-1)).toEqual({ icon: 'bug', text: 'Debug' });
    await granted.unmount();
    const library = await drawer(false);
    expect(library.rows().map((row) => row.icon)).not.toContain('bug');
    await library.unmount();
    pin(code('icon.tsx'), '  bug: ', 'icon.tsx bug');
  });

  it('fixes the Debug Note’s time at the tap and shows it in the alert', async () => {
    const d = await drawer(true);
    await d.press('Debug');
    vi.setSystemTime(TAPPED + 20_000);
    expect(d.all('Alert').map((node) => node.props.title)).toEqual(['Debug Note']);
    expect(d.all('Message').map((node) => d.words(node))).toEqual([localStamp(TAPPED)]);
    await d.unmount();
  });

  it('Save and Copy writes the note under the tap’s time, copies the time and the comment, and closes the drawer', async () => {
    const d = await drawer(true);
    await d.press('Debug');
    vi.setSystemTime(TAPPED + 20_000);
    native.value = 'the highlight fell behind';
    await act(async () => d.button('Save and Copy').props.onPress());
    expect(d.lines()).toHaveLength(1);
    expect(d.lines()[0]).toBe(
      `${localStamp(TAPPED + 20_000)} [debug-note] ${localStamp(TAPPED)} "The Count of Monte Cristo" (5f1c9a2b): the highlight fell behind`,
    );
    expect(clipboard.copied).toEqual([`${localStamp(TAPPED)} the highlight fell behind`]);
    expect(d.onClose).toHaveBeenCalledOnce();
    expect(d.all('Alert')).toEqual([]);
    await d.unmount();
  });

  it('keeps the note and the drawer when the copy fails, and says so under the rows', async () => {
    clipboard.refuse = new Error('The pasteboard is not available');
    const d = await drawer(true);
    await d.press('Debug');
    await act(async () => d.button('Save and Copy').props.onPress());
    expect(d.lines()[0]).toContain('[debug-note]');
    expect(d.onClose).not.toHaveBeenCalled();
    expect(d.all('DrawerFooter').map((node) => d.words(node))).toEqual(['The Debug Note is saved, but it could not be copied: The pasteboard is not available']);
    await d.unmount();
  });

  it('Cancel writes nothing, copies nothing and leaves the menu open', async () => {
    const d = await drawer(true);
    await d.press('Debug');
    await act(async () => d.button('Cancel').props.onPress());
    expect(d.lines()).toEqual([]);
    expect(clipboard.copied).toEqual([]);
    expect(d.onClose).not.toHaveBeenCalled();
    expect(d.all('Alert')).toEqual([]);
    expect(d.rows().at(-1)).toEqual({ icon: 'bug', text: 'Debug' });
    await d.unmount();
  });

  it('is granted by the reader in Debug Mode only, and never by the Library', () => {
    pin(code('reader-screen.tsx'), 'debugNote={DEBUG_MODE}', 'reader-screen.tsx ReaderActions');
    expect(code('library-screen.tsx')).not.toContain('debugNote');
  });
});

describe("the reader's answer to a Debug Note (#305)", () => {
  it('writes its status line and asks the page for a snapshot named by the time, in Debug Mode only', () => {
    const view = code('reading-view.tsx');
    pin(view, 'if (!DEBUG_MODE) return undefined;', 'reading-view.tsx Debug Note guard');
    pin(view, 'onDebugNote((time) => {', 'reading-view.tsx onDebugNote');
    pin(view, 'hlog(statusLine(status, AppState.currentState));', 'reading-view.tsx Debug Note status line');
    pin(view, 'snapshot(`Debug Note ${time}`);', 'reading-view.tsx Debug Note snapshot');
  });
});
