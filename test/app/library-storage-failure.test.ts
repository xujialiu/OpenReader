import { beforeEach, describe, expect, it, vi } from 'vitest';

import { asDocumentId, createLocator, readingPositionAt, type LibraryEntry } from '../../src/core/document';
import { readLibrary, writeLibrary } from '../../src/app/library';

/** Real Library serialization and reload; only the native filesystem is doubled. */
const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  failure: null as 'empty' | 'partial' | null,
  nativeAvailable: true,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' }, FileMode: { ReadOnly: 'r' }, Directory: class {},
  File: class {
    readonly uri: string;
    constructor(directory: string, name: string) { this.uri = `${directory}/${name}`; }
    get exists() { return disk.files.has(this.uri); }
    textSync() { return disk.files.get(this.uri); }
    write(text: string) {
      if (disk.failure) {
        disk.files.set(this.uri, disk.failure === 'empty' ? '' : text.slice(0, 30));
        throw new Error('No space left on device');
      }
      disk.files.set(this.uri, text);
    }
  },
}));
vi.mock('../../modules/open-reader-offline', () => ({
  get offlineNative() {
    return disk.nativeAvailable ? {
      writeJson(uri: string, text: string) {
        if (disk.failure) throw new Error('No space left on device');
        disk.files.set(uri, text);
      },
    } : null;
  },
}));

const uri = 'file:///documents/library.json';
const sentence = 'The sentence that was saved.';
const saved: LibraryEntry = {
  id: asDocumentId(`sha256:${'a'.repeat(64)}`)!, format: 'epub', publicationId: null, publicationIdSource: 'none',
  title: 'Kept Document', stamp: { at: 1, device: 'phone' },
  position: readingPositionAt(createLocator('epub', 'epubcfi(/6/2!/4/4)'), sentence, 0, sentence.length, { at: 2, device: 'phone' }),
};
const changed = { ...saved, title: 'Changed Document' };

beforeEach(() => { disk.files.clear(); disk.failure = null; disk.nativeAvailable = true; });

describe('Library survives a failed save (#260)', () => {
  it.each(['empty', 'partial'] as const)('reloads all saved fields after a %s write failure', (failure) => {
    writeLibrary([saved], readLibrary());
    const before = disk.files.get(uri);
    const loaded = readLibrary();
    disk.failure = failure;
    expect(() => writeLibrary([changed], loaded)).toThrow('No space left on device');
    expect(disk.files.get(uri)).toBe(before);
    expect(readLibrary().entries).toEqual([saved]);
  });

  it('can save again when storage recovers', () => {
    writeLibrary([saved], readLibrary());
    const loaded = readLibrary();
    disk.failure = 'empty';
    expect(() => writeLibrary([changed], loaded)).toThrow();
    disk.failure = null;
    writeLibrary([changed], loaded);
    expect(readLibrary().entries).toEqual([changed]);
  });

  it('leaves a failed first save absent, allowing a later first save', () => {
    const loaded = readLibrary();
    disk.failure = 'partial';
    expect(() => writeLibrary([saved], loaded)).toThrow();
    expect(disk.files.has(uri)).toBe(false);
    expect(readLibrary().note).toBeNull();
    disk.failure = null;
    writeLibrary([saved], readLibrary());
    expect(readLibrary().entries).toEqual([saved]);
  });

  it('never falls back to an in-place write when the atomic writer is unavailable', () => {
    writeLibrary([saved], readLibrary());
    disk.nativeAvailable = false;
    expect(() => writeLibrary([changed], readLibrary())).toThrow();
    expect(readLibrary().entries).toEqual([saved]);
  });
});
