import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player, type PlayerProps } from '../../src/app/player';
import { DEFAULT_SETTINGS } from '../../src/app/settings';

const dimensions = vi.hoisted(() => ({ width: 390, height: 844, fontScale: 1, scale: 3 }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5, absoluteFill: {} },
  useWindowDimensions: () => dimensions,
}));
vi.mock('@expo/ui/swift-ui', () => {
  const host = (name: string) => function Native({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) {
    return createElement(name, props, children);
  };
  return { Host: host('Host'), RNHostView: host('RNHostView'),
    Popover: Object.assign(host('Popover'), { Trigger: host('Trigger'), Content: host('Content') }) };
});
vi.mock('../../src/playback', () => import('../../src/playback/rate'));
vi.mock('../../src/app/controls', () => ({
  INK: {}, useBorders: () => ({ line: 'grey' }), useAccent: () => ({ following: 'orange' }),
}));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/loading-spinner', () => ({ LoadingSpinner: 'LoadingSpinner' }));
vi.mock('../../src/app/reading-button', () => ({ ReadingButton: 'ReadingButton', READING_BUTTON_PLACE: {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => Object.assign(dimensions, { width: 390, height: 844, fontScale: 1 }));

async function player() {
  const props: PlayerProps = {
    settings: DEFAULT_SETTINGS, playing: false, collapsed: false, enabled: true,
    voiceInUse: null, notes: [], following: true,
    onCollapsed: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onSkip: vi.fn(), onRate: vi.fn(),
    onContents: vi.fn(), onVoices: vi.fn(), onReturn: vi.fn(), onHeight: vi.fn(), onOpenHeight: vi.fn(),
  };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Player, props)); });
  const bubble = () => view.root.findAll((node) => String(node.type) === 'Popover')[0];
  return {
    open: () => bubble().props.isPresented,
    toggle: () => act(async () => view.root.findAll((node) => String(node.type) === 'Pressable' &&
      String(node.props.accessibilityLabel).startsWith('Playback speed,'))[0].props.onPress()),
    dismiss: () => act(async () => bubble().props.onIsPresentedChange(false)),
    update: (next: Partial<typeof dimensions>) => act(async () => {
      Object.assign(dimensions, next);
      view.update(createElement(Player, { ...props }));
    }),
    unmount: () => act(async () => view.unmount()),
  };
}

describe('player speed popover geometry (#124)', () => {
  it('opens, stays open on unchanged dimensions, and closes via the native dismissal', async () => {
    const p = await player();
    expect(p.open()).toBe(false);
    await p.toggle();
    expect(p.open()).toBe(true);
    await p.update({});
    expect(p.open()).toBe(true);
    await p.dismiss();
    expect(p.open()).toBe(false);
    await p.toggle();
    expect(p.open()).toBe(true);
    await p.toggle();
    expect(p.open()).toBe(false);
    await p.unmount();
  });
  it.each([{ fontScale: 2 }, { width: 320 }])('closes on %j, stays closed on returning, and can reopen', async (next) => {
    const p = await player();
    await p.toggle();
    await p.update(next);
    expect(p.open()).toBe(false);
    await p.update({ width: 390, fontScale: 1 });
    expect(p.open()).toBe(false);
    await p.toggle();
    expect(p.open()).toBe(true);
    await p.unmount();
  });
  it('does not dismiss for a height-only change', async () => {
    const p = await player();
    await p.toggle();
    await p.update({ height: 800 });
    expect(p.open()).toBe(true);
    await p.unmount();
  });
});
