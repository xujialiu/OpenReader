import { createContext, createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawer } from '../../src/app/drawer';
import { drawerDetentHeight } from '../../src/app/drawer-height';

const screen = vi.hoisted(() => ({ width: 820, height: 1180, fontScale: 1, scale: 2 }));
const platform = vi.hoisted(() => ({ OS: 'ios', isPad: true, isMacCatalyst: false, constants: { interfaceIdiom: 'pad' } }));
const safeArea = vi.hoisted(() => ({ top: 24, bottom: 20, left: 0, right: 0 }));
const settings = vi.hoisted(() => ({ drawerHeight: 50 }));
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  FlatList: 'FlatList', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  useWindowDimensions: () => screen,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => safeArea }));
vi.mock('@expo/ui/swift-ui', () => ({ BottomSheet: 'BottomSheet', Group: 'Group', Host: 'Host', RNHostView: 'RNHostView' }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({
  environment: () => ({}), ignoreSafeArea: () => ({}), presentationBackground: () => ({}), presentationDragIndicator: () => ({}),
  frame: (value: unknown) => ({ frame: value }),
  presentationSizing: (sizing: unknown, options: unknown) => ({ sizing, options }),
  interactiveDismissDisabled: (disabled: boolean) => ({ interactiveDismissDisabled: disabled }),
  presentationBackgroundInteraction: (interaction: unknown) => ({ interaction }),
  presentationDetents: (detents: unknown, options: unknown) => ({ detents, options }),
}));
vi.mock('../../src/app/controls', () => ({
  ChoiceMenu: 'ChoiceMenu', RowWords: 'RowWords', Footnote: 'Footnote', INK: {}, PALETTE: { light: { line: '#000' }, dark: { line: '#000' } },
  SchemeContext: createContext('light'), SETTINGS_SURFACE: { light: { page: '#fff', card: '#fff' }, dark: { page: '#000', card: '#000' } },
  useAccent: () => ({ onMark: '#000', reading: '#000' }),
}));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ settings }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let mounted: ReactTestRenderer | undefined;
function view() {
  if (!mounted) throw new Error('Drawer is not mounted');
  return mounted;
}
afterEach(async () => { const current = mounted; if (current) await act(async () => current.unmount()); mounted = undefined; });
beforeEach(() => {
  Object.assign(platform, { isPad: true, isMacCatalyst: false, constants: { interfaceIdiom: 'pad' } });
  Object.assign(screen, { width: 820, height: 1180 });
  Object.assign(safeArea, { top: 24, bottom: 20, left: 0, right: 0 });
  settings.drawerHeight = 50;
});

async function drawer(extra = {}) {
  const close = vi.fn();
  const props = { visible: true, title: 'Appearance', onClose: close, children: null, ...extra };
  await act(async () => { mounted = create(createElement(Drawer, props)); });
  const modifiers = () => view().root.findAll((node) => String(node.type) === 'Group')[0].props.modifiers;
  return {
    close,
    modifiers,
    detents: () => modifiers().find((m: Record<string, unknown>) => m.detents),
    interaction: () => modifiers().find((m: Record<string, unknown>) => m.interaction).interaction,
    frame: () => modifiers().find((m: Record<string, unknown>) => m.frame)?.frame,
    sizing: () => modifiers().find((m: Record<string, unknown>) => m.sizing),
    dismissalGuard: () => modifiers().find((m: Record<string, unknown>) => 'interactiveDismissDisabled' in m)?.interactiveDismissDisabled,
    closers: () => view().root.findAll((node) => String(node.type) === 'Pressable' && /^Close /.test(node.props.accessibilityLabel ?? '')),
    update: async (next = {}) => { Object.assign(props, next); await act(async () => view().update(createElement(Drawer, props))); },
  };
}

