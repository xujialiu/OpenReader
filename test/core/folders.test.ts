import { describe, expect, it, vi } from 'vitest';
import { childFolders, createFolderStore, emptyFolders, folderPath, folderSubtree, parseFolders, placeDocument, putFolder, withoutFolder } from '../../src/core/folders';

function storage(initial: string | null = null) {
  let saved = initial;
  let serial = 0;
  const write = vi.fn((text: string) => { saved = text; });
  const io = { read: () => saved, write, id: () => `f${++serial}` };
  return { store: createFolderStore(io), io, write };
}
function fixture() {
  let tree = emptyFolders();
  tree = putFolder(tree, { id: 'a', name: 'Languages', parent: null });
  tree = putFolder(tree, { id: 'b', name: 'English', parent: 'a' });
  tree = putFolder(tree, { id: 'c', name: 'Fiction', parent: 'b' });
  return tree;
}
describe('exclusive nested Folders (#121)', () => {
  it('starts existing documents at root without modifying their data', () => {
    expect(storage().store.getSnapshot().tree).toEqual(emptyFolders());
  });
  it('trims names, rejects blank/case-equivalent/Unicode-equivalent siblings, but allows names elsewhere', () => {
    const { store } = storage();
    const a = store.create('  English  ', null);
    expect(store.getSnapshot().tree.folders[0].name).toBe('English');
    expect(() => store.create('ENGLISH', null)).toThrow('already exists');
    expect(() => store.create('   ', null)).toThrow('Enter a folder name');
    expect(() => store.create('English', a)).not.toThrow();
    store.create('café', null);
    expect(() => store.create('cafe\u0301', null)).toThrow('already exists');
  });
  it('allows case-only renaming of the same folder and rejects collisions', () => {
    const { store } = storage();
    const a = store.create('One', null);
    const b = store.create('Two', null);
    store.rename(a, 'ONE');
    expect(() => store.rename(b, 'one')).toThrow('already exists');
    expect(store.getSnapshot().tree.folders.map((folder) => folder.name)).toEqual(['ONE', 'Two']);
  });
  it('refuses moves into self or descendants, and into a missing parent', () => {
    const tree = fixture();
    for (const parent of ['a', 'b', 'c']) expect(() => putFolder(tree, { id: 'a', name: 'Languages', parent })).toThrow('cannot be moved');
    expect(() => putFolder(tree, { id: 'a', name: 'Languages', parent: 'missing' })).toThrow('no longer exists');
  });
  it('moves a subtree by identity, keeping names, membership and the remembered child', () => {
    const tree = { ...placeDocument(fixture(), 'book', 'c'), current: 'c' };
    const moved = putFolder(tree, { id: 'b', name: 'English', parent: null });
    expect(folderPath(moved, 'c')).toBe('Library → English → Fiction');
    expect(moved.current).toBe('c');
    expect(moved.documents.book).toBe('c');
  });
  it('lists immediate child folders by name and computes the full subtree without siblings', () => {
    const tree = putFolder(fixture(), { id: 'd', name: 'Art', parent: null });
    expect(childFolders(tree, null).map((folder) => folder.name)).toEqual(['Art', 'Languages']);
    expect([...folderSubtree(tree, 'a')]).toEqual(['a', 'b', 'c']);
    expect(folderPath(tree, null)).toBe('Library');
  });
  it('moves a document to one destination or root, never into several folders', () => {
    const tree = placeDocument(placeDocument(fixture(), 'book', 'a'), 'book', 'c');
    expect(tree.documents).toEqual({ book: 'c' });
    expect(placeDocument(tree, 'book', null).documents).toEqual({});
  });
  it('rejects same-named folder moves without merging or overwriting', () => {
    const { store } = storage(JSON.stringify(fixture()));
    store.create('English', null);
    const before = store.getSnapshot();
    expect(() => store.moveFolder('b', null)).toThrow('Rename it first');
    expect(store.getSnapshot()).toBe(before);
  });
  it('removes descendants, leaves siblings alone and goes directly to root if the remembered folder was deleted', () => {
    const tree = { ...placeDocument(fixture(), 'book', 'c'), current: 'c' };
    const result = withoutFolder(tree, 'b');
    expect(result.folders.map((folder) => folder.id)).toEqual(['a']);
    expect(result.documents).toEqual({});
    expect(result.current).toBeNull();
  });
});

