import { createElement, type ReactNode, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceSheet } from '../../src/app/appearance-sheet';
import { type Appearance, DEFAULT_APPEARANCE } from '../../src/renderer/highlighter';

vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock('../../src/app/controls', () => ({ INK: {}, useAccent: () => ({ reading: 'blue' }) }));
vi.mock('../../src/app/drawer', () => ({
  Drawer: ({ children }: { children: ReactNode }) => children,
  DrawerScroll: 'Scroll', DrawerRowText: 'Label', DrawerRowValue: 'Value', DrawerChevron: 'Chevron', DrawerMenuRow: 'Menu',
  DrawerRow: ({ children, accessory }: { children: ReactNode; accessory: ReactNode }) => createElement('Row', null, children, accessory),
  useDrawerColours: () => ({ button: 'grey' }),
}));
vi.mock('../../src/app/drawer-list', () => ({ drawerRowText: () => ({}) }));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/highlight-section', () => ({ HighlightPage: 'HighlightPage' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function panel(initial = 5) {
  const values: number[] = [];
  let tree!: ReactTestRenderer;
  function Screen({ visible }: { visible: boolean }) {
    const [appearance, setAppearance] = useState<Appearance>({ ...DEFAULT_APPEARANCE, margins: initial });
    return createElement(AppearanceSheet, { visible, document: 'Book', onClose() {}, appearance,
      onChange: (next: Appearance) => { values.push(next.margins); setAppearance(next); } });
  }
  await act(async () => { tree = create(createElement(Screen, { visible: true })); });
  return {
    values,
    button: (label = 'Increase margins') => tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)[0],
    text: () => tree.root.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children),
    event: async (name: string, label = 'Increase margins') => {
      await act(async () => {
        const p = tree.root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label)[0].props;
        p[name]?.();
      });
    },
    wait: async (ms: number) => {
      // Commit every repeat just as the native UI does between timer callbacks.
      for (let elapsed = 0; elapsed < ms; elapsed += 25) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(25, ms - elapsed)); });
    },
    hide: async () => act(async () => tree.update(createElement(Screen, { visible: false }))),
    unmount: async () => act(async () => tree.unmount()),
  };
}

describe('Margins taps and held buttons (#344)', () => {
  it('shows percent, taps exactly once, and does not add hold behavior to Font Size', async () => {
    const p = await panel();
    try {
      expect(p.text()).toContain('5%');
      await p.event('onPressIn'); await p.wait(100); await p.event('onPressOut'); await p.event('onPress');
      expect(p.values).toEqual([6]);
      await p.event('onPressIn', 'Increase font size'); await p.wait(1800); await p.event('onPressOut', 'Increase font size');
      expect(p.values).toEqual([6]);
    } finally { await p.unmount(); }
  });
  it('accelerates repeat frequency while keeping every step at one and stops without a release step', async () => {
    const p = await panel(0);
    try {
      await p.event('onPressIn');
      await p.wait(1000);
      const slow = p.values.length;
      expect(slow).toBeGreaterThan(0);
      await p.wait(1000);
      expect(p.values.length - slow).toBeGreaterThan(slow);
      expect(p.values).toEqual(Array.from({ length: p.values.length }, (_, i) => i + 1));
      await p.event('onPressOut');
      const count = p.values.length;
      await p.event('onPress'); await p.wait(2000);
      expect(p.values).toHaveLength(count);
    } finally { await p.unmount(); }
  });
  it.each([0, 25])('stops at endpoint %i and disables only the outward button', async (initial) => {
    const p = await panel(initial === 0 ? 1 : 24);
    const direction = initial === 0 ? 'Decrease margins' : 'Increase margins';
    try {
      await p.event('onPressIn', direction); await p.wait(1000);
      expect(p.values).toEqual([initial]);
      expect(p.button(direction).props.disabled).toBe(true);
      expect(p.button(initial === 0 ? 'Increase margins' : 'Decrease margins').props.disabled).toBe(false);
      await p.event('onPressOut', direction); await p.event('onPress', direction); await p.wait(1000);
      expect(p.values).toEqual([initial]);
    } finally { await p.unmount(); }
  });
  it('cancels before the first repeat without changing a value', async () => {
    const p = await panel();
    try {
      await p.event('onPressIn'); await p.wait(100); await p.event('onPressOut'); await p.wait(1500);
      expect(p.values).toEqual([]);
    } finally { await p.unmount(); }
  });
  it.each(['hide', 'unmount'] as const)('stops repeating on %s even without a release event', async (end) => {
    const p = await panel();
    await p.event('onPressIn'); await p.wait(600);
    expect(p.values.length).toBeGreaterThan(0);
    await p[end]();
    const count = p.values.length;
    await p.wait(2500);
    expect(p.values).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
    if (end === 'hide') await p.unmount();
  });
});
