import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { openFolderStore } from '../../src/app/folder-storage';
import { type ReaderFileSystem, useReaderFileSystem } from '../../src/app/reader-file-system';

// SDK 58's asynchronous write deliberately never finishes. Calling it without
// awaiting must not accidentally look synchronous in a storage adapter test.
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), fail: false,
  asyncWrite: vi.fn(() => new Promise<void>(() => {})), operations: [] as string[] }));
vi.mock('expo-file-system', () => {
  const uriOf = (parts: (string | { uri: string })[]) => parts.map((part) => typeof part === 'string' ? part : part.uri).join('/');
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = uriOf(parts); }
    get exists() { return disk.files.has(this.uri); }
    textSync() { return disk.files.get(this.uri)!; }
    write = disk.asyncWrite;
    writeSync(text: string) {
      if (disk.fail) throw new Error('Storage full');
      disk.operations.push(`write:${this.uri}`);
      disk.files.set(this.uri, text);
    }
    moveSync(target: File) {
      if (!this.exists) throw new Error('Write has not finished');
      disk.operations.push(`move:${this.uri}`);
      disk.files.set(target.uri, this.textSync());
      disk.files.delete(this.uri);
      this.uri = target.uri;
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) { this.uri = uriOf(parts); }
    create() {}
  }
  return { File, Directory, Paths: { document: 'documents', cache: { uri: 'cache' }, bundle: { uri: 'bundle' } } };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { disk.files.clear(); disk.operations.length = 0; disk.fail = false; disk.asyncWrite.mockClear(); });

it('writes a Folder completely before moving its pending file and publishing the change', () => {
  const store = openFolderStore();
  store.create('Before upgrade', null);
  expect(disk.operations).toEqual(['write:documents/library-folders.pending.json', 'move:documents/library-folders.pending.json']);
  expect(JSON.parse(disk.files.get('documents/library-folders.json')!).folders[0].name).toBe('Before upgrade');
  expect(disk.asyncWrite).not.toHaveBeenCalled();
});

it('keeps the previous Folder file when the synchronous write fails', () => {
  const store = openFolderStore();
  store.create('Kept', null);
  const before = disk.files.get('documents/library-folders.json');
  disk.fail = true;
  expect(() => store.create('Not saved', null)).toThrow('Storage full');
  expect(disk.files.get('documents/library-folders.json')).toBe(before);
  expect(disk.asyncWrite).not.toHaveBeenCalled();
});

async function reader() {
  let fs!: ReaderFileSystem;
  let view!: ReactTestRenderer;
  function Probe() { fs = useReaderFileSystem(); return null; }
  await act(async () => { view = create(createElement(Probe)); });
  return { fs, close: () => act(async () => view.unmount()) };
}

it('resolves the renderer write only after its HTML is readable', async () => {
  const { fs, close } = await reader();
  try {
    await fs.writeAsStringAsync('cache/epubjs/index.html', '<p>Readable</p>');
    expect(disk.files.get('cache/epubjs/index.html')).toBe('<p>Readable</p>');
    expect(disk.asyncWrite).not.toHaveBeenCalled();
  } finally { await close(); }
});

it('rejects the renderer write on the same storage failure rather than reporting success', async () => {
  const { fs, close } = await reader();
  try {
    disk.fail = true;
    await expect(fs.writeAsStringAsync('cache/epubjs/index.html', 'incomplete')).rejects.toThrow('Storage full');
    expect(disk.files.has('cache/epubjs/index.html')).toBe(false);
    expect(disk.asyncWrite).not.toHaveBeenCalled();
  } finally { await close(); }
});
