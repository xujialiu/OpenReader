import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { File } from 'expo-file-system';
import { asDocumentId, createLocator, readingPositionAt, type LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { useLibrary, type Library } from '../../src/app/use-library';
import { importDocument } from '../../src/app/import-document';

const disk = vi.hoisted(() => ({
  entries: [] as LibraryEntry[], folders: null as string | null, failLibrary: false, failFolders: false,
  alert: vi.fn(), identify: vi.fn(), writeLibrary: vi.fn(),
}));
vi.mock('expo-file-system', () => ({ File: class { name = 'new.epub'; } }));
vi.mock('react-native', () => ({ Alert: { alert: disk.alert } }));
vi.mock('../../src/app/document', () => ({ addDocument: disk.identify }));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), saveDisplayName: vi.fn() }));
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'test-phone',
  readLibrary: () => ({ entries: disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: LibraryEntry[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: LibraryEntry[]) => {
    if (disk.failLibrary) throw new Error('Library disk full');
    disk.writeLibrary(entries);
    disk.entries = entries;
  },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => {
  let n = 0;
  return createFolderStore({ read: () => disk.folders, write: (text) => {
    if (disk.failFolders) throw new Error('Folder disk full');
    disk.folders = text;
  }, id: () => `folder-${++n}` });
} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = asDocumentId(`sha256:${'a'.repeat(64)}`)!;
const entry: LibraryEntry = {
  id, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'The existing title',
  position: readingPositionAt(createLocator('epub', 'epubcfi(/6/8!/4/2/4)'), 'Saved sentence.', 0, 15, { at: 10, device: 'test' }),
  voice: null, stamp: { at: 20, device: 'test' },
};
async function mount() {
  let library: Library;
  let renderer: ReactTestRenderer;
  function Probe() { library = useLibrary(); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  return { get library() { return library!; }, unmount: () => act(async () => renderer!.unmount()) };
}
beforeEach(() => {
  disk.entries = []; disk.folders = null; disk.failLibrary = false; disk.failFolders = false;
  disk.alert.mockReset(); disk.identify.mockReset(); disk.writeLibrary.mockReset();
  disk.identify.mockResolvedValue({ identity: { id, format: 'epub', publicationId: null, publicationIdSource: 'none' }, title: 'Imported title' });
});

describe('Library folder integration (#121)', () => {
  it('imports into the visited folder, reopens there, and keeps existing metadata on duplicate import', async () => {
    const mounted = await mount();
    let folder = '';
    await act(async () => {
      folder = mounted.library.folders.create('Fiction', null);
      mounted.library.folders.visit(folder);
      await mounted.library.add(new File('new.epub'), { move: false });
    });
    expect(mounted.library.folderSnapshot.tree.documents[id]).toBe(folder);
    expect(disk.entries).toHaveLength(1);
    await mounted.unmount();
    const reopened = await mount();
    expect(reopened.library.folderSnapshot.tree.current).toBe(folder);
    const held = reopened.library.entries[0];
    await act(async () => {
      const result = await reopened.library.add(new File('again.epub'), { move: false, folder: null });
      expect(result).toEqual({ entry: held, duplicate: true });
    });
    expect(reopened.library.folderSnapshot.tree.documents[id]).toBe(folder);
    expect(disk.entries).toHaveLength(1);
    await reopened.unmount();
  });
  it('moving changes neither the Library entry nor the Positions File projection', async () => {
    disk.entries = [entry];
    const mounted = await mount();
    const positions = mounted.library.positionsItems();
    await act(async () => {
      const folder = mounted.library.folders.create('Work', null);
      mounted.library.folders.place(id, folder);
    });
    expect(mounted.library.entries[0]).toEqual(entry);
    expect(mounted.library.positionsItems()).toEqual(positions);
    expect(disk.writeLibrary).not.toHaveBeenCalled();
    await mounted.unmount();
  });
  it('shows duplicate title and complete existing path, and Cancel neither opens nor moves it', async () => {
    disk.entries = [entry];
    const mounted = await mount();
    await act(async () => {
      const a = mounted.library.folders.create('Fiction', null);
      const b = mounted.library.folders.create('Science fiction', a);
      mounted.library.folders.place(id, b);
    });
    disk.alert.mockImplementation((_title, _message, buttons) => buttons[0].onPress());
    const open = vi.fn();
    await act(async () => { await importDocument(mounted.library, new File('duplicate.epub'), { move: false, folder: null }, open); });
    expect(disk.alert.mock.calls[0][0]).toBe('Document already exists');
    expect(disk.alert.mock.calls[0][1]).toContain('The existing title');
    expect(disk.alert.mock.calls[0][1]).toContain('Library → Fiction → Science fiction');
    expect(open).not.toHaveBeenCalled();
    expect(mounted.library.entries[0]).toEqual(entry);
    expect(disk.writeLibrary).not.toHaveBeenCalled();
    await mounted.unmount();
  });
  it('opens a duplicate only after the explicit Open action; a new import opens immediately', async () => {
    const mounted = await mount();
    const open = vi.fn();
    await act(async () => { await importDocument(mounted.library, new File('new.epub'), { move: false }, open); });
    expect(open).toHaveBeenCalledOnce();
    expect(disk.alert).not.toHaveBeenCalled();
    disk.alert.mockImplementation((_title, _message, buttons) => buttons[1].onPress());
    await act(async () => { await importDocument(mounted.library, new File('again.epub'), { move: false }, open); });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(id);
    await mounted.unmount();
  });
  it('does not open or expose an imported entry when membership cannot be saved', async () => {
    const mounted = await mount();
    disk.failFolders = true;
    const open = vi.fn();
    await act(async () => {
      await expect(importDocument(mounted.library, new File('new.epub'), { move: false }, open)).rejects.toThrow('Folder disk full');
    });
    expect(open).not.toHaveBeenCalled();
    expect(mounted.library.entries).toEqual([]);
    expect(disk.entries).toEqual([]);
    await mounted.unmount();
  });
  it('does not hide a Document or delete the Folder when Library deletion fails to persist', async () => {
    disk.entries = [entry];
    const mounted = await mount();
    let folder = '';
    await act(async () => {
      folder = mounted.library.folders.create('Work', null);
      mounted.library.folders.place(id, folder);
    });
    disk.failLibrary = true;
    await act(async () => {
      await expect(mounted.library.folders.deleteTree(folder, [id], async () => mounted.library.remove(id))).rejects.toThrow('Library disk full');
    });
    expect(mounted.library.entries).toEqual([entry]);
    expect(mounted.library.folderSnapshot.tree.folders).toHaveLength(1);
    expect(mounted.library.folderSnapshot.busy).toBe(false);
    await mounted.unmount();
  });
  it('adds at root if the destination disappears while identifying the source', async () => {
    const mounted = await mount();
    let complete!: () => void;
    disk.identify.mockImplementationOnce(() => new Promise((resolve) => { complete = () => resolve({ identity: entry, title: entry.title }); }));
    await act(async () => {
      const folder = mounted.library.folders.create('Work', null);
      mounted.library.folders.visit(folder);
      const pending = mounted.library.add(new File('new.epub'), { move: false });
      await mounted.library.folders.deleteTree(folder, [], async () => {});
      complete();
      await pending;
    });
    expect(mounted.library.folderSnapshot.tree.current).toBeNull();
    expect(mounted.library.folderSnapshot.tree.documents[id]).toBeUndefined();
    expect(mounted.library.entries).toHaveLength(1);
    await mounted.unmount();
  });
});
