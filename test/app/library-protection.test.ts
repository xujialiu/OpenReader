import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { File } from 'expo-file-system';

import { DOCUMENT_ID_RULE, asDocumentId, serializeLibrary, type LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { migrateDocumentIds, readLibrary, writeLibrary } from '../../src/app/library';
import { useLibrary, type Library } from '../../src/app/use-library';

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(), readFailure: false,
  identify: vi.fn(), keep: vi.fn(), forgetName: vi.fn(), saveName: vi.fn(), folderWrite: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' }, FileMode: { ReadOnly: 'r' }, Directory: class {},
  File: class {
    readonly uri: string;
    constructor(base: string, name?: string) { this.uri = name === undefined ? base : `${base}/${name}`; }
    get exists() { return disk.files.has(this.uri); }
    textSync() {
      if (disk.readFailure && this.uri.endsWith('/library.json')) throw new Error('Read refused');
      return disk.files.get(this.uri);
    }
    write(text: string) { disk.files.set(this.uri, text); }
  },
}));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: {
  writeJson: (uri: string, text: string) => { disk.files.set(uri, text); },
} }));
vi.mock('../../src/app/document', () => ({ identifyFile: disk.identify, keepFile: disk.keep }));
vi.mock('../../src/app/display-names', () => ({
  displayNames: () => ({ [`sha256:${'a'.repeat(64)}`]: 'Earlier name' }),
  forgetDisplayName: disk.forgetName, saveDisplayName: disk.saveName,
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => createFolderStore({
  read: () => null, write: disk.folderWrite, id: () => 'folder',
}) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const uri = 'file:///documents/library.json';
const rule = 'file:///documents/library-id-rule';
const entry: LibraryEntry = {
  id: asDocumentId(`sha256:${'a'.repeat(64)}`)!, format: 'epub', publicationId: null, publicationIdSource: 'none',
  title: 'New Document', position: null, stamp: { at: 1, device: 'phone' },
};
const cases = [
  ['truncated', '{"version":2,"entries":['],
  ['not a Library', '{"version":2,"documents":[]}'],
  ['newer layout', '{"version":3,"documents":[]}'],
  ['newer with entries', '{"version":3,"entries":[]}'],
  ['read refused', serializeLibrary([entry])],
] as const;
const trees: ReactTestRenderer[] = [];
async function mount() {
  let library!: Library;
  function Probe() { library = useLibrary(); return null; }
  await act(async () => { trees.push(create(createElement(Probe))); });
  return { get library() { return library; } };
}
beforeEach(() => {
  disk.files.clear(); disk.readFailure = false;
  disk.files.set('file:///documents/this-device', 'iPhone-test0001');
  disk.files.set(rule, DOCUMENT_ID_RULE);
  disk.identify.mockReset(); disk.keep.mockReset(); disk.forgetName.mockReset(); disk.saveName.mockReset(); disk.folderWrite.mockReset();
  disk.identify.mockResolvedValue({ identity: entry, title: entry.title });
});
afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); });

describe('an unreadable Library is kept, not reinitialized (#233)', () => {
  it.each(cases)('%s: refuses every write without changing the original bytes', (kind, original) => {
    disk.files.set(uri, original); disk.readFailure = kind === 'read refused';
    const loaded = readLibrary();
    expect(loaded.frozen).toBe(true);
    expect(loaded.note).toBeTruthy();
    for (let n = 0; n < 2; n++) {
      expect(() => writeLibrary([{ ...entry, title: `Import ${n}` }], loaded)).toThrow();
      expect(disk.files.get(uri)).toBe(original);
    }
    if (kind === 'read refused') expect(loaded.note).toContain('Read refused');
  });

  it.each(cases)('%s: import refuses before touching files, names or Folder membership', async (kind, original) => {
    disk.files.set(uri, original); disk.readFailure = kind === 'read refused';
    const app = await mount();
    await act(async () => {
      await expect(app.library.add(new File('file:///source.epub'), { move: false })).rejects.toThrow();
    });
    expect(app.library.entries).toEqual([]);
    expect(disk.keep).not.toHaveBeenCalled();
    expect(disk.forgetName).not.toHaveBeenCalled();
    expect(disk.folderWrite).not.toHaveBeenCalled();
    expect(disk.files.get(uri)).toBe(original);
  });

  it('does not record an id migration as complete over an unreadable Library', () => {
    disk.files.delete(rule);
    disk.files.set(uri, cases[0][1]);
    migrateDocumentIds(readLibrary());
    expect(disk.files.has(rule)).toBe(false);
  });

  it('still initializes and imports when there was no Library file', async () => {
    const app = await mount();
    await act(async () => { await app.library.add(new File('file:///source.epub'), { move: false }); });
    expect(readLibrary().entries[0].id).toBe(entry.id);
    expect(disk.keep).toHaveBeenCalledTimes(1);
    expect(disk.forgetName).toHaveBeenCalledTimes(1);
    expect(disk.folderWrite).toHaveBeenCalled();
  });

  it('an unknown-key Library cannot be renamed in a side file or changed in memory', async () => {
    const original = serializeLibrary([entry]).replace('"version": 2,', '"version": 2, "future": true,');
    disk.files.set(uri, original);
    const app = await mount();
    const before = app.library.current(entry.id);
    expect(() => app.library.rename(entry.id, 'Changed')).toThrow();
    expect(disk.saveName).not.toHaveBeenCalled();
    await act(async () => { app.library.heard(entry.id); });
    expect(app.library.current(entry.id)).toEqual(before);
    expect(disk.files.get(uri)).toBe(original);
  });
});
