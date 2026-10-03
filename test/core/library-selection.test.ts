import { describe, expect, it, vi } from 'vitest';
import { createFolderStore, emptyFolders, moveSelection, placeDocument, putFolder, selectionPlan, targetKey, type LibraryTarget } from '../../src/core/folders';

const folder = (id: string): LibraryTarget => ({ kind: 'folder', id });
const document = (id: string): LibraryTarget => ({ kind: 'document', id });
function fixture() {
  let tree = emptyFolders();
  for (const entry of [
    { id: 'a', name: 'Work', parent: null }, { id: 'b', name: 'Nested', parent: 'a' },
    { id: 'c', name: 'Destination', parent: null }, { id: 'd', name: 'Other', parent: null },
  ]) tree = putFolder(tree, entry);
  tree = placeDocument(tree, 'inside', 'b');
  const write = vi.fn();
  const store = createFolderStore({ read: () => JSON.stringify(tree), write, id: () => 'new' });
  return { tree, store, write, documents: ['inside', 'one', 'two'] };
}

describe('current-level Library selection (#128)', () => {
  it('namespaces folder/document identities and counts complete subtrees once', () => {
    const { tree, documents } = fixture();
    expect(targetKey(folder('one'))).not.toBe(targetKey(document('one')));
    const plan = selectionPlan(tree, [folder('a'), document('one')], documents);
    expect([...plan.folders]).toEqual(['a', 'b']);
    expect([...plan.documents]).toEqual(['inside', 'one']);
  });
  it('rejects missing documents, missing folders, duplicate and cross-level entries', () => {
    const { tree, documents } = fixture();
    for (const targets of [[], [document('gone')], [folder('gone')], [folder('b')], [folder('a'), folder('a')], [document('inside')]]) {
      expect(() => selectionPlan(tree, targets, documents)).toThrow();
    }
  });
  it('moves mixed entries in one durable write, preserving descendants and browsing location', () => {
    const { tree, documents, store, write } = fixture();
    store.moveEntries([document('one'), folder('a')], documents, 'c');
    expect(write).toHaveBeenCalledOnce();
    expect(store.getSnapshot().tree.documents).toEqual({ inside: 'b', one: 'c' });
    expect(store.getSnapshot().tree.folders.find((one) => one.id === 'a')?.parent).toBe('c');
    expect(store.getSnapshot().tree.current).toBe(tree.current);
  });
  it('preflights the entire batch before writing; names the conflicting folder', () => {
    const { tree, documents } = fixture();
    const conflict = putFolder(tree, { id: 'conflict', name: 'WORK', parent: 'c' });
    const write = vi.fn();
    const store = createFolderStore({ read: () => JSON.stringify(conflict), write, id: () => 'new' });
    expect(() => store.moveEntries([document('one'), folder('a')], documents, 'c')).toThrow('“Work”');
    expect(store.getSnapshot().tree.documents.one).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects the current parent, any selected folder, its descendants and missing destinations', () => {
    const { tree, documents } = fixture();
    for (const destination of [null, 'a', 'b', 'd', 'gone']) {
      expect(() => moveSelection(tree, [folder('a'), folder('d'), document('one')], documents, destination)).toThrow();
    }
  });
  it('leaves every entry in place if the move write fails', () => {
    const { store, write, documents } = fixture();
    const before = store.getSnapshot();
    write.mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect(() => store.moveEntries([folder('a'), document('one')], documents, 'c')).toThrow('Disk full');
    expect(store.getSnapshot()).toBe(before);
  });
  it('locks the entire deletion, stops at first failure, and reports only completed top-level entries', async () => {
    const { store, documents } = fixture();
    const complete = vi.fn();
    const remove = vi.fn(async (id: string) => {
      expect(store.getSnapshot().busy).toBe(true);
      expect(() => store.create('blocked', null)).toThrow('Wait');
      expect(() => store.moveEntries([folder('d')], documents, 'c')).toThrow('Wait');
      if (id === 'inside') throw new Error('Audio failure');
    });
    await expect(store.deleteEntries([document('one'), folder('a'), document('two')], documents, remove, complete)).rejects.toThrow('Audio failure');
    expect(remove.mock.calls.map(([id]) => id)).toEqual(['one', 'inside']);
    expect(complete.mock.calls).toEqual([[document('one')]]);
    expect(store.getSnapshot().tree.folders.some((one) => one.id === 'a')).toBe(true);
    expect(store.getSnapshot().busy).toBe(false);
  });
  it('keeps a failed empty folder reachable after document deletion but failed folder persistence', async () => {
    const { store, documents, write } = fixture();
    write.mockImplementationOnce(() => { throw new Error('Disk full'); });
    const complete = vi.fn();
    const remove = vi.fn(async () => {});
    await expect(store.deleteEntries([folder('a'), document('one')], documents, remove, complete)).rejects.toThrow('Disk full');
    expect(complete).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().busy).toBe(false);
    await store.deleteEntries([folder('a'), document('one')], ['one', 'two'], remove, complete);
    expect(store.getSnapshot().tree.folders.map((one) => one.id)).toEqual(['c', 'd']);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls).toEqual([[folder('a')], [document('one')]]);
  });
  it('preflights deletion before acquiring its lock or invoking removal', async () => {
    const { store, documents } = fixture();
    const remove = vi.fn(async () => {});
    await expect(store.deleteEntries([document('one'), folder('gone')], documents, remove, vi.fn())).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(store.getSnapshot().busy).toBe(false);
  });
});
