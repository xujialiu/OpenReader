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
 * Doubled: the file reading (`identifyFile` gives the Document Id from the
 * file's bytes and the title from its name without the extension, as
 * `src/app/document.ts` does), the display names, the Library and Folder files,
 * and the phone's alert.
 */

const disk = vi.hoisted(() => ({ entries: [] as LibraryEntry[], folders: null as string | null, names: {} as Record<string, string>, alert: vi.fn(), kept: [] as string[] }));
vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('react-native', () => ({ Alert: { alert: disk.alert } }));
vi.mock('../../src/app/document', () => ({
  keepFile: (added: { identity: { id: string } }) => { disk.kept.push(added.identity.id); },
  identifyFile: async (source: { name: string; bytes: string }) => ({
    identity: { id: `sha256:${source.bytes.repeat(64).slice(0, 64)}`, format: 'epub', publicationId: null, publicationIdSource: 'none' },
    title: source.name.replace(/\.[^.]+$/, ''),
  }),
}));
vi.mock('../../src/app/display-names', () => ({
  displayNames: () => disk.names,
  saveDisplayName: (id: string, name: string) => { disk.names = { ...disk.names, [id]: name }; },
  forgetDisplayName: (id: string) => { const { [id]: _gone, ...rest } = disk.names; disk.names = rest; },
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
  disk.entries = []; disk.folders = null; disk.names = {}; disk.alert.mockReset(); disk.kept = [];
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

/** The Documents in `folder` called `name`, as the Library screen lists them. */
function namesakes(library: Library, folder: FolderId | null, name: string): LibraryEntry[] {
  const tree = library.folderSnapshot.tree;
  const key = (one: string) => one.normalize('NFC').toLowerCase();
  return library.entries.filter((entry) => (tree.documents[entry.id] ?? null) === folder && key(entry.title) === key(name));
}
/** The phone's alert, answered with the button called `answer`. */
function answer(text: string) {
  disk.alert.mockImplementation((_title: string, _message: string, buttons: { text: string; onPress?: () => void }[]) => buttons.find((button) => button.text === text)!.onPress?.());
}
async function withFiction() {
  const m = await mount();
  let fiction!: FolderId;
  await act(async () => { fiction = m.library.folders.create('Fiction', null); });
  return { m, fiction };
}

describe('two Documents in one Folder are not called alike (#227)', () => {
  it('control: the same file again is still "Document already exists", and its file is kept again', async () => {
    const { m, fiction } = await withFiction();
    answer('Cancel');
    await importInto(m, fiction, 'Pride and Prejudice.epub', 'a');
    await importInto(m, fiction, 'Pride and Prejudice.epub', 'a');
    expect(disk.alert.mock.calls.map((call) => call[0])).toEqual(['Document already exists']);
    expect(namesakes(m.library, fiction, 'Pride and Prejudice')).toHaveLength(1);
    // Adding a book again is how a file that has gone comes back (`openDocument`).
    expect(disk.kept).toHaveLength(2);
    await m.unmount();
  });

  it('asks before a different file of the same name is added beside it; Cancel keeps nothing', async () => {
    const { m, fiction } = await withFiction();
    answer('Cancel');
    await importInto(m, fiction, 'Pride and Prejudice.epub', 'a');
    const opened = await importInto(m, fiction, 'Pride and Prejudice.epub', 'b');
    expect(disk.alert).toHaveBeenCalledOnce();
    const [title, message, buttons] = disk.alert.mock.calls[0];
    expect(title).toBe('Name already exists');
    expect(message).toBe('“Pride and Prejudice”\nLocation: Library → Fiction\nKeep Both adds this one as “Pride and Prejudice 2”.');
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(['Cancel', 'Keep Both']);
    expect(opened).toEqual([]);
    expect(m.library.entries).toHaveLength(1);
    expect(disk.kept).toHaveLength(1);
    expect(Object.keys(m.library.folderSnapshot.tree.documents)).toHaveLength(1);
    await m.unmount();
  });

  it('Keep Both adds and opens the new one under the first free number', async () => {
    const { m, fiction } = await withFiction();
    answer('Keep Both');
    await importInto(m, fiction, 'Emma.epub', 'a');
    await importInto(m, fiction, 'Emma 2.epub', 'b');
    const [third] = await importInto(m, fiction, 'emma.epub', 'c');
    expect(disk.alert.mock.calls.map((call) => call[1])).toEqual(['“emma”\nLocation: Library → Fiction\nKeep Both adds this one as “emma 3”.']);
    expect(m.library.current(third)!.title).toBe('emma 3');
    expect(m.library.folderSnapshot.tree.documents[third]).toBe(fiction);
    expect(titles(m.library)).toEqual(['Emma', 'Emma 2', 'emma 3']);
    await m.unmount();
  });

  it('compares names as Folders do: ignoring letter case, by NFC, and trimmed', async () => {
    const { m, fiction } = await withFiction();
    answer('Cancel');
    await importInto(m, fiction, 'Ce\u0301line.epub', 'a');
    await importInto(m, fiction, 'CÉLINE.epub', 'b');
    expect(disk.alert).toHaveBeenCalledOnce();
    await m.unmount();
  });

  it('a name in another Folder, or a Folder of the name, does not count', async () => {
    const { m, fiction } = await withFiction();
    await importInto(m, null, 'Fiction.epub', 'a');
    await importInto(m, fiction, 'Fiction.epub', 'b');
    expect(disk.alert).not.toHaveBeenCalled();
    expect(titles(m.library)).toEqual(['Fiction', 'Fiction']);
    await m.unmount();
  });

  it('without anyone to ask, as from the walkthrough harness, a taken name is refused', async () => {
    const { m, fiction } = await withFiction();
    await importInto(m, fiction, 'Emma.epub', 'a');
    let refused: unknown = null;
    await act(async () => { await m.library.add({ name: 'Emma.epub', bytes: 'b' } as never, { move: false, folder: fiction }).catch((problem: unknown) => { refused = problem; }); });
    expect((refused as Error).message).toBe('“Emma”: A document with this name already exists here. Rename it first.');
    expect(m.library.entries).toHaveLength(1);
    expect(disk.kept).toHaveLength(1);
    await m.unmount();
  });

  it('Rename refuses a name another Document in its Folder has, and accepts its own in other letters', async () => {
    const { m, fiction } = await withFiction();
    const [emma] = await importInto(m, fiction, 'Emma.epub', 'a');
    const [other] = await importInto(m, fiction, 'Persuasion.epub', 'b');
    const [elsewhere] = await importInto(m, null, 'Mansfield Park.epub', 'c');
    expect(() => m.library.rename(other, ' emma ')).toThrow('A document with this name already exists here. Rename it first.');
    expect(m.library.current(other)!.title).toBe('Persuasion');
    expect(disk.names).toEqual({});
    await act(async () => { m.library.rename(emma, 'EMMA'); });
    await act(async () => { m.library.rename(elsewhere, 'Persuasion'); });
    expect(titles(m.library)).toEqual(['EMMA', 'Persuasion', 'Persuasion']);
    await m.unmount();
  });
});

describe('a Document deleted and added again has one name (#180)', () => {
  it('the file\'s name, from the moment it is added and after the next launch', async () => {
    const m = await mount();
    const [id] = await importInto(m, null, 'pg1342-images-3.epub', 'd');
    await act(async () => { m.library.rename(id, 'P&P (school copy)'); });
    await act(async () => { m.library.remove(id); });
    await importInto(m, null, 'pg1342-images-3.epub', 'd');
    const inSession = m.library.current(id)!.title;
    await m.unmount();
    const again = await mount();
    expect({ inSession, afterLaunch: again.library.current(id)!.title }).toEqual({ inSession: 'pg1342-images-3', afterLaunch: 'pg1342-images-3' });
    expect(disk.names).toEqual({});
    await again.unmount();
  });

  it('a name left from before the deletion does not land on a namesake in the Folder at the next launch', async () => {
    const { m, fiction } = await withFiction();
    const [a] = await importInto(m, fiction, 'a.epub', 'a');
    await act(async () => { m.library.rename(a, 'Emma'); });
    await act(async () => { m.library.remove(a); });
    await importInto(m, fiction, 'Emma.epub', 'c');
    await importInto(m, fiction, 'a.epub', 'a');
    await m.unmount();
    const again = await mount();
    expect(namesakes(again.library, fiction, 'Emma')).toHaveLength(1);
    expect(titles(again.library)).toEqual(['Emma', 'a']);
    await again.unmount();
  });

  it('a name the Document still has is kept: the same file again is a duplicate, not a new entry', async () => {
    const m = await mount();
    answer('Cancel');
    const [id] = await importInto(m, null, 'pride.epub', 'a');
    await act(async () => { m.library.rename(id, 'Pride'); });
    await importInto(m, null, 'pride.epub', 'a');
    expect(disk.names).toEqual({ [id]: 'Pride' });
    expect(m.library.current(id)!.title).toBe('Pride');
    await m.unmount();
  });
});
