import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { File } from 'expo-file-system';

import { DOCUMENT_ID_RULE, asDocumentId, createLocator, readingPositionAt, serializeLibrary, type LibraryEntry } from '../../src/core/document';
import { createFolderStore } from '../../src/core/folders';
import { documentFile, keepDocument } from '../../src/app/library';
import { openDocument } from '../../src/app/document';
import { useLibrary, type Library } from '../../src/app/use-library';

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(), directories: new Set<string>(),
  failure: null as 'copy' | 'replace' | null, nativeAvailable: true, identify: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) {
      const path = typeof base === 'string' ? base : base.uri;
      this.uri = name === undefined ? path : `${path}/${name}`;
    }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return disk.files.has(this.uri); }
    textSync() { return disk.files.get(this.uri); }
    async base64() { return disk.files.get(this.uri); }
    write(text: string) { disk.files.set(this.uri, text); }
    delete() { disk.files.delete(this.uri); }
    copySync(to: File, options?: { overwrite?: boolean }) {
      if (options?.overwrite) disk.files.delete(to.uri);
      else if (to.exists) throw new Error('Destination exists');
      const text = disk.files.get(this.uri);
      if (text === undefined) throw new Error('Source is missing');
      if (disk.failure === 'copy') {
        disk.files.set(to.uri, 'PARTIAL');
        throw new Error('Source disconnected');
      }
      disk.files.set(to.uri, text);
    }
    moveSync(to: File, options?: { overwrite?: boolean }) {
      this.copySync(to, options); this.delete(); this.uri = to.uri;
    }
  }
  class Directory {
    uri: string;
    constructor(base: string | { uri: string }, name: string) {
      this.uri = `${typeof base === 'string' ? base : base.uri}/${name}`;
    }
    create(options?: { idempotent?: boolean }) {
      if (disk.directories.has(this.uri) && !options?.idempotent) throw new Error('Directory exists');
      disk.directories.add(this.uri);
    }
    delete() {
      for (const uri of disk.files.keys()) if (uri.startsWith(`${this.uri}/`)) disk.files.delete(uri);
      disk.directories.delete(this.uri);
    }
  }
  return { File, Directory, Paths: { document: 'file:///documents' }, FileMode: { ReadOnly: 'r' } };
});
vi.mock('../../modules/open-reader-offline', () => ({
  get offlineNative() {
    return disk.nativeAvailable ? {
      writeJson: (uri: string, text: string) => { disk.files.set(uri, text); },
      replaceFile: (source: string, destination: string) => {
        if (disk.failure === 'replace') throw new Error('Replacement refused');
        const bytes = disk.files.get(source);
        if (bytes === undefined) throw new Error('Source is missing');
        disk.files.set(destination, bytes);
        disk.files.delete(source);
      },
    } : null;
  },
}));
vi.mock('../../src/app/document', async () => ({
  ...(await vi.importActual<typeof import('../../src/app/document')>('../../src/app/document')),
  identifyFile: disk.identify,
}));
vi.mock('../../src/app/display-names', () => ({ displayNames: () => ({}), forgetDisplayName() {}, saveDisplayName() {} }));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () => createFolderStore({
  read: () => null, write: () => {}, id: () => 'folder',
}) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const id = asDocumentId(`sha256:${'a'.repeat(64)}`)!;
const sentence = 'Keep this Reading Position.';
const entry: LibraryEntry = {
  id, format: 'epub', publicationId: null, publicationIdSource: 'none', title: 'Kept Document',
  position: readingPositionAt(createLocator('epub', 'epubcfi(/6/2!/4/4)'), sentence, 0, sentence.length, { at: 2, device: 'phone' }),
  stamp: { at: 1, device: 'phone' },
};
const source = 'file:///source.epub';
const trees: ReactTestRenderer[] = [];
async function mount() {
  let library!: Library;
  function Probe() { library = useLibrary(); return null; }
  await act(async () => { trees.push(create(createElement(Probe))); });
  return { get library() { return library; } };
}
function expectNoStaging() {
  expect([...disk.files.keys()].filter((uri) => uri.includes('/.import-'))).toEqual([]);
  expect([...disk.directories].filter((uri) => uri.includes('/.import-'))).toEqual([]);
}
beforeEach(() => {
  disk.files.clear(); disk.directories.clear(); disk.failure = null; disk.nativeAvailable = true;
  disk.files.set('file:///documents/this-device', 'iPhone-test0001');
  disk.files.set('file:///documents/library-id-rule', DOCUMENT_ID_RULE);
  disk.files.set('file:///documents/library.json', serializeLibrary([entry]));
  disk.files.set(documentFile(id, 'epub').uri, 'OLD EPUB');
  disk.files.set(source, 'NEW EPUB');
  disk.identify.mockReset(); disk.identify.mockResolvedValue({ identity: entry, title: 'Re-added' });
});
afterEach(async () => { await act(async () => { for (const tree of trees.splice(0)) tree.unmount(); }); });

describe.each([false, true])('keepDocument with move=%s (#261)', (move) => {
  it.each(['copy', 'replace'] as const)('preserves the old file and source after %s failure', (failure) => {
    disk.failure = failure;
    expect(() => keepDocument(id, 'epub', new File(source), { move })).toThrow();
    expect(disk.files.get(documentFile(id, 'epub').uri)).toBe('OLD EPUB');
    expect(disk.files.get(source)).toBe('NEW EPUB');
    expectNoStaging();
  });

  it('replaces a kept file successfully, removing only a move source', () => {
    keepDocument(id, 'epub', new File(source), { move });
    expect(disk.files.get(documentFile(id, 'epub').uri)).toBe('NEW EPUB');
    expect(disk.files.has(source)).toBe(!move);
    expectNoStaging();
  });

  it('restores a missing kept file', () => {
    disk.files.delete(documentFile(id, 'epub').uri);
    keepDocument(id, 'epub', new File(source), { move });
    expect(disk.files.get(documentFile(id, 'epub').uri)).toBe('NEW EPUB');
    expectNoStaging();
  });

  it('does not delete the kept file when it is also the source', () => {
    keepDocument(id, 'epub', documentFile(id, 'epub'), { move });
    expect(disk.files.get(documentFile(id, 'epub').uri)).toBe('OLD EPUB');
    expectNoStaging();
  });

  it('refuses before any copying when the native replacement is unavailable', () => {
    disk.nativeAvailable = false;
    expect(() => keepDocument(id, 'epub', new File(source), { move })).toThrow();
    expect(disk.files.get(documentFile(id, 'epub').uri)).toBe('OLD EPUB');
    expect(disk.files.get(source)).toBe('NEW EPUB');
    expectNoStaging();
  });
});

describe('real duplicate-import path (#261)', () => {
  it.each(['copy', 'replace'] as const)('a failed %s keeps the entry, position, voice and a file that still opens', async (failure) => {
    const app = await mount();
    disk.failure = failure;
    await act(async () => {
      await expect(app.library.add(new File(source), { move: false })).rejects.toThrow();
    });
    expect(app.library.current(id)).toEqual(entry);
    expect(disk.files.get('file:///documents/library.json')).toBe(serializeLibrary([entry]));
    expect((await openDocument(entry, entry.title)).base64).toBe('OLD EPUB');
    expectNoStaging();
  });
});
