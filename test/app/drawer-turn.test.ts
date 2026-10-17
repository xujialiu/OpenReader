import { createContext, createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';

import { useDrawerTurn } from '../../src/app/drawer';

/**
 * `useDrawerTurn` over the real one-at-a-time queue (#117, ADR 0066), as the
 * Drawers' screens hold it: a `visible` state each, the hook, and the native
 * `onDismiss` called by hand. `drawer-turns.test.ts` drives the queue alone;
 * this is the hook's half, which is where #213 was: a Drawer asked for again
 * while it was still sliding away never reported its dismissal to the queue.
 */
vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1, absoluteFill: {} },
  FlatList: 'FlatList', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }) }));
vi.mock('@expo/ui/swift-ui', () => ({ BottomSheet: 'BottomSheet', Group: 'Group', Host: 'Host', RNHostView: 'RNHostView' }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({
  environment: () => ({}), ignoreSafeArea: () => ({}), presentationBackground: () => ({}), presentationBackgroundInteraction: () => ({}),
  presentationDetents: () => ({}), presentationDragIndicator: () => ({}),
}));
vi.mock('../../src/app/controls', () => ({
  ChoiceMenu: 'ChoiceMenu', RowWords: 'RowWords', Footnote: 'Footnote', INK: {}, PALETTE: { light: { line: '#000' }, dark: { line: '#000' } },
  SchemeContext: createContext('light'), SETTINGS_SURFACE: { light: { page: '#fff', card: '#fff' }, dark: { page: '#000', card: '#000' } },
  useAccent: () => ({ onMark: '#000', reading: '#000' }),
}));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ settings: { drawerHeight: 50 } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });


// The app has one queue of drawers, so each test unmounts its drawers, failed or not, and the next starts with nothing up.
const mounted: ReactTestRenderer[] = [];
afterEach(async () => { for (const one of mounted.splice(0)) await act(async () => one.unmount()); });

function harness() {
  const state: Record<string, boolean> = {};
  const turns: Record<string, ReturnType<typeof useDrawerTurn>> = {};
  let renderer!: ReactTestRenderer;
  const names: string[] = [];
  function One({ name }: { name: string }) {
    turns[name] = useDrawerTurn(state[name] ?? false, () => { state[name] = false; rerender(); });
    return null;
  }
  function All() { return createElement('Group', null, ...names.map((name) => createElement(One, { key: name, name }))); }
  const rerender = () => renderer.update(createElement(All));
  return {
    mount: async (...all: string[]) => { names.push(...all); await act(async () => { renderer = create(createElement(All)); }); mounted.push(renderer); },
    set: async (name: string, visible: boolean) => { state[name] = visible; await act(async () => { rerender(); }); },
    /** The native dismissal finished: BottomSheet's `onDismiss`. */
    dismissed: async (name: string) => { await act(async () => { turns[name].dismissed(); }); },
    presented: (name: string) => turns[name].presented,
    visible: (name: string) => state[name] ?? false,
  };
}

it('presents a drawer asked for again while it is still sliding away, once that dismissal ends (#213)', async () => {
  const h = harness();
  await h.mount('add');
  await h.set('add', true);
  await h.set('add', false); // a row calls onClose: the drawer starts down
  await h.set('add', true); // its button pressed again within the slide
  expect(h.presented('add')).toBe(false); // not over the one still going down
  await h.dismissed('add');
  expect(h.visible('add')).toBe(true);
  expect(h.presented('add')).toBe(true);
});

it('does the same when another drawer closed it: A up, B asked for, A asked for again within the slide (#213)', async () => {
  const h = harness();
  await h.mount('a', 'b');
  await h.set('a', true);
  await h.set('b', true); // the queue calls A's onClose for B
  expect(h.visible('a')).toBe(false);
  await h.set('a', true); // A's button within the slide: the queue calls B's onClose for A
  expect(h.visible('b')).toBe(false);
  await h.dismissed('a');
  expect(h.visible('a')).toBe(true);
  expect(h.presented('a')).toBe(true);
});

it('keeps a drawer presented when iOS reports the same dismissal twice after it came back up', async () => {
  const h = harness();
  await h.mount('add');
  await h.set('add', true);
  await h.set('add', false);
  await h.set('add', true);
  await h.dismissed('add');
  await h.dismissed('add'); // the double report (notes, 2026-10-01 13:41)
  expect(h.presented('add')).toBe(true);
});

it('brings up a different drawer asked for afterwards, and the first opens again after it', async () => {
  const h = harness();
  await h.mount('add', 'actions');
  await h.set('add', true);
  await h.set('add', false);
  await h.dismissed('add');
  await h.set('actions', true);
  expect(h.presented('actions')).toBe(true);
  await h.set('actions', false);
  await h.dismissed('actions');
  await h.set('add', true);
  expect(h.presented('add')).toBe(true);
});

it('presents a drawer asked for once its dismissal has ended', async () => {
  const h = harness();
  await h.mount('add');
  await h.set('add', true);
  await h.set('add', false);
  await h.dismissed('add');
  await h.set('add', true);
  expect(h.presented('add')).toBe(true);
});

it('takes the swipe order: dismissed, then onClose, then another drawer asks', async () => {
  const h = harness();
  await h.mount('add', 'actions');
  await h.set('add', true);
  await h.dismissed('add');
  expect(h.presented('add')).toBe(true); // still wanted until its owner closes it
  await h.set('add', false);
  await h.set('actions', true);
  expect(h.presented('actions')).toBe(true);
});
