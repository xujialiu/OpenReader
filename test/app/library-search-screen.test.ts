import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asDocumentId, type LibraryEntry } from '../../src/core/document';
import type { FolderTree } from '../../src/core/folders';
import type { ScreenProps } from '../../src/app/routes';
import { LibraryScreen } from '../../src/app/library-screen';

const shell = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const sweeping = vi.hoisted(() => ({ enabled: false, refuse: false }));
const hosts = vi.hoisted(() => async (...names: string[]) => {
  const { createElement: element } = await import('react');
  return Object.fromEntries(names.map((name) => [name, ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => element(name, props, children)]));
});
vi.mock('react-native', async () => {
  const { createElement: element } = await import('react');
  return {
    ...await hosts('View', 'Text'), Platform: { OS: 'ios' }, StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: vi.fn() },
    FlatList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ...props }: {
      data: unknown[]; renderItem(value: { item: unknown }): ReactNode; ListHeaderComponent: ReactNode; ListEmptyComponent: ReactNode;
    }) => element('FlatList', props, ListHeaderComponent, data.length
      ? data.map((item, index) => element('Row', { key: index }, renderItem({ item }))) : ListEmptyComponent),
  };
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock('react-native-gesture-handler', () => hosts('GestureDetector'));
vi.mock('../../src/app/routes', () => ({ useShell: () => shell.current }));
vi.mock('../../src/app/controls', async () => ({ ...await hosts('DocumentRow', 'FolderRow', 'HeaderButton', 'Note'), INK: {}, useAccent: () => ({ reading: '#345678' }) }));
vi.mock('../../src/app/document-cover', () => ({ useDocumentCover: () => null }));
vi.mock('../../src/app/document', () => ({ pickDocument: vi.fn() }));
vi.mock('../../src/app/import-document', () => ({ importDocument: vi.fn() }));
vi.mock('../../src/app/library', () => ({ documentFile: () => ({ exists: true }) }));
vi.mock('../../src/app/drawer', async () => {
  const { createElement: element } = await import('react');
  return { ...await hosts('DrawerScroll', 'DrawerRow', 'DrawerRowText', 'DrawerFooter', 'DrawerChevron'),
    Drawer: ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => element('Drawer', props, props.visible ? children : null) };
});
vi.mock('../../src/app/rename-alert', () => hosts('RenameAlert'));
vi.mock('../../src/app/reader-actions', () => hosts('ReaderActions'));
vi.mock('../../src/app/library-selection-actions', () => hosts('LibrarySelectionAction'));
vi.mock('../../src/app/library-search-field', () => hosts('LibrarySearchField'));
vi.mock('../../modules/open-reader-library-keys', () => hosts('LibraryKeys'));
vi.mock('../../src/app/reading-button', async () => ({ ...await hosts('ReadingButton'), READING_BUTTON_PLACE: { bottom: 12 } }));
vi.mock('../../src/app/reading-host', () => ({ useHeldReading: () => ({ current: null, end: vi.fn() }) }));
vi.mock('../../src/app/text-styles', () => ({ TEXT_EMPHASIZED: { title3: {} } }));
vi.mock('../../src/app/settings', () => ({ NO_PROVIDER_SENTENCE: 'No provider is enabled.' }));
vi.mock('../../src/offline/runtime', () => ({ formatBytes: vi.fn(), occupied: vi.fn(), removeDownloads: vi.fn(), requestInventory: vi.fn() }));
vi.mock('../../src/app/use-sweep', () => ({ useRowSweep: (rows: { enabled: boolean }) => {
  sweeping.enabled = rows.enabled;
  return { gesture: {}, nativeGesture: {}, list: { ref: vi.fn(), onScroll: vi.fn(), onContentSizeChange: vi.fn() }, guard: <A extends unknown[]>(press: (...args: A) => void) => (...args: A) => { if (!sweeping.refuse) press(...args); } };
} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const entry = (digit: string, title: string): LibraryEntry => ({
  id: asDocumentId(`sha256:${digit.repeat(64)}`)!, title, format: 'epub', publicationId: null,
  publicationIdSource: 'none', position: null, stamp: { at: Number(digit), device: 'phone' },
});
let entries: LibraryEntry[];
let tree: FolderTree;
beforeEach(() => {
  sweeping.refuse = false;
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', vi.fn());
  entries = [entry('3', 'Three Body Problem'), entry('2', '三体'), entry('1', 'Three Body Problem')];
  tree = { version: 1, current: 'inner', folders: [
    { id: 'outer', name: 'Fiction', parent: null }, { id: 'inner', name: 'Chinese', parent: 'outer' },
  ], documents: { [entries[1].id]: 'inner', [entries[2].id]: 'outer' } };
});
afterEach(() => vi.unstubAllGlobals());

type NativeItem = { type: string; label: string; icon?: { type: string; name: string }; disabled?: boolean; onPress(): void };

async function open(at: string | null = 'inner') {
  let options: Record<string, unknown> = {};
  const visit = vi.fn();
  const moveEntries = vi.fn();
  const navigation = {
    setOptions: (next: Record<string, unknown>) => { options = { ...options, ...next }; },
    isFocused: () => true, getState: () => ({ index: 0, routes: [{ key: 'folder', name: 'Folder' }] }),
    addListener: () => () => {}, navigate: vi.fn(), push: vi.fn(),
  };
  const props = { navigation, route: at === null ? { key: 'folder', name: 'Library' } : { key: 'folder', name: 'Folder', params: { id: at } } } as unknown as ScreenProps<'Library' | 'Folder'>;
  const populate = () => {
    shell.current = { settings: { enabledProviders: [] }, sync: { poke: vi.fn() }, library: {
      entries, folderSnapshot: { tree, busy: false, problem: null }, loading: false, note: null,
      current: (id: string) => entries.find((one) => one.id === id),
      folders: { getSnapshot: () => ({ tree, busy: false }), visit, moveEntries }, beginOperation: () => vi.fn(), report: vi.fn(),
    } };
  };
  populate();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(LibraryScreen, props)); });
  const nodes = (type: string) => view.root.findAll((node) => node.type === type);
  const drawer = (title = 'Library actions') => nodes('Drawer').find((node) => node.props.title === title)!;
  const row = (text: string) => nodes('DrawerRow').find((node) => node.findAll((child) => String(child.type) === 'DrawerRowText' && child.props.children === text).length)!;
  const field = () => nodes('LibrarySearchField')[0] as ReturnType<typeof nodes>[number] | undefined;
  const keys = () => nodes('LibraryKeys')[0];
  /** The bar's native items, which iOS draws in place of `headerLeft`/`headerRight` (#339). */
  const items = (side: 'left' | 'right') => (options[side === 'left' ? 'unstable_headerLeftItems' : 'unstable_headerRightItems'] as
    (() => NativeItem[]) | undefined)?.() ?? [];
  return {
    navigation, visit, moveEntries, nodes, drawer, row, field, keys, items,
    options: () => options,
    async menu() {
      await act(async () => items('right')[0].onPress());
    },
    /** The Library actions' Search, after the drawer's native dismissal. */
    async search() {
      await this.menu();
      await act(async () => this.row('Search').props.onPress());
      await act(async () => this.drawer().props.onDismiss());
    },
    async select() {
      await this.menu();
      await act(async () => this.row('Select').props.onPress());
    },
    type: (text: string) => act(async () => field()!.props.onChangeText(text)),
    key: (key: 'find' | 'escape') => act(async () => keys().props.onKey({ nativeEvent: { key } })),
    update: () => act(async () => { populate(); view.update(createElement(LibraryScreen, props)); }),
    close: () => act(async () => view.unmount()),
  };
}

