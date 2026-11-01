import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeScrollEvent, NativeSyntheticEvent, TextInput } from 'react-native';
import { asDocumentId } from '../../src/core/document';
import type { ScreenProps } from '../../src/app/routes';
import { useLibrarySearch } from '../../src/app/use-library-search';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const document = asDocumentId(`sha256:${'a'.repeat(64)}`)!;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); };
/** A list `y` points down its content, as React Native reports it: the offset and the explicit inset. */
const scroll = (y: number, inset = 0) => ({ nativeEvent: { contentOffset: { x: 0, y: y - inset }, contentInset: { top: inset } } }) as NativeSyntheticEvent<NativeScrollEvent>;

async function open() {
  const listeners = new Map<string, Set<() => void>>();
  let focused = true;
  let top: { key: string; name: string; params?: { id: string } } = { key: 'library', name: 'Library' };
  const navigation = {
    isFocused: () => focused,
    getState: () => ({ index: 0, routes: [top] }),
    setOptions: vi.fn(),
    addListener: (name: string, callback: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
      return () => { listeners.get(name)!.delete(callback); };
    },
  } as unknown as ScreenProps<'Library' | 'Folder'>['navigation'];
  let search!: ReturnType<typeof useLibrarySearch>;
  let view!: ReactTestRenderer;
  const list = { scrollToOffset: vi.fn() };
  const field = { focus: vi.fn(), blur: vi.fn() };
  function Probe() {
    search = useLibrarySearch(navigation, 'library');
    // The page draws the field only while search is open; the hook is handed its ref.
    search.field.current = search.active ? field as unknown as TextInput : null;
    return null;
  }
  await act(async () => { view = create(createElement(Probe)); });
  search.attachList(list);
  const emit = (name: string) => { listeners.get(name)?.forEach((callback) => callback()); };
  return {
    get search() { return search; }, field, list, navigation,
    start: () => act(async () => search.start()),
    type: (text: string) => act(async () => search.change(text)),
    exit: () => act(async () => search.exit()),
    async leave(name: string, id = document) {
      await act(async () => { focused = false; top = { key: 'other', name, params: { id } }; emit('state'); emit('blur'); });
    },
    async return() {
      await act(async () => { top = { key: 'library', name: 'Library' }; focused = true; emit('state'); emit('focus'); });
    },
    close: () => act(async () => view.unmount()),
  };
}

describe('page-local Library search lifecycle (#332, #339)', () => {
  it('starts closed, never touches the title bar, and opens only when asked', async () => {
    const page = await open();
    expect(page.search).toMatchObject({ active: false, query: '' });
    expect(page.navigation.setOptions).not.toHaveBeenCalled();
    await page.type('ignored'); // nothing to type into before search opens
    expect(page.search).toMatchObject({ active: false, query: '' });
    await page.start();
    expect(page.search).toMatchObject({ active: true, query: '' });
    // The field takes the keyboard by itself as it appears; start does not race it.
    expect(page.field.focus).not.toHaveBeenCalled();
    await page.close();
  });
  it('a second start, from Command-F or the menu, puts the cursor back in the open field', async () => {
    const page = await open();
    await page.start(); await page.type('body');
    await page.start();
    expect(page.field.focus).toHaveBeenCalledOnce();
    expect(page.search).toMatchObject({ active: true, query: 'body' });
    await page.close();
  });
  it('closing clears the query and returns the list to where browsing was, retrying until the list is long enough', async () => {
    const page = await open();
    page.search.onScroll(scroll(720));
    await page.start(); await page.type('body'); flush();
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    page.search.onScroll(scroll(0));
    await page.exit(); flush();
    expect(page.search).toMatchObject({ active: false, query: '' });
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 720, animated: false });
    // The short result list may clamp the first request; the browsing list's new size retries it.
    page.search.onScroll(scroll(10)); page.list.scrollToOffset.mockClear();
    page.search.onContentSizeChange();
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 720, animated: false });
    // Reaching it, or a drag, retires the request.
    page.search.onScroll(scroll(720)); page.list.scrollToOffset.mockClear();
    page.search.onContentSizeChange();
    expect(page.list.scrollToOffset).not.toHaveBeenCalled();
    await page.close();
  });
  it('closes an empty search too, and stays closed until asked again', async () => {
    const page = await open();
    await page.start(); await page.exit();
    expect(page.search).toMatchObject({ active: false, query: '' });
    await page.exit();
    expect(page.search.active).toBe(false);
    await page.close();
  });
  it('measures positions from the top of the content, explicit inset included', async () => {
    const page = await open();
    page.search.onScroll(scroll(400, 50));
    await page.start(); await page.type('body'); await page.exit(); flush();
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 350, animated: false });
    await page.close();
  });
  it('clearing the query restores ordinary browsing without ending search', async () => {
    const page = await open();
    page.search.onScroll(scroll(400));
    await page.start(); await page.type('body');
    page.search.onScroll(scroll(0));
    await page.type(''); flush();
    expect(page.search).toMatchObject({ active: true, query: '' });
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 400, animated: false });
    page.search.onScrollBeginDrag(); page.list.scrollToOffset.mockClear();
    page.search.onContentSizeChange();
    expect(page.list.scrollToOffset).not.toHaveBeenCalled();
    await page.close();
  });
  it('keeps a result round trip, ignores the list while away, and does not refocus on return', async () => {
    const page = await open();
    await page.start(); await page.type('body');
    page.search.onScroll(scroll(300));
    page.search.openingResult(document);
    expect(page.field.blur).toHaveBeenCalledOnce();
    await page.leave('Reader');
    page.search.onScroll(scroll(0)); // the transition may move the list behind the Reader
    await page.type('changed while away');
    expect(page.search.query).toBe('body');
    await page.return();
    expect(page.search).toMatchObject({ active: true, query: 'body' });
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 300, animated: false });
    expect(page.field.focus).not.toHaveBeenCalled();
    await page.close();
  });
  it('clears for Settings, another Folder, another Reader, rather than retaining any navigation', async () => {
    for (const destination of ['Settings', 'Folder', 'Reader']) {
      const page = await open();
      await page.start(); await page.type('body');
      await page.leave(destination);
      expect(page.search).toMatchObject({ active: false, query: '' });
      await page.return();
      expect(page.search.active).toBe(false);
      await page.close();
    }
  });
  it('ends a retained search if navigation moves beyond the result Reader while the Library remains blurred', async () => {
    const page = await open();
    await page.start(); await page.type('body'); page.search.openingResult(document);
    await page.leave('Reader'); await page.leave('Settings');
    expect(page.search).toMatchObject({ active: false, query: '' });
    await page.close();
  });
  it('an empty query opens no Reader round trip, and a blurred page cannot start search', async () => {
    const page = await open();
    await page.start();
    page.search.openingResult(document);
    expect(page.field.blur).not.toHaveBeenCalled();
    await page.exit();
    await page.leave('Settings');
    await page.start();
    expect(page.search.active).toBe(false);
    await page.close();
  });
  it('a new page mount has no restored query or search history', async () => {
    const old = await open(); await old.start(); await old.type('private phrase'); await old.close();
    const fresh = await open();
    expect(fresh.search).toMatchObject({ active: false, query: '' });
    await fresh.close();
  });
});
