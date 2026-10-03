import { createElement, useSyncExternalStore } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { asDocumentId, type LibraryEntry } from '../../src/core/document';
import { createFolderStore, type LibraryTarget } from '../../src/core/folders';
import { useLibrarySelection } from '../../src/app/use-library-selection';

const mock = vi.hoisted(() => ({ shell: {} as unknown, alert: vi.fn() }));
vi.mock('react-native', () => ({ Alert: { alert: mock.alert } }));
vi.mock('../../src/app/routes', () => ({ useShell: () => mock.shell }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const ids = ['a', 'b', 'c'].map((letter) => asDocumentId(`sha256:${letter.repeat(64)}`)!);
const targets: LibraryTarget[] = ids.map((id) => ({ kind: 'document', id }));
const entries = (): LibraryEntry[] => ids.map((id, index) => ({
  id, title: `Document ${index + 1}`, format: 'epub', publicationId: null, publicationIdSource: 'none',
  position: null, voice: null, stamp: { at: 1, device: 'test' },
}));
beforeEach(() => mock.alert.mockReset());
async function mount() {
  let live = entries();
  let serial = 0;
  const folders = createFolderStore({ read: () => null, write: () => {}, id: () => `folder-${++serial}` });
  const report = vi.fn();
  let blur = () => {};
  const navigation = { addListener: vi.fn((_event: string, callback: () => void) => { blur = callback; return () => {}; }) };
  const remove = vi.fn(async (id: string) => { live = live.filter((entry) => entry.id !== id); });
  let selection!: ReturnType<typeof useLibrarySelection>;
  let renderer!: ReactTestRenderer;
  function Probe() {
    const folderSnapshot = useSyncExternalStore(folders.subscribe, folders.getSnapshot);
    mock.shell = { library: { entries: live, folders, folderSnapshot, current: (id: string) => live.find((entry) => entry.id === id), report } };
    const rows: LibraryTarget[] = [
      ...folderSnapshot.tree.folders.filter((folder) => folder.parent === folderSnapshot.tree.current).map((folder): LibraryTarget => ({ kind: 'folder', id: folder.id })),
      ...live.filter((entry) => (folderSnapshot.tree.documents[entry.id] ?? null) === folderSnapshot.tree.current).map((entry): LibraryTarget => ({ kind: 'document', id: entry.id })),
    ];
    selection = useLibrarySelection(navigation, rows, remove);
    return null;
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  return {
    get selection() { return selection; }, folders, report, remove,
    run: async (fn: () => void) => { await act(async () => { fn(); }); },
    blur: () => blur(),
    refresh: () => renderer.update(createElement(Probe)),
    add: () => { live = [...live, { ...entries()[0], id: asDocumentId(`sha256:${'d'.repeat(64)}`)!, title: 'Added' }]; },
    close: async () => { await act(async () => renderer.unmount()); },
  };
}
function answer(index: number) {
  const buttons = mock.alert.mock.lastCall?.[2];
  buttons[index].onPress();
}

it('starts empty, toggles mixed rows, selects all, deselects all, and clears on cancel', async () => {
  const h = await mount();
  await h.run(() => { h.folders.create('Folder', null); h.selection.begin(); });
  expect(h.selection.active).toBe(true);
  expect(h.selection.selected).toEqual([]);
  await h.run(() => h.selection.toggle(targets[0]));
  await h.run(() => h.selection.toggle({ kind: 'folder', id: 'folder-1' }));
  expect(h.selection.selected).toHaveLength(2);
  await h.run(() => h.selection.selectAll());
  expect(h.selection.selected).toHaveLength(4);
  await h.run(() => h.selection.selectAll());
  expect(h.selection.selected).toEqual([]);
  await h.run(() => h.selection.cancel());
  expect(h.selection.active).toBe(false);
  await h.close();
});

it('enters selection directly through a two-finger range and keeps it current-level only', async () => {
  const h = await mount();
  expect(h.selection.active).toBe(false);
  await h.run(() => h.selection.sweepTo(new Set([`document:${ids[0]}`, `document:${ids[1]}`])));
  expect(h.selection.active).toBe(true);
  expect(h.selection.selected).toEqual(targets.slice(0, 2));
  await h.run(() => h.selection.openMove());
  await h.run(() => h.selection.sweepTo(new Set([`document:${ids[2]}`])));
  expect(h.selection.selected).toEqual(targets.slice(0, 2));
  await h.run(() => h.selection.closeMove());
  await h.run(() => h.selection.sweepTo(new Set()));
  expect(h.selection.active).toBe(true);
  expect(h.selection.selected).toEqual([]);
  await h.close();
});

it('preserves selection on move/deletion cancellation, but clears it on page blur', async () => {
  const h = await mount();
  await h.run(() => h.selection.begin());
  await h.run(() => h.selection.toggle(targets[0]));
  await h.run(() => h.selection.openMove());
  await h.run(() => h.selection.toggle(targets[1]));
  expect(h.selection.selected).toEqual([targets[0]]);
  await h.run(() => h.selection.closeMove());
  await h.run(() => h.selection.deleteSelected());
  await h.run(() => answer(0));
  expect(h.selection.selected).toEqual([targets[0]]);
  await h.run(h.refresh); // a re-render, unlike navigation away, preserves the selection
  expect(h.selection.selected).toEqual([targets[0]]);
  await h.run(h.blur);
  expect(h.selection.active).toBe(false);
  expect(h.selection.selected).toEqual([]);
  await h.close();
});

it('counts recursive contents in one confirmation and exits only after full success', async () => {
  const h = await mount();
  await h.run(() => {
    const parent = h.folders.create('Parent', null);
    const child = h.folders.create('Child', parent);
    h.folders.place(ids[0], child);
    h.selection.begin();
  });
  await h.run(() => h.selection.selectAll());
  await h.run(() => h.selection.deleteSelected());
  expect(mock.alert).toHaveBeenCalledOnce();
  expect(mock.alert.mock.calls[0][1]).toContain('3 documents and 2 folders');
  await h.run(() => answer(1));
  expect(h.remove).toHaveBeenCalledTimes(3);
  expect(h.selection.active).toBe(false);
  expect(h.folders.getSnapshot().tree.folders).toEqual([]);
  await h.close();
});

it('retains failed and unprocessed selections, not successful entries, and reports partial changes', async () => {
  const h = await mount();
  h.remove.mockImplementation(async (id) => { if (id === ids[1]) throw new Error('Disk full'); });
  await h.run(() => h.selection.begin());
  await h.run(() => h.selection.selectAll());
  await h.run(() => h.selection.deleteSelected());
  await h.run(() => answer(1));
  expect(h.remove.mock.calls.map(([id]) => id)).toEqual(ids.slice(0, 2));
  expect(h.selection.active).toBe(true);
  expect(h.selection.selected).toEqual(targets.slice(1));
  expect(h.report).toHaveBeenCalledWith(expect.stringContaining('Deletion stopped at “Document 2”'));
  expect(h.report).toHaveBeenCalledWith(expect.stringContaining('may already have lost'));
  expect(h.selection.working).toBe(false);
  await h.close();
});

it('refuses a confirmation after the folder contents change', async () => {
  const h = await mount();
  await h.run(() => h.selection.begin());
  await h.run(() => h.selection.selectAll());
  await h.run(() => h.selection.deleteSelected());
  await h.run(() => h.folders.create('Changed', null));
  await h.run(() => answer(1));
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.report).toHaveBeenCalledWith(expect.stringContaining('changed'));
  expect(h.selection.selected).toHaveLength(3);
  await h.close();
});

it('detects added documents in a selected folder even when its tree does not change', async () => {
  const h = await mount();
  const addedId = asDocumentId(`sha256:${'d'.repeat(64)}`)!;
  await h.run(() => { const folder = h.folders.create('Folder', null); h.folders.place(addedId, folder); h.selection.begin(); });
  await h.run(() => h.selection.toggle({ kind: 'folder', id: 'folder-1' }));
  await h.run(() => h.selection.deleteSelected());
  await h.run(() => { h.add(); h.refresh(); });
  await h.run(() => answer(1));
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.report).toHaveBeenCalledWith(expect.stringContaining('changed'));
  await h.close();
});

it('ignores stale confirmation after blur and blocks duplicate submission while running', async () => {
  const h = await mount();
  await h.run(() => h.selection.begin());
  await h.run(() => h.selection.selectAll());
  await h.run(() => h.selection.deleteSelected());
  await h.run(h.blur);
  await h.run(() => answer(1));
  expect(h.remove).not.toHaveBeenCalled();
  await h.run(() => h.selection.begin());
  await h.run(() => h.selection.selectAll());
  await h.run(() => h.selection.deleteSelected());
  let finish!: () => void;
  h.remove.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await h.run(() => { answer(1); answer(1); });
  expect(h.selection.working).toBe(true);
  await h.run(() => { h.selection.cancel(); h.selection.toggle(targets[0]); h.selection.selectAll(); h.selection.sweepTo(new Set()); });
  expect(h.selection.active).toBe(true);
  expect(h.selection.selected).toHaveLength(3);
  await h.run(h.blur);
  await h.run(() => finish());
  expect(h.remove).toHaveBeenCalledTimes(3);
  expect(h.selection.active).toBe(false);
  await h.close();
});
