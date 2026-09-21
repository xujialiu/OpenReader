import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readBodyTextSize, writeBodyTextSize } from '../../src/app/body-text-sizes';
import { asDocumentId, type DocumentId } from '../../src/core/document';

const disk = vi.hoisted(() => ({ files: new Map<string, string>(), refuse: false }));
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  constructor(_directory: string, private name: string) {}
  get exists() { return disk.files.has(this.name); }
  get uri() { return 'file:///test/' + this.name; }
  textSync() { return disk.files.get(this.name); }
  write(value: string) {
    if (disk.refuse) throw new Error('No space left on device');
    disk.files.set(this.name, value);
  }
} }));
vi.mock('../../modules/open-reader-offline', () => ({ offlineNative: null }));

const id = (digit: string): DocumentId => asDocumentId('sha256:' + digit.repeat(64))!;

/**
 * Each Document's body text size, decided once and remembered (ADR 0030), so
 * the next open is laid out at the owner's size on its first paint.
 */
describe('body text sizes on this device', () => {
  beforeEach(() => {
    disk.files.clear();
    disk.refuse = false;
  });

  it('remembers each Document’s own, and knows nothing of one never measured', () => {
    writeBodyTextSize(id('a'), 12);
    writeBodyTextSize(id('b'), 16);
    expect(readBodyTextSize(id('a'))).toBe(12);
    expect(readBodyTextSize(id('b'))).toBe(16);
    expect(readBodyTextSize(id('c'))).toBeNull();
  });

  it('reads a damaged file as nothing measured, rather than keeping a book from opening', () => {
    // It is a cache: the worst a lost entry costs is one count on the next open,
    // and the worst a thrown parse would cost is the reader itself.
    disk.files.set('body-text-sizes.json', '{ not json');
    expect(readBodyTextSize(id('a'))).toBeNull();
    writeBodyTextSize(id('a'), 12);
    expect(readBodyTextSize(id('a'))).toBe(12);

    const sizes = { [id('a')]: 'large', [id('b')]: -1, [id('c')]: 14, [id('d')]: null };
    disk.files.set('body-text-sizes.json', JSON.stringify({ version: 1, sizes }));
    expect([id('a'), id('b'), id('c'), id('d')].map(readBodyTextSize)).toEqual([null, null, 14, null]);
    // A file of another version is not this one, whatever it holds.
    disk.files.set('body-text-sizes.json', JSON.stringify({ version: 2, sizes: { [id('c')]: 14 } }));
    expect(readBodyTextSize(id('c'))).toBeNull();
    disk.files.set('body-text-sizes.json', '[12]');
    expect(readBodyTextSize(id('a'))).toBeNull();
  });

  it('keeps nothing it cannot write, rather than failing the reading that measured it', () => {
    disk.refuse = true;
    expect(() => writeBodyTextSize(id('a'), 12)).not.toThrow();
    expect(readBodyTextSize(id('a'))).toBeNull();
  });
});