describe('durable local organization', () => {
  it('restores nested folders, membership and last visited folder across a new store', () => {
    const { store, io } = storage();
    const id = store.create('Work', null);
    store.place('book', id);
    store.visit(id);
    expect(createFolderStore(io).getSnapshot()).toEqual(store.getSnapshot());
  });
  it('publishes only after writing and keeps the old snapshot on a failed save', () => {
    const { store, write } = storage();
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);
    write.mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect(() => store.create('Work', null)).toThrow('Disk full');
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    store.create('Work', null);
    expect(listener).toHaveBeenCalledOnce();
  });
  it('falls back to root for a stale browsing location, without discarding other structure', () => {
    const tree = parseFolders(JSON.stringify({ ...fixture(), current: 'missing' }));
    expect(tree.current).toBeNull();
    expect(tree.folders).toEqual(fixture().folders);
  });
  it.each([
    'not json',
    JSON.stringify({ ...emptyFolders(), version: 2 }),
    JSON.stringify({ ...emptyFolders(), extra: true }),
    JSON.stringify({ ...fixture(), documents: { book: 'missing' } }),
    JSON.stringify({ ...fixture(), folders: [{ id: 'a', name: 'A', parent: 'a' }] }),
    JSON.stringify({ ...fixture(), folders: [{ id: 'a', name: 'A', parent: 'b' }, { id: 'b', name: 'B', parent: 'a' }] }),
    JSON.stringify({ ...fixture(), folders: [{ id: 'a', name: 'A', parent: 'missing' }] }),
  ])('refuses invalid or unknown data and blocks all writes: %s', (text) => {
    const { store, write } = storage(text);
    expect(store.getSnapshot().problem).toBeTruthy();
    expect(() => store.create('New', null)).toThrow();
    expect(() => store.visit(null)).toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it('locks mutations during deletion and keeps remaining contents reachable on a partial failure', async () => {
    const tree = placeDocument(placeDocument(fixture(), 'one', 'b'), 'two', 'c');
    const { store, io } = storage(JSON.stringify(tree));
    const removed: string[] = [];
    await expect(store.deleteTree('b', ['one', 'two', 'unrelated'], async (id) => {
      expect(store.getSnapshot().busy).toBe(true);
      expect(() => store.place('another', 'b')).toThrow('Wait');
      expect(() => store.rename('b', 'Other')).toThrow('Wait');
      if (id === 'two') throw new Error('Audio could not be deleted');
      removed.push(id);
    })).rejects.toThrow('Audio could not be deleted');
    expect(removed).toEqual(['one']);
    expect(store.getSnapshot().busy).toBe(false);
    expect(createFolderStore(io).getSnapshot().tree).toEqual(tree);
    // Retry with only the entries still in the Library. Deleted entries need not be replayed.
    await store.deleteTree('b', ['two', 'unrelated'], async (id) => { removed.push(id); });
    expect(removed).toEqual(['one', 'two']);
    expect(store.getSnapshot().tree.folders.map((folder) => folder.id)).toEqual(['a']);
  });
  it('keeps the empty folder reachable when the final folder write fails after document deletion', async () => {
    const { store, write } = storage(JSON.stringify(placeDocument(fixture(), 'one', 'b')));
    write.mockImplementationOnce(() => { throw new Error('Disk full'); });
    const remove = vi.fn(async () => {});
    await expect(store.deleteTree('b', ['one'], remove)).rejects.toThrow('Disk full');
    expect(remove).toHaveBeenCalledWith('one');
    expect(store.getSnapshot().tree.folders).toHaveLength(3);
    expect(store.getSnapshot().busy).toBe(false);
  });
});
