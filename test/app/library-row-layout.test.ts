import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directFolderCounts, emptyFolders, placeDocument, putFolder } from '../../src/core/folders';
import { folderSummary, LIBRARY_ROW, libraryRowHeight } from '../../src/app/library-row-layout';

describe('Library density B (#121)', () => {
  it('uses the approved compact row and cover sizes without changing typography', () => {
    expect(LIBRARY_ROW.height).toBe(84);
    expect(LIBRARY_ROW.cover).toEqual({ width: 40, height: 56 });
    expect(LIBRARY_ROW.illustrationWidth).toBe(56);
  });
  it('uses the same growing row at every system text size', () => {
    expect(libraryRowHeight(0.8)).toBe(84);
    expect(libraryRowHeight(1)).toBe(84);
    expect(libraryRowHeight(1.235)).toBe(104);
    expect(libraryRowHeight(3.12)).toBe(263);
  });
  it('routes both folder and document rows through the one height and text layout', () => {
    const source = readFileSync(new URL('../../src/app/controls.tsx', import.meta.url), 'utf8');
    const document = source.slice(source.indexOf('export function DocumentRow('), source.indexOf('export function FolderRow('));
    const folder = source.slice(source.indexOf('export function FolderRow('), source.indexOf('function LibraryRow('));
    expect(document).toContain('return <LibraryRow');
    expect(folder).toContain('return <LibraryRow');
    expect(source).toContain('height: libraryRowHeight(fontScale)');
    expect(source).toContain('const { fontScale } = useWindowDimensions()');
  });
});
describe('Folder second line', () => {
  it.each([
    [0, 0, 'Empty'], [1, 0, '1 document'], [0, 1, '1 folder'], [3, 2, '3 documents · 2 folders'], [1, 1, '1 document · 1 folder'],
  ])('formats %i documents and %i folders', (documents, folders, expected) => {
    expect(folderSummary(documents, folders)).toBe(expected);
  });
  it('counts direct children, not deeper descendants, root documents or stale membership', () => {
    let tree = putFolder(emptyFolders(), { id: 'a', name: 'Parent', parent: null });
    tree = putFolder(tree, { id: 'b', name: 'Child', parent: 'a' });
    tree = putFolder(tree, { id: 'c', name: 'Grandchild', parent: 'b' });
    tree = placeDocument(tree, 'one', 'a');
    tree = placeDocument(tree, 'two', 'b');
    tree = placeDocument(tree, 'removed', 'a');
    const counts = directFolderCounts(tree, ['one', 'two', 'root']);
    expect(counts.get('a')).toEqual({ documents: 1, folders: 1 });
    expect(counts.get('b')).toEqual({ documents: 1, folders: 1 });
    expect(counts.get('c')).toEqual({ documents: 0, folders: 0 });
  });
});
