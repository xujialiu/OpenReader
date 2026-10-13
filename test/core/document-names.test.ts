import { describe, expect, it, vi } from 'vitest';
import { createFolderStore, documentNameProblem, emptyFolders, freeDocumentName, moveSelection, placeDocument, putFolder, type LibraryTarget } from '../../src/core/folders';

/** Two Documents in one Folder are not called alike (#227), as two Folders are not. */

const TAKEN = 'A document with this name already exists here. Rename it first.';
const document = (id: string): LibraryTarget => ({ kind: 'document', id });
function fixture() {
  let tree = putFolder(putFolder(emptyFolders(), { id: 'fiction', name: 'Fiction', parent: null }), { id: 'essays', name: 'Essays', parent: null });
  tree = placeDocument(placeDocument(tree, 'emma', 'fiction'), 'persuasion', 'fiction');
  const entries = [{ id: 'emma', title: 'Emma' }, { id: 'persuasion', title: 'Persuasion' }, { id: 'loose', title: 'Emma' }];
  return { tree, entries, titles: Object.fromEntries(entries.map((one) => [one.id, one.title])) };
}

describe('documentNameProblem', () => {
  it('refuses a name a Document in the same Folder has, ignoring letter case, by NFC, trimmed', () => {
    const { tree, entries } = fixture();
    for (const name of ['Emma', 'emma', ' EMMA ']) expect(documentNameProblem(tree, entries, name, 'fiction')).toBe(TAKEN);
    const nfd = [{ id: 'celine', title: 'Ce\u0301line' }];
    expect(documentNameProblem(placeDocument(tree, 'celine', 'fiction'), nfd, 'C\u00e9line', 'fiction')).toBe(TAKEN);
  });
  it('accepts the Document\'s own name, a name in another Folder or at the root, and a Folder\'s name', () => {
    const { tree, entries } = fixture();
    expect(documentNameProblem(tree, entries, 'emma', 'fiction', 'emma')).toBeNull();
    expect(documentNameProblem(tree, entries, 'Emma', 'essays')).toBeNull();
    expect(documentNameProblem(tree, entries.slice(0, 2), 'Emma', null)).toBeNull();
    expect(documentNameProblem(tree, entries, 'Fiction', null)).toBeNull();
  });
  it('counts only Documents still in the Library, not a membership left behind', () => {
    const { tree } = fixture();
    expect(documentNameProblem(tree, [{ id: 'persuasion', title: 'Persuasion' }], 'Emma', 'fiction')).toBeNull();
  });
  it('refuses a blank name', () => {
    const { tree, entries } = fixture();
    expect(documentNameProblem(tree, entries, '  ', 'fiction')).toBe('Enter a name.');
  });
});

describe('freeDocumentName', () => {
  it('is the name itself when it is free, and otherwise the first free number after it', () => {
    const { tree, entries } = fixture();
    expect(freeDocumentName(tree, entries, ' Mansfield Park ', 'fiction')).toBe('Mansfield Park');
    expect(freeDocumentName(tree, entries, 'emma', 'fiction')).toBe('emma 2');
    const more = placeDocument(tree, 'emma2', 'fiction');
    expect(freeDocumentName(more, [...entries, { id: 'emma2', title: 'Emma 2' }], 'Emma', 'fiction')).toBe('Emma 3');
  });
});

describe('a Document moved into a Folder holding one of its name (#227)', () => {
  it('is refused before anything is written, naming the Document', () => {
    const { tree, titles } = fixture();
    const write = vi.fn();
    const store = createFolderStore({ read: () => JSON.stringify(tree), write, id: () => 'new' });
    expect(() => store.moveEntries([document('loose')], ['emma', 'persuasion', 'loose'], 'fiction', titles)).toThrow(`“Emma”: ${TAKEN}`);
    expect(write).not.toHaveBeenCalled();
  });
  it('two of one selection with one name refuse each other', () => {
    let { tree } = fixture();
    tree = putFolder(tree, { id: 'empty', name: 'Empty', parent: null });
    tree = placeDocument(placeDocument(tree, 'one', 'essays'), 'two', 'essays');
    tree = { ...tree, current: 'essays' };
    expect(() => moveSelection(tree, [document('one'), document('two')], ['one', 'two'], 'empty', { one: 'Notes', two: 'notes' })).toThrow(`“notes”: ${TAKEN}`);
  });
  it('moves when the name is free there, and a Document it is not told the name of moves unchecked', () => {
    const { tree, titles } = fixture();
    expect(moveSelection(tree, [document('loose')], ['loose'], 'essays', titles).documents.loose).toBe('essays');
    expect(moveSelection(tree, [document('loose')], ['loose'], 'fiction').documents.loose).toBe('fiction');
  });
});