// These check the real shared boundary's requests and React lifetime, not
// UIKit geometry. #361's native placement/input loop is a separate gate.
describe('the window-relative native tablet/Mac Drawer contract (#361)', () => {
  it('requests fitted window-relative geometry, an undimmed opening height and no close button', async () => {
    const d = await drawer();
    expect(d.detents().detents).toEqual([{ height: 590 }, 'large']);
    expect(d.interaction()).toEqual({ type: 'enabledUpThrough', detent: { height: 590 } });
    expect(d.frame()).toEqual({ idealWidth: 580, idealHeight: 1180 });
    expect(d.sizing()).toEqual({ sizing: 'fitted', options: { fitted: { horizontal: true, vertical: true } } });
    expect(d.closers()).toHaveLength(0);
    expect(d.dismissalGuard()).toBe(false);
    Object.assign(screen, { width: 390, height: 600 });
    await d.update();
    expect(d.detents().options.selection).toEqual({ height: 300 });
    expect(d.frame()).toEqual({ idealWidth: 390, idealHeight: 600 });
    expect(d.closers()).toHaveLength(0);
  });

  it('requests each chosen height from the app window, not the internal form', async () => {
    const d = await drawer();
    for (const percent of [40, 50, 60, 70, 80, 90]) {
      settings.drawerHeight = percent;
      await d.update();
      expect(d.detents().detents[0]).toEqual({ height: 1180 * percent / 100 });
    }
  });

  it('keeps a dismissal guard in the modifier chain from the first presentation', async () => {
    const d = await drawer();
    const count = d.modifiers().length;
    expect(d.dismissalGuard()).toBe(false);
    await act(async () => d.detents().options.onSelectionChange('large'));
    expect(d.dismissalGuard()).toBe(true);
    expect(d.modifiers()).toHaveLength(count);
    await act(async () => d.detents().options.onSelectionChange({ height: 590 }));
    expect(d.dismissalGuard()).toBe(false);
    expect(d.modifiers()).toHaveLength(count);
  });

  it('accepts native contraction without closing the Drawer or keeping the guard enabled', async () => {
    const d = await drawer();
    await act(async () => d.detents().options.onSelectionChange('large'));
    await act(async () => d.detents().options.onSelectionChange({ height: 590 }));
    expect(d.detents().options.selection).toEqual({ height: 590 });
    expect(d.dismissalGuard()).toBe(false);
    expect(d.close).not.toHaveBeenCalled();
  });

  it('keeps expanded through rotation, then opens at the chosen height next time', async () => {
    const d = await drawer({ onBack: vi.fn(), action: { label: 'Select all', onPress: vi.fn() } });
    await act(async () => d.detents().options.onSelectionChange('large'));
    Object.assign(screen, { width: 1180, height: 820 });
    await d.update();
    expect(d.detents().options.selection).toBe('large');
    expect(d.interaction()).toEqual({ type: 'enabledUpThrough', detent: { height: 410 } });
    expect(d.frame()).toEqual({ idealWidth: 580, idealHeight: 820 });
    expect(d.closers()).toHaveLength(0);
    await d.update({ visible: false });
    const sheet = view().root.findAll((node) => String(node.type) === 'BottomSheet')[0];
    await act(async () => sheet.props.onDismiss());
    settings.drawerHeight = 60;
    await d.update({ visible: true });
    expect(d.detents().options.selection).toEqual({ height: 492 });
    expect(d.dismissalGuard()).toBe(false);
  });

  it('keeps its content mounted through size and height-state changes', async () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Content() {
      useEffect(() => { mount(); return unmount; }, []);
      return createElement('NativeList');
    }
    const d = await drawer({ children: createElement(Content) });
    Object.assign(screen, { width: 390, height: 600 });
    await d.update();
    await act(async () => d.detents().options.onSelectionChange('large'));
    expect(mount).toHaveBeenCalledOnce();
    expect(unmount).not.toHaveBeenCalled();
  });

  it('keeps the measured phone geometry and modifier policy unchanged', async () => {
    Object.assign(platform, { isPad: false, constants: { interfaceIdiom: 'phone' } });
    Object.assign(screen, { width: 402, height: 874 });
    const d = await drawer();
    const height = drawerDetentHeight(50, { width: 402, height: 874, bottomInset: 20 });
    expect(d.detents()).toEqual({ detents: [{ height }, 'large'], options: undefined });
    expect(d.frame()).toBeUndefined();
    expect(d.sizing()).toBeUndefined();
    expect(d.dismissalGuard()).toBeUndefined();
    expect(d.closers()).toHaveLength(0);
  });

  it('removes the Mac cross without removing Share', async () => {
    Object.assign(platform, { isPad: false, constants: { interfaceIdiom: 'mac' } });
    const share = vi.fn();
    const d = await drawer({ titleLeft: true, action: { icon: 'share', label: 'Share', onPress: share } });
    expect(d.closers()).toHaveLength(0);
    const button = view().root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Share')[0];
    await act(async () => button.props.onPress());
    expect(share).toHaveBeenCalledOnce();
  });

  it('keeps Back and the page action without any close control', async () => {
    const back = vi.fn();
    const action = vi.fn();
    const d = await drawer({ onBack: back, action: { label: 'Select all', onPress: action } });
    expect(d.closers()).toHaveLength(0);
    const buttons = view().root.findAll((node) => String(node.type) === 'Pressable');
    await act(async () => buttons.find((node) => node.props.accessibilityLabel === 'Back from Appearance')?.props.onPress());
    const pageAction = buttons.find((node) => node.findAll((child) => String(child.type) === 'Text' && child.props.children === 'Select all').length > 0);
    if (!pageAction) throw new Error('Select all action is missing');
    await act(async () => pageAction.props.onPress());
    expect(back).toHaveBeenCalledOnce();
    expect(action).toHaveBeenCalledOnce();
  });
});