describe('Library Search through the real page and actions Drawer (#332, #339)', () => {
  it('draws `…` as a native bar item, so pressing it never reaches the list\'s scroll-to-top', async () => {
    const page = await open();
    // A Folder page: the phone's back arrow on the left, `…` on the right.
    expect(page.items('left')).toEqual([]);
    expect(page.items('right')).toMatchObject([{ type: 'button', label: 'Library actions', icon: { type: 'sfSymbol', name: 'ellipsis' }, disabled: false }]);
    await page.select();
    expect(page.items('left')).toMatchObject([{ label: 'Select all' }]);
    expect(page.items('right')).toMatchObject([{ label: 'Cancel' }]);
    await page.close();
  });
  it('draws Settings at the Library root as a native bar item too', async () => {
    const page = await open(null);
    const [settings] = page.items('left');
    expect(settings).toMatchObject({ type: 'button', label: 'Settings', icon: { type: 'sfSymbol', name: 'slider.horizontal.3' } });
    await act(async () => settings.onPress());
    expect(page.navigation.navigate).toHaveBeenCalledWith('Settings');
    await page.close();
  });
  it('takes no inset from UIKit, so a restored position can reach the bottom a finger reaches', async () => {
    const page = await open();
    const list = page.nodes('FlatList')[0];
    expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
    expect(list.props.scrollIndicatorInsets).toEqual({ bottom: 0 });
    await page.close();
  });
  it('shows no field and sets nothing on the title bar until Search is chosen', async () => {
    const page = await open();
    expect(page.field()).toBeUndefined();
    expect(page.options().headerSearchBarOptions).toBeUndefined();
    expect(page.nodes('DocumentRow')).toHaveLength(1);
    await page.close();
  });
  it('the ordinary nested Folder has only its own Documents; search reveals namesakes from every level with paths', async () => {
    const page = await open();
    expect(page.nodes('DocumentRow').map((node) => node.props.title)).toEqual(['三体']);
    await page.search();
    await page.type('body');
    expect(page.field()!.props).toMatchObject({ query: 'body', locked: false });
    expect(page.nodes('DocumentRow').map((node) => node.props.progress)).toEqual(['Library', 'Library → Fiction']);
    expect(page.nodes('FolderRow')).toHaveLength(0);
    expect(page.visit).not.toHaveBeenCalled(); // search does not change the browsing/import destination
    await page.close();
  });
  it('waits for native Drawer dismissal before showing the field, and shows it only once', async () => {
    const page = await open();
    await page.menu();
    expect(page.nodes('DrawerRowText').map((node) => node.props.children)).toEqual(['Import file', 'Create folder', 'Search', 'Select']);
    await act(async () => page.row('Search').props.onPress());
    expect(page.drawer().props.visible).toBe(false);
    expect(page.field()).toBeUndefined();
    await act(async () => page.drawer().props.onDismiss());
    expect(page.nodes('LibrarySearchField')).toHaveLength(1);
    await act(async () => page.drawer().props.onDismiss());
    expect(page.nodes('LibrarySearchField')).toHaveLength(1);
    await page.close();
  });
  it('the close control ends search and takes the field away', async () => {
    const page = await open();
    await page.search(); await page.type('body');
    await act(async () => page.field()!.props.onClose());
    expect(page.field()).toBeUndefined();
    expect(page.nodes('DocumentRow').map((node) => node.props.title)).toEqual(['三体']);
    await page.close();
  });
  it('no matches shows only the no-results state, while clearing the query restores the original list', async () => {
    const page = await open();
    await page.search();
    await page.type('missing');
    expect(page.nodes('DocumentRow')).toHaveLength(0);
    expect(page.nodes('Text').map((node) => node.props.children)).toContain('No documents found');
    expect(page.nodes('Note')).toHaveLength(0); // not an empty-Library provider prompt
    await page.type('');
    expect(page.nodes('DocumentRow').map((node) => node.props.title)).toEqual(['三体']);
    expect(page.field()).toBeDefined();
    await page.close();
  });
  it('puts the keyboard away when a drawer opens over search, from the bar or from a result', async () => {
    const page = await open();
    await page.search(); await page.type('body');
    const blur = vi.fn();
    page.field()!.props.field.current = { blur, focus: vi.fn() };
    await act(async () => page.nodes('DocumentRow')[0].props.onActions());
    expect(blur).toHaveBeenCalledTimes(1);
    await act(async () => page.nodes('ReaderActions')[0].props.onClose());
    await page.menu();
    expect(blur).toHaveBeenCalledTimes(2);
    expect(page.field()!.props).toMatchObject({ query: 'body', locked: false }); // search stays open
    await page.close();
  });
  it('offers every selection entry over results: the actions\' Select, a result\'s own Select and the two-finger sweep', async () => {
    const page = await open();
    await page.search(); await page.type('body');
    expect(sweeping.enabled).toBe(true);
    await act(async () => page.nodes('DocumentRow')[0].props.onActions());
    expect(page.nodes('ReaderActions')[0].props).toMatchObject({ document: entries[0].id, movable: true });
    expect(page.nodes('ReaderActions')[0].props.onSelect).toBeTypeOf('function');
    await act(async () => page.nodes('ReaderActions')[0].props.onSelect());
    expect(page.nodes('DocumentRow').map((node) => node.props.selected)).toEqual([true, false]);
    expect(page.options().title).toBe('1 selected');
    await page.close();
  });
  it('selecting results locks the field, Select all takes every result, and Move opens where search began', async () => {
    const page = await open();
    await page.search(); await page.type('body');
    await page.select();
    expect(page.field()!.props).toMatchObject({ query: 'body', locked: true });
    await act(async () => page.items('left')[0].onPress());
    expect(page.options().title).toBe('2 selected');
    const move = page.nodes('LibrarySelectionAction').find((node) => node.props.action === 'Move')!;
    await act(async () => move.props.onPress());
    const sheet = page.drawer('Move to…');
    expect(sheet.props.visible).toBe(true);
    // Opened at the Folder search began in, which holds neither result, so Move can act there.
    expect(page.nodes('DrawerFooter').map((node) => node.props.children)).toContain('Library → Fiction → Chinese');
    expect(sheet.props.action.disabled).toBe(false);
    await act(async () => sheet.props.action.onPress());
    expect(page.moveEntries).toHaveBeenCalledWith(
      [{ kind: 'document', id: entries[0].id }, { kind: 'document', id: entries[2].id }],
      entries.map((one) => one.id), 'inner', expect.any(Object), 'results');
    // Selection ends; search, its query and its results stay.
    expect(page.options().title).toBe('Chinese');
    expect(page.field()!.props).toMatchObject({ query: 'body', locked: false });
    expect(page.nodes('DocumentRow')).toHaveLength(2);
    await page.close();
  });
  it('a selection made from an empty field is of the Folder\'s own rows, and locks the field all the same', async () => {
    const page = await open();
    await page.search();
    await page.select();
    await act(async () => page.items('left')[0].onPress());
    expect(page.options().title).toBe('1 selected');
    expect(page.field()!.props.locked).toBe(true);
    await page.close();
  });
  it('Command-F opens search and Escape ends selection before it closes search', async () => {
    const page = await open();
    expect(page.keys().props).toMatchObject({ find: true, escape: false });
    await page.key('find');
    expect(page.field()).toBeDefined();
    expect(page.keys().props).toMatchObject({ find: true, escape: true });
    await page.type('body');
    await page.select();
    expect(page.keys().props).toMatchObject({ find: false, escape: true });
    await page.key('find'); // nothing while selecting
    expect(page.options().title).toBe('0 selected');
    await page.key('escape');
    expect(page.options().title).toBe('Chinese');
    expect(page.field()!.props).toMatchObject({ query: 'body', locked: false });
    await page.key('escape');
    expect(page.field()).toBeUndefined();
    expect(page.keys().props).toMatchObject({ find: true, escape: false });
    await page.close();
  });
  it('offers no key while the Library actions are open', async () => {
    const page = await open();
    await page.menu();
    expect(page.keys().props).toMatchObject({ find: false, escape: false });
    await page.close();
  });
  it('results respond to renamed, moved and deleted Documents, while actions still address their identity', async () => {
    const page = await open(); await page.search(); await page.type('body');
    entries = [{ ...entries[0], title: 'Changed' }, entries[1], entries[2]];
    tree = { ...tree, documents: { ...tree.documents, [entries[2].id]: 'inner' } };
    await page.update();
    expect(page.nodes('DocumentRow').map((node) => node.props.progress)).toEqual(['Library → Fiction → Chinese']);
    await act(async () => page.nodes('DocumentRow')[0].props.onPress());
    expect(page.navigation.navigate).toHaveBeenLastCalledWith('Reader', { id: entries[2].id });
    entries = entries.slice(0, 2); await page.update();
    expect(page.nodes('DocumentRow')).toHaveLength(0);
    await page.close();
  });
  it('sends a row\'s press through the sweep, which drops the lift of a sweep begun on it (#335)', async () => {
    const page = await open();
    sweeping.refuse = true;
    await act(async () => page.nodes('DocumentRow')[0].props.onPress());
    expect(page.navigation.navigate).not.toHaveBeenCalled();
    sweeping.refuse = false;
    await act(async () => page.nodes('DocumentRow')[0].props.onPress());
    expect(page.navigation.navigate).toHaveBeenLastCalledWith('Reader', { id: entries[1].id });
    await page.close();
  });
});
