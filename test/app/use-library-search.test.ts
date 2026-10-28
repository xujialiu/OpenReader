import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchBarCommands, SearchBarProps } from 'react-native-screens';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { asDocumentId } from '../../src/core/document';
import type { ScreenProps } from '../../src/app/routes';
import { useLibrarySearch } from '../../src/app/use-library-search';

const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: platform }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const document = asDocumentId(`sha256:${'a'.repeat(64)}`)!;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
beforeEach(() => {
  frames = new Map(); nextFrame = 0; platform.OS = 'ios';
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());
const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); };
const scroll = (y: number, inset = 50) => ({ nativeEvent: { contentOffset: { x: 0, y: y - inset }, contentInset: { top: inset } } }) as NativeSyntheticEvent<NativeScrollEvent>;

async function open() {
  const listeners = new Map<string, Set<() => void>>();
  let focused = true;
  let top: { key: string; name: string; params?: { id: string } } = { key: 'library', name: 'Library' };
  let options: SearchBarProps | undefined;
  const field: SearchBarCommands = {
    focus: vi.fn(), blur: vi.fn(), clearText: vi.fn(), setText: vi.fn(), toggleCancelButton: vi.fn(),
    captureScrollPosition: vi.fn(), restoreScrollPosition: vi.fn(),
    cancelSearch: vi.fn(() => { options?.onCancelButtonPress?.(focusEvent()); options?.onChangeText?.(textEvent('')); }),
  };
  const navigation = {
    isFocused: () => focused,
    getState: () => ({ index: 0, routes: [top] }),
    setOptions: (next: { headerSearchBarOptions?: SearchBarProps }) => {
      options = next.headerSearchBarOptions;
      if (options?.ref && 'current' in options.ref) options.ref.current = field;
    },
    addListener: (name: string, callback: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
      return () => { listeners.get(name)!.delete(callback); };
    },
  } as unknown as ScreenProps<'Library' | 'Folder'>['navigation'];
  let search!: ReturnType<typeof useLibrarySearch>;
  let view!: ReactTestRenderer;
  const list = { scrollToOffset: vi.fn() };
  function Probe({ blocked = false }: { blocked?: boolean }) {
    search = useLibrarySearch(navigation, 'library', blocked);
    return null;
  }
  await act(async () => { view = create(createElement(Probe)); });
  search.attachList(list);
  const emit = (name: string) => { listeners.get(name)?.forEach((callback) => callback()); };
  return {
    get search() { return search; }, get options() { return options; }, field, list,
    type: (text: string) => act(async () => options?.onChangeText?.(textEvent(text))),
    focus: () => act(async () => options?.onFocus?.(focusEvent())),
    block: (blocked: boolean) => act(async () => view.update(createElement(Probe, { blocked }))),
    async leave(name: string, id = document) {
      await act(async () => { focused = false; top = { key: 'other', name, params: { id } }; emit('state'); emit('blur'); });
    },
    async return() {
      await act(async () => { top = { key: 'library', name: 'Library' }; focused = true; emit('state'); emit('focus'); });
    },
    close: () => act(async () => view.unmount()),
  };
}
const focusEvent = () => ({ nativeEvent: { target: 1 } }) as Parameters<NonNullable<SearchBarProps['onFocus']>>[0];
const textEvent = (text: string) => ({ nativeEvent: { text, target: 1, eventCount: 0 } }) as Parameters<NonNullable<SearchBarProps['onChangeText']>>[0];

