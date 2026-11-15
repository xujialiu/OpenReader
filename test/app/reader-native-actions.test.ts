import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { ReaderScreen } from '../../src/app/reader-screen';

const held = vi.hoisted(() => ({ current: { id: 'book', chrome: true, opened: true }, show: vi.fn(), left: vi.fn(), setBarHeight: vi.fn() }));
vi.mock('../../modules/open-reader-window', () => ({ WindowTraitsObserver: 'WindowTraitsObserver' }));
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles }, Text: 'Text', View: 'View' }));
vi.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 82 }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 84 }) }));
vi.mock('react-native-teleport', () => ({ PortalHost: 'PortalHost' }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({
  settings: {}, setSettings: vi.fn(), library: { entries: [{ id: 'book', title: 'A Document' }] },
}) }));
vi.mock('../../src/app/reading-host', () => ({ useHeldReading: () => held, readerSlot: (id: string) => id }));
vi.mock('../../src/app/appearance-sheet', () => ({ AppearanceSheet: 'AppearanceSheet' }));
vi.mock('../../src/app/reader-actions', () => ({ ReaderActions: 'ReaderActions' }));
vi.mock('../../src/app/reader-title', () => ({ ReaderTitle: 'ReaderTitle' }));
vi.mock('../../src/app/controls', () => ({ HeaderButton: 'HeaderButton', Note: 'Note', INK: {} }));
vi.mock('../../src/app/walkthrough-harness', () => ({ useHarnessCommands: () => {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const ofType = (name: string) => (node: ReactTestInstance) => String(node.type) === name;

describe('More actions participates in the native bar arrangement (#362)', () => {
  it('registers a native ellipsis item and opens the same actions Drawer', async () => {
    const setOptions = vi.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(createElement(ReaderScreen, {
        route: { params: { id: 'book' } }, navigation: { setOptions },
      } as never));
    });
    try {
      const options = setOptions.mock.calls.map(([value]) => value).find((value) => value.title === 'A Document');
      expect(options.unstable_headerRightItems).toBeTypeOf('function');
      const items = options.unstable_headerRightItems({});
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'button', label: 'More actions', accessibilityLabel: 'More actions',
        icon: { type: 'sfSymbol', name: 'ellipsis' },
      });
      expect(view.root.findAll(ofType('ReaderActions'))).toHaveLength(0);
      await act(async () => items[0].onPress());
      expect(view.root.findAll(ofType('ReaderActions'))).toHaveLength(1);
      await act(async () => view.root.find(ofType('ReaderActions')).props.onClose());
      expect(view.root.findAll(ofType('ReaderActions'))).toHaveLength(0);
      // The non-iOS fallback remains wired to that same action.
      expect(options.headerRight().props.accessibilityLabel ?? options.headerRight().props.label).toBe('More actions');
    } finally {
      await act(async () => view.unmount());
    }
  });

  it('uses a measured top title only for the reported native vertical bar, without resizing the reader slot', async () => {
    const setOptions = vi.fn();
    const props = { route: { params: { id: 'book' } }, navigation: { setOptions } };
    let view!: ReactTestRenderer;
    held.current.chrome = true;
    await act(async () => { view = create(createElement(ReaderScreen, props as never)); });
    try {
      const header = () => setOptions.mock.calls.map(([value]) => value).filter((value) => value.title === 'A Document').at(-1);
      expect(header().headerTitle()).toMatchObject({ type: 'ReaderTitle' });
      const slot = view.root.find(ofType('PortalHost'));
      const observer = view.root.find(ofType('WindowTraitsObserver'));
      await act(async () => observer.props.onVerticalBarChange({ nativeEvent: { edge: 'trailing' } }));
      expect(header().headerTitle).toBe('');
      expect(header().headerStyle).toEqual({ backgroundColor: 'transparent' });
      const overlay = view.root.findByProps({ testID: 'ReaderTitleOverlay' });
      expect(Object.assign({}, ...overlay.props.style)).toMatchObject({ top: 0, left: 0, right: 84, paddingVertical: 8, opacity: 1 });
      expect(overlay.find(ofType('ReaderTitle')).props.reserveButtons).toBe(false);
      await act(async () => overlay.props.onLayout({ nativeEvent: { layout: { height: 37 } } }));
      expect(held.setBarHeight).toHaveBeenLastCalledWith(37);
      held.current.chrome = false;
      await act(async () => view.update(createElement(ReaderScreen, props as never)));
      expect(Object.assign({}, ...view.root.findByProps({ testID: 'ReaderTitleOverlay' }).props.style).opacity).toBe(0);
      expect(view.root.find(ofType('PortalHost'))).toBe(slot);
      expect(held.setBarHeight).toHaveBeenLastCalledWith(37);
      await act(async () => observer.props.onVerticalBarChange({ nativeEvent: { edge: 'none' } }));
      expect(header().headerTitle()).toMatchObject({ type: 'ReaderTitle' });
      expect(view.root.findAllByProps({ testID: 'ReaderTitleOverlay' })).toHaveLength(0);
      expect(header().headerStyle).toBeUndefined();
      expect(view.root.find(ofType('PortalHost'))).toBe(slot);
    } finally {
      held.current.chrome = true;
      await act(async () => view.unmount());
    }
  });
});
