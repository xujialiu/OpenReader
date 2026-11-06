import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { ReaderTitle, TITLE_SIDE } from '../../src/app/reader-title';

const window = vi.hoisted(() => ({ width: 466, fontScale: 1 }));
const insets = vi.hoisted(() => ({ top: 0, left: 0, right: 0, bottom: 34 }));
vi.mock('react-native', () => ({ View: 'View', StyleSheet: { create: <T,>(styles: T) => styles }, useWindowDimensions: () => window }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => insets }));
vi.mock('../../src/app/controls', () => ({ INK: { text: 'ink' } }));
vi.mock('../../src/app/name-text', () => ({ NameText: 'NameText' }));
vi.mock('../../src/app/text-styles', () => ({ barTitle: () => ({ fontSize: 17 }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('the reader title fits beside a system side bar (#346)', () => {
  it.each([[0, 84], [84, 0], [20, 44], [0, 0]])('uses left=%s right=%s without changing type size', async (left, right) => {
    Object.assign(insets, { left, right });
    let view!: ReactTestRenderer;
    await act(async () => { view = create(createElement(ReaderTitle, { title: 'A long Document name for a narrow reading window' })); });
    try {
      const title = view.root.find((node) => String(node.type) === 'NameText');
      const room = 466 - left - right - 2 * TITLE_SIDE;
      expect(title.props.width).toBe(room);
      expect(Object.assign({}, ...title.props.style)).toMatchObject({ maxWidth: room, fontSize: 17 });
      expect(title.props.lines).toBe(2);
    } finally { await act(async () => view.unmount()); }
  });
});
