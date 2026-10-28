import { describe, expect, it } from 'vitest';
import { asDocumentId, type LibraryEntry } from '../../src/core/document';
import type { FolderTree } from '../../src/core/folders';
import { libraryQuery, libraryRows } from '../../src/app/library-search';

const entry = (digit: string, title: string): LibraryEntry => ({
  id: asDocumentId(`sha256:${digit.repeat(64)}`)!, title, format: 'epub', publicationId: null,
  publicationIdSource: 'none', position: null, stamp: { at: Number(digit), device: 'phone' },
});
const entries = [entry('3', 'Three Body Problem'), entry('2', '三体全集纪念版'), entry('1', 'Three Body Problem')];
const tree: FolderTree = {
  version: 1, current: 'inner', folders: [
    { id: 'outer', name: 'Three Body', parent: null },
    { id: 'inner', name: '中文', parent: 'outer' },
  ], documents: { [entries[1].id]: 'inner', [entries[2].id]: 'outer' },
};
const names = (query: string, folder: string | null = 'inner') => libraryRows(tree, entries, folder, query)
  .map((row) => row.kind === 'document' ? row.entry.title : `Folder: ${row.folder.name}`);

describe('Library Search (#332)', () => {
  it('searches every level, independent of the Folder being browsed, without returning Folder names', () => {
    expect(names('BODY')).toEqual(['Three Body Problem', 'Three Body Problem']);
    expect(names('BODY', null)).toEqual(names('BODY'));
    expect(names('中文')).toEqual([]);
  });
  it('preserves the existing entry order and identity, including namesakes in different Folders', () => {
    expect(libraryRows(tree, entries, null, 'Three')).toEqual([
      { kind: 'document', entry: entries[0] }, { kind: 'document', entry: entries[2] },
    ]);
    expect(entries.map((one) => one.stamp.at)).toEqual([3, 2, 1]);
  });
  it('empty and whitespace-only queries show the original Folder, not the entire Library', () => {
    expect(names('')).toEqual(['三体全集纪念版']);
    expect(names(' \n ')).toEqual(names(''));
    expect(names('', null)).toEqual(['Folder: Three Body', 'Three Body Problem']);
  });
  it('matches one continuous fragment, with no multi-word, pinyin, simplified/traditional or spelling expansion', () => {
    expect(names('三体')).toEqual(['三体全集纪念版']);
    for (const query of ['三体 纪念', 'santi', '三體', 'Thre Body']) expect(names(query)).toEqual([]);
  });
  it('ignores surrounding input whitespace and case; canonical Unicode forms remain the same name', () => {
    expect(names(' bOdY ')).toHaveLength(2);
    expect(libraryQuery('  CAFE\u0301  ')).toBe('café');
  });
  it('treats punctuation as literal text, not a pattern', () => {
    expect(names('.*')).toEqual([]);
    expect(libraryRows(tree, [entry('4', '[draft].epub')], null, '[draft]')).toHaveLength(1);
  });
  it('reflects rename and removal immediately without an index or stale result cache', () => {
    const renamed = { ...entries[0], title: 'Changed' };
    expect(libraryRows(tree, [renamed, entries[1]], 'inner', 'body')).toEqual([]);
    expect(libraryRows(tree, [renamed, entries[1]], 'inner', 'changed')).toEqual([{ kind: 'document', entry: renamed }]);
  });
  it('does not promote an older exact match above a newer partial one', () => {
    const all = [entry('4', 'Emma annotated'), entry('1', 'Emma')];
    expect(libraryRows(tree, all, null, 'Emma').map((row) => row.kind === 'document' && row.entry.id))
      .toEqual(all.map((one) => one.id));
  });
});
