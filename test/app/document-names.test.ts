import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentId, LibraryEntry } from '../../src/core/document';
import { createFolderStore, type FolderId } from '../../src/core/folders';
import { useLibrary, type Library } from '../../src/app/use-library';
import { importDocument } from '../../src/app/import-document';

/**
 * What a Document is called, over the real Library, import and Folder store:
 * the name of the file it was added from until the owner renames it (#226).
 *
 * Doubled: the file reading (`addDocument` gives the Document Id from the
 * file's bytes and the title from its name without the extension, as
 * `src/app/document.ts` does), the display names, the Library and Folder files,
 * and the phone's alert.
 */

const disk = vi.hoisted(() => ({ entries: [] as LibraryEntry[], folders: null as string | null, names: {} as Record<string, string>, alert: vi.fn() }));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('react-native', () => ({ Alert: { alert: disk.alert } }));
vi.mock('../../src/app/document', () => ({
  addDocument: async (source: { name: string; bytes: string }) => ({
    identity: { id: `sha256:${source.bytes.repeat(64).slice(0, 64)}`, format: 'epub', publicationId: null, publicationIdSource: 'none' },
    title: source.name.replace(/\.[^.]+$/, ''),
  }),
}));
vi.mock('../../src/app/display-names', () => ({
  displayNames: () => disk.names,
  saveDisplayName: (id: string, name: string) => { disk.names = { ...disk.names, [id]: name }; },
}));
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'test-phone',
  readLibrary: () => ({ entries: disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: LibraryEntry[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: LibraryEntry[]) => { disk.entries = entries; },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () =>
  createFolderStore({ read: () => disk.folders, write: (text) => { disk.folders = text; }, id: () => 'fiction' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function mount() {
  let library!: Library; let renderer!: ReactTestRenderer;
  function Probe() { library = useLibrary(); return null; }
  await act(async () => { renderer = create(createElement(Probe)); });
  return { get library() { return library; }, unmount: () => act(async () => renderer.unmount()) };
}
type Mounted = Awaited<ReturnType<typeof mount>>;

/** Import as the Library screen does: a new Document is opened at once. */
async function importInto(m: Mounted, folder: FolderId | null, name: string, bytes: string): Promise<DocumentId[]> {
  const opened: DocumentId[] = [];
  await act(async () => { await importDocument(m.library, { name, bytes } as never, { move: true, folder }, (id) => opened.push(id)); });
  return opened;
}
const titles = (library: Library) => library.entries.map((entry) => entry.title).sort();

beforeEach(() => {
  disk.entries = []; disk.folders = null; disk.names = {}; disk.alert.mockReset();
});

describe('a Document is called by its file name (#226)', () => {
  it('from the import, through the reader opening it, to the next launch', async () => {
    const m = await mount();
    const [id] = await importInto(m, null, 'pride.epub', 'a');
    expect(m.library.current(id)!.title).toBe('pride');
    await m.unmount();
    const again = await mount();
    expect(titles(again.library)).toEqual(['pride']);
    await again.unmount();
  });

  it('the Library offers no way to give a Document a name but Rename', async () => {
    const m = await mount();
    expect(Object.keys(m.library)).not.toContain('retitled');
    await m.unmount();
  });

  it('the reader takes only the language from the EPUB metadata, not its title', () => {
    const view = readFileSync('src/app/reading-view.tsx', 'utf8');
    expect(view).not.toMatch(/getMeta\(\)\.title|meta\.title|onTitle/);
  });
});