describe('page-local Library search lifecycle (#332)', () => {
  it('starts hidden without focusing, uses stacked native search and never a standing integrated button', async () => {
    const page = await open();
    expect(page.search.active).toBe(false);
    expect(page.options).toMatchObject({ placement: 'stacked', hideWhenScrolling: true, allowToolbarIntegration: false, obscureBackground: false });
    expect(page.field.focus).not.toHaveBeenCalled();
    await act(async () => page.search.start());
    expect(page.field.focus).toHaveBeenCalledOnce();
    expect(page.field.captureScrollPosition).toHaveBeenCalledExactlyOnceWith('browse');
    expect(vi.mocked(page.field.captureScrollPosition).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(page.field.focus).mock.invocationCallOrder[0]);
    expect(page.search.active).toBe(true);
    expect(page.options?.hideWhenScrolling).toBe(false);
    await page.close();
  });
  it('does not cancel when the field blurs or the keyboard Search button is pressed', async () => {
    const page = await open();
    await page.focus(); await page.type('三体');
    await act(async () => page.options?.onSearchButtonPress?.(textEvent('三体')));
    expect(page.field.blur).toHaveBeenCalled();
    expect(page.search).toMatchObject({ active: true, query: '三体' });
    await page.close();
  });
  it('the non-iOS fallback retains its explicit-inset scroll behavior without calling iOS commands', async () => {
    platform.OS = 'android';
    const page = await open();
    page.search.onScroll(scroll(720));
    await act(async () => page.search.start());
    await page.type('body');
    flush();
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: -50, animated: false });
    page.search.onScroll(scroll(0));
    await act(async () => page.search.exit());
    flush();
    expect(page.search).toMatchObject({ active: false, query: '' });
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 670, animated: false });
    expect(page.options?.hideWhenScrolling).toBe(true);
    // Old short content may clamp the request. The new content size retries it.
    page.search.onScroll(scroll(10)); page.search.onContentSizeChange();
    expect(page.list.scrollToOffset).toHaveBeenLastCalledWith({ offset: 670, animated: false });
    expect(page.field.captureScrollPosition).not.toHaveBeenCalled();
    expect(page.field.restoreScrollPosition).not.toHaveBeenCalled();
    await page.close();
  });
  it('iOS cancellation ignores the misleading explicit zero inset and never uses the clamping RN scroll command', async () => {
    const page = await open();
    // The real cold event: raw -116, explicit inset 0, while adjusted inset is 116.
    page.search.onScroll(scroll(-116, 0));
    await act(async () => page.search.start());
    await page.type('body'); flush();
    expect(page.field.restoreScrollPosition).toHaveBeenLastCalledWith('top');
    page.search.onScroll(scroll(0, 0));
    await act(async () => page.search.exit()); flush();
    expect(page.search).toMatchObject({ active: false, query: '' });
    expect(page.field.captureScrollPosition).toHaveBeenCalledExactlyOnceWith('browse');
    expect(page.field.restoreScrollPosition).toHaveBeenLastCalledWith('browse');
    expect(page.list.scrollToOffset).not.toHaveBeenCalled();
    expect(page.options?.hideWhenScrolling).toBe(true);
    // Reapply when the original, larger list finishes laying out; a user drag retires the request.
    const calls = vi.mocked(page.field.restoreScrollPosition).mock.calls.length;
    page.search.onContentSizeChange();
    expect(vi.mocked(page.field.restoreScrollPosition).mock.calls).toHaveLength(calls + 1);
    page.search.onScrollBeginDrag(); page.search.onContentSizeChange();
    expect(vi.mocked(page.field.restoreScrollPosition).mock.calls).toHaveLength(calls + 1);
    await page.close();
  });
  it('clearing input restores ordinary browsing without ending search', async () => {
    const page = await open();
    page.search.onScroll(scroll(400));
    await page.focus(); await page.type('body');
    page.search.onScroll(scroll(0));
    await page.type(''); flush();
    expect(page.search).toMatchObject({ active: true, query: '' });
    expect(page.field.restoreScrollPosition).toHaveBeenLastCalledWith('browse');
    expect(page.field.captureScrollPosition).toHaveBeenCalledExactlyOnceWith('browse');
    expect(page.list.scrollToOffset).not.toHaveBeenCalled();
    await page.close();
  });
  it('keeps a result round trip but ignores late native cancel/change events while away, and does not refocus on return', async () => {
    const page = await open();
    await page.focus(); await page.type('body');
    page.search.onScroll(scroll(300));
    vi.mocked(page.field.blur).mockClear();
    page.search.openingResult(document);
    expect(page.field.captureScrollPosition).toHaveBeenLastCalledWith('results');
    expect(vi.mocked(page.field.captureScrollPosition).mock.invocationCallOrder.at(-1))
      .toBeLessThan(vi.mocked(page.field.blur).mock.invocationCallOrder[0]);
    await page.leave('Reader');
    await act(async () => page.options?.onCancelButtonPress?.(focusEvent()));
    await page.type('');
    expect(page.search.query).toBe('body');
    page.search.onScroll(scroll(0)); // UIKit may scroll the inactive controller during the transition.
    await page.return();
    expect(page.search).toMatchObject({ active: true, query: 'body' });
    expect(page.field.setText).toHaveBeenLastCalledWith('body');
    expect(page.field.restoreScrollPosition).toHaveBeenLastCalledWith('results');
    expect(page.list.scrollToOffset).not.toHaveBeenCalled();
    expect(page.field.focus).not.toHaveBeenCalled();
    await page.close();
  });
  it('clears for Settings, another Folder, an external Reader or the Reading Button, rather than retaining any Reader navigation', async () => {
    for (const destination of ['Settings', 'Folder', 'Reader']) {
      const page = await open();
      await page.focus(); await page.type('body');
      await page.leave(destination);
      expect(page.search).toMatchObject({ active: false, query: '' });
      await page.return();
      expect(page.search.active).toBe(false);
      await page.close();
    }
  });
  it('ends a retained search if navigation moves beyond the result Reader while the Library remains blurred', async () => {
    const page = await open();
    await page.focus(); await page.type('body'); page.search.openingResult(document);
    await page.leave('Reader'); await page.leave('Settings');
    expect(page.search).toMatchObject({ active: false, query: '' });
    await page.close();
  });
  it('selection removes native search and blocks stale menu activation without clearing selection', async () => {
    const page = await open();
    await page.block(true);
    expect(page.options).toBeUndefined();
    await act(async () => page.search.start());
    expect(page.field.focus).not.toHaveBeenCalled();
    expect(page.search.active).toBe(false);
    await page.block(false);
    expect(page.options?.hideWhenScrolling).toBe(true);
    await page.close();
  });
  it('a new page mount has no restored query or search history', async () => {
    const old = await open(); await old.focus(); await old.type('private phrase'); await old.close();
    const fresh = await open();
    expect(fresh.search).toMatchObject({ active: false, query: '' });
    expect(fresh.field.focus).not.toHaveBeenCalled();
    await fresh.close();
  });
});
