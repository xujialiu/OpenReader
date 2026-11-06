import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '../../src/app/controls';

const insets = vi.hoisted(() => ({ top: 0, bottom: 34, left: 0, right: 0 }));
vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }, DynamicColorIOS: (colours: { light: string }) => colours.light,
  StyleSheet: { create: <T,>(styles: T) => styles }, ScrollView: 'ScrollView',
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => insets }));
vi.mock('@expo/ui/swift-ui', () => ({}));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({}));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/name-text', () => ({ NameText: 'NameText' }));
vi.mock('../../src/app/folder-artwork', () => ({ FolderArtwork: 'FolderArtwork' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('Settings stays inside the usable horizontal window (#346)', () => {
  it('updates side space without remounting its content or changing keyboard policy', async () => {
    let view!: ReactTestRenderer;
    Object.assign(insets, { left: 0, right: 0 });
    const page = () => createElement(SettingsPage, null, createElement('FieldProbe'));
    await act(async () => { view = create(page()); });
    try {
      const field = view.root.find((node) => String(node.type) === 'FieldProbe');
      for (const [left, right] of [[0, 84], [84, 0], [20, 44], [0, 0]]) {
        Object.assign(insets, { left, right });
        await act(async () => view.update(page()));
        const scroll = view.root.find((node) => String(node.type) === 'ScrollView');
        expect(Object.assign({}, ...[scroll.props.style].flat(Infinity))).toMatchObject({ marginLeft: left, marginRight: right });
        expect(scroll.props).toMatchObject({ keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'interactive', automaticallyAdjustKeyboardInsets: true });
        expect(scroll.props.contentContainerStyle).toMatchObject({ maxWidth: 680, paddingHorizontal: 20 });
        expect(view.root.find((node) => String(node.type) === 'FieldProbe')).toBe(field);
      }
    } finally { await act(async () => view.unmount()); }
  });
});
