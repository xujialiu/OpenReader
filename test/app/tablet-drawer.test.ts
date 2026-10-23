import { createContext, createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawer } from '../../src/app/drawer';
import { drawerDetentHeight } from '../../src/app/drawer-height';

const screen = vi.hoisted(() => ({ width: 1024, height: 768, fontScale: 1, scale: 2 }));
const platform = vi.hoisted(() => ({ OS: 'ios', isPad: true, isMacCatalyst: false, constants: { interfaceIdiom: 'pad' } }));
const settings = vi.hoisted(() => ({ drawerHeight: 50 }));
vi.mock('react-native', () => ({
  Platform: platform,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  FlatList: 'FlatList', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  useWindowDimensions: () => screen,
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }) }));
vi.mock('@expo/ui/swift-ui', () => ({ BottomSheet: 'BottomSheet', Group: 'Group', Host: 'Host', RNHostView: 'RNHostView' }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({
  environment: () => ({}), ignoreSafeArea: () => ({}), presentationBackground: () => ({}), presentationDragIndicator: () => ({}),
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
  Object.assign(screen, { width: 1024, height: 768 });
  settings.drawerHeight = 50;
});

async function drawer(extra = {}) {
  const close = vi.fn();
  const props = { visible: true, title: 'Appearance', onClose: close, children: null, ...extra };
  await act(async () => { mounted = create(createElement(Drawer, props)); });
  const modifiers = () => view().root.findAll((node) => String(node.type) === 'Group')[0].props.modifiers;
  return {
    close,
    detents: () => modifiers().find((m: Record<string, unknown>) => m.detents),
    interaction: () => modifiers().find((m: Record<string, unknown>) => m.interaction).interaction,
    closers: () => view().root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Close Appearance'),
    update: async (next = {}) => { Object.assign(props, next); await act(async () => view().update(createElement(Drawer, props))); },
  };
}

describe('the system tablet/Mac Drawer contract (#319)', () => {
  it('uses a stable native fraction, an undimmed opening height, and a reachable close control', async () => {
    const d = await drawer();
    expect(d.detents().detents).toEqual([{ fraction: 0.5 }, 'large']);
    expect(d.interaction()).toEqual({ type: 'enabledUpThrough', detent: { fraction: 0.5 } });
    expect(d.closers()).toHaveLength(1);
    await act(async () => d.closers()[0].props.onPress());
    expect(d.close).toHaveBeenCalledOnce();
    Object.assign(screen, { width: 390, height: 600 });
    await d.update();
    expect(d.detents().options.selection).toEqual({ fraction: 0.5 });
    expect(d.closers()).toHaveLength(1);
  });

  it('keeps an expanded panel expanded through rotation, then opens at the chosen height next time', async () => {
    const d = await drawer({ onBack: vi.fn(), action: { label: 'Select all', onPress: vi.fn() } });
    await act(async () => d.detents().options.onSelectionChange('large'));
    Object.assign(screen, { width: 768, height: 1024 });
    await d.update();
    expect(d.detents().options.selection).toBe('large');
    expect(d.closers()).toHaveLength(1);
    await d.update({ visible: false });
    const sheet = view().root.findAll((node) => String(node.type) === 'BottomSheet')[0];
    await act(async () => sheet.props.onDismiss());
    settings.drawerHeight = 60;
    await d.update({ visible: true });
    expect(d.detents().options.selection).toEqual({ fraction: 0.6 });
  });

  it('keeps the measured phone height and swipe-only header unchanged', async () => {
    Object.assign(platform, { isPad: false, constants: { interfaceIdiom: 'phone' } });
    Object.assign(screen, { width: 402, height: 874 });
    const d = await drawer();
    const height = drawerDetentHeight(50, { width: 402, height: 874, bottomInset: 20 });
    expect(d.detents()).toEqual({ detents: [{ height }, 'large'], options: undefined });
    expect(d.closers()).toHaveLength(0);
  });

  it('also provides a close control for Mac idiom, not just isPad', async () => {
    Object.assign(platform, { isPad: false, constants: { interfaceIdiom: 'mac' } });
    const d = await drawer({ titleLeft: true, action: { icon: 'share', label: 'Share', onPress: vi.fn() } });
    expect(d.closers()).toHaveLength(1);
  });
});
