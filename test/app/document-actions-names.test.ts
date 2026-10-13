import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asDocumentId, type DocumentId, type LibraryEntry } from '../../src/core/document';
import { createFolderStore, type FolderId } from '../../src/core/folders';
import { ReaderActions } from '../../src/app/reader-actions';
import { useLibrary, type Library } from '../../src/app/use-library';

/**
 * A Document's actions Drawer over the real Library and Folder store: Rename
 * and Move to… keep two Documents in one Folder from being called alike
 * (#227). The phone's views are drawn as plain elements that keep their props;
 * the Drawer's other pages, the shell and the files are doubled.
 */

const disk = vi.hoisted(() => ({ entries: [] as LibraryEntry[], folders: null as string | null, full: false, names: {} as Record<string, string>, alert: vi.fn() }));
const shell = vi.hoisted(() => ({ current: null as unknown }));
const field = vi.hoisted(() => ({ value: '', get() { return this.value; } }));
const full = vi.hoisted(() => () => { if (disk.full) throw new Error('No space left on device'); });
const hosts = vi.hoisted(() => async (...names: string[]) => {
  const { createElement: element } = await import('react');
  return Object.fromEntries(names.map((name) => [name, ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => element(name, props, children)]));
});

vi.mock('expo-file-system', () => ({ File: class {} }));
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: disk.alert } }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: (value: boolean) => ({ disabled: value }) }));
vi.mock('@expo/ui/swift-ui', async () => {
  const views = await hosts('Alert', 'Trigger', 'Actions', 'Button', 'Host', 'Text', 'TextField');
  return { ...views, Alert: Object.assign(views.Alert, { Trigger: views.Trigger, Actions: views.Actions }), useNativeState: () => field };
});
vi.mock('../../src/app/controls', async () => ({ SchemeContext: (await import('react')).createContext(null), INK: { attention: 'red' } }));
vi.mock('../../src/app/drawer', () => hosts('Drawer', 'DrawerChevron', 'DrawerFooter', 'DrawerRow', 'DrawerRowText', 'DrawerScroll'));
vi.mock('../../src/app/appearance-sheet', () => hosts('AppearanceControls', 'FontList'));
vi.mock('../../src/app/download-sheet', () => hosts('DownloadContent'));
vi.mock('../../src/app/highlight-section', () => hosts('HighlightPage'));
vi.mock('../../src/app/reading-host', () => ({ useHeldReading: () => ({ current: null }) }));
vi.mock('../../src/app/routes', () => ({ useShell: () => shell.current }));
vi.mock('../../src/app/settings', () => ({ PROVIDER_LABELS: {}, selectVoice: vi.fn(), settingsForDocument: () => ({ provider: 'openai', voice: '' }) }));
vi.mock('../../src/app/share-document', () => ({ shareDocument: vi.fn() }));
vi.mock('../../src/app/voice-catalog', () => ({ knownVoice: () => null }));
vi.mock('../../src/renderer', () => ({ spineIndexOf: () => 0 }));
vi.mock('../../src/app/document', () => ({ identifyFile: vi.fn(), keepFile: vi.fn() }));
// The real saveDisplayName's last step is the native writeJson, which throws when the write fails.
vi.mock('../../src/app/display-names', () => ({
  displayNames: () => disk.names,
  saveDisplayName: (id: string, name: string) => { full(); disk.names = { ...disk.names, [id]: name }; },
}));
vi.mock('../../src/app/library', () => ({
  thisDevice: () => 'test-phone',
  readLibrary: () => ({ entries: disk.entries, problems: [], ignored: [], frozen: false, note: null }),
  migrateDocumentIds: (loaded: { entries: LibraryEntry[] }) => ({ entries: loaded.entries, note: null }),
  writeLibrary: (entries: LibraryEntry[]) => { full(); disk.entries = entries; },
}));
vi.mock('../../src/app/folder-storage', () => ({ openFolderStore: () =>
  createFolderStore({ read: () => disk.folders, write: (text) => { full(); disk.folders = text; }, id: () => 'f1' }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const idOf = (letter: string) => asDocumentId(`sha256:${letter.repeat(64)}`)!;
const EMMA = idOf('a');
const PERSUASION = idOf('b');
const LOOSE = idOf('c');
const entry = (id: DocumentId, title: string, at: number): LibraryEntry => ({
  id, format: 'epub', publicationId: null, publicationIdSource: 'none', title, position: null, voice: null, stamp: { at, device: 'test' },
});
const TAKEN = 'A document with this name already exists here. Rename it first.';

beforeEach(() => {
  // Emma and Persuasion in Fiction; another Emma at the Library root.
  disk.entries = [entry(EMMA, 'Emma', 30), entry(PERSUASION, 'Persuasion', 20), entry(LOOSE, 'Emma', 10)];
  disk.folders = JSON.stringify({ version: 1, folders: [{ id: 'fiction', name: 'Fiction', parent: null }], documents: { [EMMA]: 'fiction', [PERSUASION]: 'fiction' }, current: null });
  disk.full = false; disk.names = {}; field.value = ''; disk.alert.mockReset();
});

/** The real Library with one Document's actions Drawer over it, as the Library screen mounts them. */
async function open(document: DocumentId) {
  let library!: Library; let view!: ReactTestRenderer;
  const onClose = vi.fn();
  function Screen() {
    library = useLibrary();
    shell.current = { library, settings: {}, setSettings: vi.fn() };
    return library.loading ? null : createElement(ReaderActions, { document, movable: true, onClose });
  }
  await act(async () => { view = create(createElement(Screen)); });
  const all = (type: string, where: (props: Record<string, unknown>) => boolean) =>
    view.root.findAll((node) => String(node.type) === type && where(node.props));
  const press = (type: string, where: (props: Record<string, unknown>) => boolean) =>
    act(async () => { (all(type, where)[0].props.onPress as () => void)(); });
  return {
    get library() { return library; }, onClose,
    /** Rename, type the name, then Save: what Save's press handler throws is returned. */
    async rename(to: string) {
      await press('DrawerRow', (props) => props.icon === 'rename');
      field.value = to;
      let thrown: unknown = null;
      await act(async () => { try { (all('Button', (props) => props.label === 'Save')[0].props.onPress as () => void)(); } catch (problem) { thrown = problem; } });
      return thrown;
    },
    /** Move to…, into the Folder called `folder`, then Move. */
    async move(folder: string) {
      await press('DrawerRow', (props) => props.icon === 'folder');
      const row = view.root.findAll((node) => String(node.type) === 'DrawerRow' && node.props.icon === 'folder' &&
        node.findAll((text) => String(text.type) === 'DrawerRowText' && text.props.children === folder).length > 0)[0];
      await act(async () => { (row.props.onPress as () => void)(); });
      await act(async () => { ((all('Drawer', () => true)[0].props.action as { onPress(): void }).onPress)(); });
    },
    footer: () => all('DrawerFooter', (props) => props.attention === true).map((node) => node.props.children),
    placeOf: (id: DocumentId): FolderId | null => library.folderSnapshot.tree.documents[id] ?? null,
    close: () => act(async () => view.unmount()),
  };
}

describe('Rename and Move to… in a Document\'s actions (#227)', () => {
  it('Rename to a name another Document in its Folder has is refused as a Folder\'s is, and the name is kept', async () => {
    const screen = await open(PERSUASION);
    expect(await screen.rename('emma')).toBeNull();
    expect(disk.alert).toHaveBeenCalledOnce();
    expect(disk.alert.mock.calls[0].slice(0, 2)).toEqual(['Name unavailable', `“emma”\n${TAKEN}`]);
    expect(screen.library.current(PERSUASION)!.title).toBe('Persuasion');
    expect(screen.onClose).not.toHaveBeenCalled();
    await screen.close();
  });

  it('control: Rename to a name free in its Folder, though another Folder has it, renames and closes', async () => {
    const screen = await open(LOOSE);
    expect(await screen.rename('Persuasion')).toBeNull();
    expect(disk.alert).not.toHaveBeenCalled();
    expect(screen.library.current(LOOSE)!.title).toBe('Persuasion');
    expect(screen.onClose).toHaveBeenCalledOnce();
    await screen.close();
  });

  it('Move to… a Folder holding a Document of its name says why and leaves it where it was', async () => {
    const screen = await open(LOOSE);
    await screen.move('Fiction');
    expect(disk.alert.mock.calls.map((call) => call.slice(0, 2))).toEqual([['Could not move', `“Emma”: ${TAKEN}`]]);
    expect(screen.placeOf(LOOSE)).toBeNull();
    expect(screen.onClose).not.toHaveBeenCalled();
    await screen.close();
  });

  it('control: Move to… a Folder where its name is free moves it', async () => {
    disk.entries = disk.entries.map((one) => one.id === LOOSE ? { ...one, title: 'Mansfield Park' } : one);
    const screen = await open(LOOSE);
    await screen.move('Fiction');
    expect(disk.alert).not.toHaveBeenCalled();
    expect(screen.placeOf(LOOSE)).toBe('fiction');
    expect(screen.onClose).toHaveBeenCalledOnce();
    await screen.close();
  });
});

describe('Save in a Document\'s Rename when the name cannot be written (#215)', () => {
  it('says why under the rows, keeps the old name and leaves the Drawer open, without throwing', async () => {
    const screen = await open(PERSUASION);
    disk.full = true;
    expect(await screen.rename('Mansfield Park')).toBeNull();
    expect(screen.footer()).toEqual(['No space left on device']);
    expect(screen.library.current(PERSUASION)!.title).toBe('Persuasion');
    expect(disk.names).toEqual({});
    expect(screen.onClose).not.toHaveBeenCalled();
    expect(disk.alert).not.toHaveBeenCalled();
    await screen.close();
  });

  it('the line goes when Rename is chosen again, and a name that can then be written is saved', async () => {
    const screen = await open(PERSUASION);
    disk.full = true;
    await screen.rename('Mansfield Park');
    disk.full = false;
    expect(await screen.rename('Mansfield Park')).toBeNull();
    expect(screen.footer()).toEqual([]);
    expect(screen.library.current(PERSUASION)!.title).toBe('Mansfield Park');
    expect(screen.onClose).toHaveBeenCalledOnce();
    await screen.close();
  });
});
