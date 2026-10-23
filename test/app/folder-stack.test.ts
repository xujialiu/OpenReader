import { describe, expect, it } from 'vitest';
import type { FolderTree } from '../../src/core/folders';
import { folderPageNames, folderRoutes, reconcileFolderStack, routeFolder } from '../../src/app/folder-stack';

/** Language → English → Fiction, and Spare beside Language (#317). */
const tree = (current: string | null = null): FolderTree => ({
  version: 1,
  folders: [
    { id: 'lang', name: 'Language', parent: null },
    { id: 'en', name: 'English', parent: 'lang' },
    { id: 'fic', name: 'Fiction', parent: 'en' },
    { id: 'spare', name: 'Spare', parent: null },
  ],
  documents: {},
  current,
});
const library = { key: 'Library-1', name: 'Library' };
const folder = (id: string) => ({ key: `Folder-${id}`, name: 'Folder', params: { id } });
const reader = { key: 'Reader-1', name: 'Reader', params: { id: 'sha256:x' } };

describe('A Folder is a page of the stack (#317)', () => {
  it('lists the pages from the Library down to a Folder', () => {
    expect(folderRoutes(tree(), null)).toEqual([{ name: 'Library' }]);
    expect(folderRoutes(tree(), 'fic')).toEqual([
      { name: 'Library' },
      { name: 'Folder', params: { id: 'lang' } },
      { name: 'Folder', params: { id: 'en' } },
      { name: 'Folder', params: { id: 'fic' } },
    ]);
  });

  it('opens at the root for a Folder that no longer exists', () => {
    expect(folderRoutes(tree(), 'gone')).toEqual([{ name: 'Library' }]);
  });

  it('reads the Folder a Library page shows, and nothing for any other page', () => {
    expect(routeFolder(library)).toBeNull();
    expect(routeFolder(folder('en'))).toBe('en');
    expect(routeFolder(reader)).toBeUndefined();
  });

  it('leaves a stack that is already the path to its top Folder', () => {
    expect(reconcileFolderStack([library], tree())).toBeNull();
    expect(reconcileFolderStack([library, folder('lang'), folder('en')], tree())).toBeNull();
    expect(reconcileFolderStack([library, folder('lang'), folder('en'), reader], tree())).toBeNull();
    expect(reconcileFolderStack([library, reader], tree())).toBeNull();
  });

  it('returns to the root when the Folder on top is deleted, as the Library did before (design 0069)', () => {
    const without: FolderTree = { ...tree(), folders: tree().folders.filter((one) => one.id !== 'en' && one.id !== 'fic') };
    expect(reconcileFolderStack([library, folder('lang'), folder('en'), folder('fic')], without)).toEqual([library]);
  });

  it('keeps every page after the Library pages, a Reader opened inside the Folder included', () => {
    const without: FolderTree = { ...tree(), folders: tree().folders.filter((one) => one.id !== 'fic') };
    expect(reconcileFolderStack([library, folder('lang'), folder('en'), folder('fic'), reader], without)).toEqual([library, reader]);
  });

  it('rebuilds the path of a Folder moved while its page is open, keeping the pages that stay mounted', () => {
    const moved: FolderTree = { ...tree(), folders: tree().folders.map((one) => one.id === 'en' ? { ...one, parent: 'spare' } : one) };
    expect(reconcileFolderStack([library, folder('lang'), folder('en'), folder('fic')], moved)).toEqual([
      library,
      { name: 'Folder', params: { id: 'spare' } },
      folder('en'),
      folder('fic'),
    ]);
  });

  it('takes the deepest Folder page as the one being browsed', () => {
    const moved: FolderTree = { ...tree(), folders: tree().folders.map((one) => one.id === 'fic' ? { ...one, parent: 'spare' } : one) };
    expect(reconcileFolderStack([library, folder('lang'), folder('en'), folder('fic')], moved)).toEqual([
      library,
      { name: 'Folder', params: { id: 'spare' } },
      folder('fic'),
    ]);
  });

  it('names a Folder page and the page behind it from the tree, so a page put under it by a reset is named too', () => {
    expect(folderPageNames(tree(), 'en')).toEqual({ title: 'English', backTitle: 'Language' });
    expect(folderPageNames(tree(), 'lang')).toEqual({ title: 'Language', backTitle: 'Library' });
    expect(folderPageNames(tree(), 'gone')).toEqual({ title: '', backTitle: 'Library' });
  });
});
