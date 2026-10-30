import { createElement, type ReactElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchBarCommands, SearchBarProps } from 'react-native-screens';
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

async function open() {
  let options: Record<string, unknown> = {};
  const field: SearchBarCommands = { focus: vi.fn(), blur: vi.fn(), clearText: vi.fn(), setText: vi.fn(), cancelSearch: vi.fn(), toggleCancelButton: vi.fn(), captureScrollPosition: vi.fn(), restoreScrollPosition: vi.fn() };
  const visit = vi.fn();
  const navigation = {
    setOptions: (next: Record<string, unknown>) => {
      options = { ...options, ...next };
      const bar = next.headerSearchBarOptions as SearchBarProps | undefined;
      if (bar?.ref) bar.ref.current = field;
    },
    isFocused: () => true, getState: () => ({ index: 0, routes: [{ key: 'folder', name: 'Folder' }] }),
    addListener: () => () => {}, navigate: vi.fn(), push: vi.fn(),
  };
  const props = { navigation, route: { key: 'folder', name: 'Folder', params: { id: 'inner' } } } as unknown as ScreenProps<'Library' | 'Folder'>;
  const populate = () => {
    shell.current = { settings: { enabledProviders: [] }, sync: { poke: vi.fn() }, library: {
      entries, folderSnapshot: { tree, busy: false, problem: null }, loading: false, note: null,
      folders: { getSnapshot: () => ({ tree }), visit }, beginOperation: () => vi.fn(), report: vi.fn(),
    } };
  };
  populate();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(LibraryScreen, props)); });
  const nodes = (type: string) => view.root.findAll((node) => node.type === type);
  const drawer = () => nodes('Drawer').find((node) => node.props.title === 'Library actions')!;
  const row = (text: string) => nodes('DrawerRow').find((node) => node.findAll((child) => String(child.type) === 'DrawerRowText' && child.props.children === text).length)!;
  const searchOptions = () => options.headerSearchBarOptions as SearchBarProps | undefined;
  return {
    field, navigation, visit, nodes, drawer, row, searchOptions,
    async menu() {
      const button = (options.headerRight as () => ReactElement<{ onPress(): void }>)();
      await act(async () => button.props.onPress());
    },
    type: (text: string) => act(async () => searchOptions()?.onChangeText?.({ nativeEvent: { text } } as Parameters<NonNullable<SearchBarProps['onChangeText']>>[0])),
    update: () => act(async () => { populate(); view.update(createElement(LibraryScreen, props)); }),
    close: () => act(async () => view.unmount()),
  };
}

describe('Library Search through the real page and actions Drawer (#332)', () => {
  it('keeps short and empty content filling the scroll viewport for blank-space pulls', async () => {
    const page = await open();
    expect(page.nodes('DocumentRow')).toHaveLength(1);
    expect(page.nodes('FlatList')[0].props.contentContainerStyle).toMatchObject({ flexGrow: 1 });
    entries = [];
    await page.update();
    expect(page.nodes('DocumentRow')).toHaveLength(0);
    expect(page.nodes('FlatList')[0].props.contentContainerStyle).toMatchObject({ flexGrow: 1 });
    await page.close();
  });
  it('the ordinary nested Folder has only its own Documents; search reveals namesakes from every level with paths', async () => {
    const page = await open();
    expect(page.nodes('DocumentRow').map((node) => node.props.title)).toEqual(['三体']);
    expect(page.field.focus).not.toHaveBeenCalled();
    await page.type('body');
    expect(page.nodes('DocumentRow').map((node) => node.props.progress)).toEqual(['Library', 'Library → Fiction']);
    expect(page.nodes('FolderRow')).toHaveLength(0);
    expect(page.visit).not.toHaveBeenCalled(); // search does not change the browsing/import destination
    await page.close();
  });
  it('waits for native Drawer dismissal before focusing Search, and fires it only once', async () => {
    const page = await open();
    await page.menu();
    expect(page.nodes('DrawerRowText').map((node) => node.props.children)).toEqual(['Import file', 'Create folder', 'Search', 'Select']);
    await act(async () => page.row('Search').props.onPress());
    expect(page.drawer().props.visible).toBe(false);
    expect(page.field.focus).not.toHaveBeenCalled();
    await act(async () => page.drawer().props.onDismiss());
    expect(page.field.focus).toHaveBeenCalledOnce();
    await act(async () => page.drawer().props.onDismiss());
    expect(page.field.focus).toHaveBeenCalledOnce();
    await page.close();
  });
  it('no matches shows only the no-results state, while clearing the query restores the original list', async () => {
    const page = await open();
    await page.type('missing');
    expect(page.nodes('DocumentRow')).toHaveLength(0);
    expect(page.nodes('Text').map((node) => node.props.children)).toContain('No documents found');
    expect(page.nodes('Note')).toHaveLength(0); // not an empty-Library provider prompt
    await page.type('');
    expect(page.nodes('DocumentRow').map((node) => node.props.title)).toEqual(['三体']);
    await page.close();
  });
  it('retains single-Document actions while removing every selection entry and the two-finger sweep', async () => {
    const page = await open();
    await page.type('body');
    expect(sweeping.enabled).toBe(false);
    await act(async () => page.nodes('DocumentRow')[0].props.onActions());
    expect(page.nodes('ReaderActions')[0].props).toMatchObject({ document: entries[0].id, movable: true });
    expect(page.nodes('ReaderActions')[0].props.onDelete).toBeTypeOf('function');
    expect(page.nodes('ReaderActions')[0].props.onSelect).toBeUndefined();
    await page.menu();
    expect(page.nodes('DrawerRowText').map((node) => node.props.children)).not.toContain('Select');
    await page.close();
  });
  it('selection removes the native search controller, so a downward pull cannot enter search', async () => {
    const page = await open();
    await page.menu();
    await act(async () => page.row('Select').props.onPress());
    expect(page.searchOptions()).toBeUndefined();
    expect(page.nodes('DocumentRow')[0].props.selected).toBe(false);
    await page.close();
  });
  it('results respond to renamed, moved and deleted Documents, while actions still address their identity', async () => {
    const page = await open(); await page.type('body');
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
