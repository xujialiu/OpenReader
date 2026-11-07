import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Player, type PlayerProps } from '../../src/app/player';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { SleepTimerButton } from '../../src/app/sleep-timer-button';
import type { SleepTimerState } from '../../src/app/use-sleep-timer';

/**
 * The Player as a card (#325, #326): the Tap Lock beside A or M and the Sleep
 * Timer beside the collapse arrow in its head row, in both layouts; the card's
 * place; and the Sleep Timer's menu.
 */

const dimensions = vi.hoisted(() => ({ width: 402, height: 874, fontScale: 1, scale: 3 }));
const insets = vi.hoisted(() => ({ top: 0, right: 0, bottom: 34, left: 0 }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5, absoluteFill: {} },
  useWindowDimensions: () => dimensions,
}));
vi.mock('@expo/ui/swift-ui', () => {
  const host = (name: string) => function Native({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) {
    return createElement(name, props, children);
  };
  return {
    Host: host('Host'), Group: host('Group'), RNHostView: host('RNHostView'), Menu: ({ label, children, ...props }: Record<string, unknown> & { label?: ReactNode; children?: ReactNode }) => createElement('Menu', props, label, children), Toggle: host('Toggle'), Button: host('Button'), Divider: host('Divider'),
    Popover: Object.assign(host('Popover'), { Trigger: host('Trigger'), Content: host('Content') }),
  };
});
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(
  ['menuOrder', 'accessibilityElement', 'accessibilityLabel', 'accessibilityAddTraits', 'frame'].map((name) => [name, (value: unknown) => ({ name, value })]),
));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => insets }));
vi.mock('../../src/playback', () => import('../../src/playback/rate'));
vi.mock('../../src/app/controls', () => ({
  INK: { text: 'ink' }, useBorders: () => ({ line: 'grey' }), useAccent: () => ({ following: 'orange', reading: 'blue' }),
}));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/loading-spinner', () => ({ LoadingSpinner: 'LoadingSpinner' }));
vi.mock('../../src/app/reading-button', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/app/reading-button')>(), ReadingButton: 'ReadingButton',
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  Object.assign(dimensions, { width: 402, height: 874, fontScale: 1 });
  Object.assign(insets, { top: 0, right: 0, bottom: 34, left: 0 });
});

const OFF: SleepTimerState = { choice: null, left: 0, since: null, expired: false };

async function player(overrides: Partial<PlayerProps> = {}) {
  const props: PlayerProps = {
    settings: DEFAULT_SETTINGS, playing: false, collapsed: false, enabled: true,
    voiceInUse: null, notes: [], following: true, barHeight: 64,
    onCollapsed: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onSkip: vi.fn(), onRate: vi.fn(),
    onContents: vi.fn(), onVoices: vi.fn(), onReturn: vi.fn(), onHeight: vi.fn(), onOpenHeight: vi.fn(),
    tapLock: false, onTapLock: vi.fn(), sleep: OFF, chapterOffered: true, onSleep: vi.fn(),
    ...overrides,
  };
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Player, props)); });
  return { root: view.root, props, view };
}

const style = (node: ReactTestInstance) => Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean));
/** What a control is called, by its label or its component. */
const name = (node: ReactTestInstance) => String(node.props.accessibilityLabel ?? (typeof node.type === 'function' ? node.type.name : node.type));

/** The rows of controls, top to bottom, each as the names of what is in it, a side of the head row flattened. */
function rows(root: ReactTestInstance): string[][] {
  const controls = root.find((node) => String(node.type) === 'View' && style(node).flexShrink === 0
    && style(node).gap === 4 && typeof node.props.onLayout === 'function');
  // Include the standalone Voice row too, not just horizontal flex rows (#348).
  return controls.children.filter((child): child is ReactTestInstance => typeof child !== 'string')
    .map((row) => row.children.filter((child): child is ReactTestInstance => typeof child !== 'string')
      .flatMap((child) => (String(child.type) === 'View' && style(child).flexDirection === 'row'
        ? child.children.filter((inner): inner is ReactTestInstance => typeof inner !== 'string').map(name) : [name(child)])));
}

describe('the Player stays beside system controls (#346)', () => {
  it.each([[0, 84], [84, 0], [20, 44], [0, 0]])('uses the usable width and origin with left=%s right=%s', async (left, right) => {
    dimensions.width = 466;
    Object.assign(insets, { left, right });
    const { root, view } = await player();
    try {
      const room = root.find((node) => String(node.type) === 'View' && style(node).justifyContent === 'flex-end');
      expect(style(room)).toMatchObject({ left, right });
      const card = root.find((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function');
      // At usable382, give back only enough decorative clearance to fit the
      // seven controls and their gaps, including the doubled native border.
      expect(style(card).width).toBe(466 - left - right === 382 ? 367 : 466 - left - right - 24);
      expect(rows(root)).toHaveLength(2);
    } finally { await act(async () => view.unmount()); }
  });

  it('keeps the collapsed Reading Button inside the trailing safe area', async () => {
    insets.right = 84;
    const { root, view } = await player({ collapsed: true });
    try {
      const button = root.find((node) => String(node.type) === 'ReadingButton');
      if (!button.parent) throw new Error('The Reading Button has no placement container');
      expect(style(button.parent)).toMatchObject({ right: 100, bottom: 28 });
    } finally { await act(async () => view.unmount()); }
  });
});

describe('the head row (#325, after Speechify\'s card)', () => {
  it('keeps every direct entry point in two complete rows beside Duo system controls (#348)', async () => {
    dimensions.width = 466;
    insets.right = 84;
    const { root, view } = await player();
    try {
      const all = rows(root);
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(['FollowingMark', 'TapLockButton', 'View', 'SleepTimerButton', 'Collapse the player']);
      expect(all[1]).toEqual(['Contents', 'Transport', 'Transport', 'Transport', 'Transport', 'Transport', 'SpeedBubble']);
      expect(root.findAll((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Choose a Voice')).toHaveLength(1);
    } finally { await act(async () => view.unmount()); }
  });

  it('holds the Tap Lock beside A and the Sleep Timer beside the collapse arrow, over the transport, in two rows', async () => {
    const { root } = await player();
    const all = rows(root);
    expect(all.length).toBe(2);
    expect(all[0].map((one) => one.replace(/^Following the reading$/, 'A'))).toEqual(['FollowingMark', 'TapLockButton', 'View', 'SleepTimerButton', 'Collapse the player']);
    expect(all[1][0]).toBe('Contents');
  });

  it('adds only the Contents/speed row when the transport alone is crowded (#348)', async () => {
    dimensions.width = 375;
    const { root, view } = await player();
    try {
      const all = rows(root);
      expect(all).toHaveLength(3);
      expect(all[0]).toEqual(['FollowingMark', 'TapLockButton', 'View', 'SleepTimerButton', 'Collapse the player']);
      expect(all[1]).toEqual(['Transport', 'Transport', 'Transport', 'Transport', 'Transport']);
      expect(all[2]).toEqual(['Contents', 'SpeedBubble']);
    } finally { await act(async () => view.unmount()); }
  });

  it('lets the head sides wrap rather than overlap in a very narrow accessibility layout (#348)', async () => {
    Object.assign(dimensions, { width: 320, fontScale: 3.571 });
    const { root, view } = await player();
    try {
      const controls = root.find((node) => String(node.type) === 'View' && style(node).flexShrink === 0 && style(node).gap === 4);
      const head = controls.children.filter((child): child is ReactTestInstance => typeof child !== 'string')[0];
      expect(style(head).flexWrap).toBe('wrap');
      expect(root.findByType(SleepTimerButton).props).toMatchObject({ width: 69, height: 105 });
    } finally { await act(async () => view.unmount()); }
  });

  it('keeps them in the head row when the Voice name and Contents and the speed get rows of their own', async () => {
    Object.assign(dimensions, { width: 390, fontScale: 3 });
    const { root } = await player();
    const all = rows(root);
    expect(all[0]).toEqual(['FollowingMark', 'TapLockButton', 'SleepTimerButton', 'Collapse the player']);
    expect(all.at(-1)).toEqual(['Contents', 'SpeedBubble']);
    // The Tap Lock is its icon's width there, so both sides fit.
    expect(root.findByType(SleepTimerButton).props.width).toBeGreaterThan(44);
  });

  it('preserves direct controls and state through compact, three-row and accessibility layouts (#348)', async () => {
    Object.assign(dimensions, { width: 466 });
    insets.right = 84;
    const sleep: SleepTimerState = { choice: 30, left: 29 * 60_000 + 41_000, since: null, expired: false };
    const p = await player({ tapLock: true, sleep, following: false });
    try {
      for (const [width, fontScale, left, right, count] of [
        [466, 1, 0, 84, 2], [951, 1, 0, 84, 2], [459, 1, 0, 84, 3],
        [466, 3.571, 0, 84, 4], [466, 3.571, 84, 0, 4], [466, 1, 84, 0, 2],
      ]) {
        Object.assign(dimensions, { width, fontScale });
        Object.assign(insets, { left, right });
        await act(async () => p.view.update(createElement(Player, p.props)));
        expect(rows(p.root)).toHaveLength(count);
        expect(p.root.findByType(SleepTimerButton).props.sleep).toEqual(sleep);
        const labels = p.root.findAll((node) => String(node.type) === 'Pressable').map((node) => node.props.accessibilityLabel);
        expect(labels).toEqual(expect.arrayContaining(['Unlock Taps', 'Return to the reading', 'Choose a Voice', 'Play',
          'Previous paragraph', 'Previous sentence', 'Next sentence', 'Next paragraph', 'Contents', 'Collapse the player']));
        expect(labels.filter((label) => String(label).startsWith('Playback speed,'))).toHaveLength(1);
      }
      for (const callback of [p.props.onPlay, p.props.onPause, p.props.onSkip, p.props.onRate, p.props.onSleep, p.props.onTapLock, p.props.onCollapsed, p.props.onReturn]) {
        expect(callback).not.toHaveBeenCalled();
      }
    } finally { await act(async () => p.view.unmount()); }
  });

  it('keeps a long Voice label complete and scalable in the narrower head (#348)', async () => {
    Object.assign(dimensions, { width: 466 });
    insets.right = 84;
    const label = 'A very long Voice name — 中文 العربية — with its regional description';
    const p = await player({ settings: { ...DEFAULT_SETTINGS, voice: 'fixture-voice' }, voiceInUse: { label, locale: 'en' } });
    try {
      const voice = p.root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Choose a Voice');
      const text = voice.find((node) => String(node.type) === 'Text');
      expect(text.props.children).toBe(label);
      expect(text.props.numberOfLines).toBeUndefined();
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
      expect(Object.assign({}, ...voice.props.style({ pressed: false })).minHeight).toBeGreaterThanOrEqual(44);
    } finally { await act(async () => p.view.unmount()); }
  });

  it('forwards measured compact and taller control heights rather than a stale row-count estimate (#348)', async () => {
    dimensions.width = 466;
    insets.right = 84;
    const p = await player();
    try {
      const measured = () => p.root.findAll((node) => String(node.type) === 'View' && typeof node.props.onLayout === 'function');
      // Explicit native-layout doubles: these verify the public callbacks,
      // not Yoga's computed height or native Voice wrapping.
      const [card, controls] = measured();
      await act(async () => {
        card.props.onLayout({ nativeEvent: { layout: { height: 103 } } });
        controls.props.onLayout({ nativeEvent: { layout: { height: 88 } } });
      });
      expect(p.props.onHeight).toHaveBeenLastCalledWith(123);
      expect(p.props.onOpenHeight).toHaveBeenLastCalledWith(123);
      dimensions.fontScale = 3.571;
      await act(async () => p.view.update(createElement(Player, p.props)));
      await act(async () => measured()[1].props.onLayout({ nativeEvent: { layout: { height: 400 } } }));
      expect(p.props.onOpenHeight).toHaveBeenLastCalledWith(435);
    } finally { await act(async () => p.view.unmount()); }
  });

  it('takes 32 points of the column, its controls keeping 44-point touch areas (#325)', async () => {
    const { root } = await player();
    let head: ReactTestInstance | null = root.find((node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === 'Collapse the player');
    while (head && !(String(head.type) === 'View' && style(head).justifyContent === 'space-between')) head = head.parent;
    if (!head) throw new Error('The collapse control has no head row');
    expect(style(head)).toMatchObject({ marginVertical: -6 });
    expect(root.findByType(SleepTimerButton).props).toMatchObject({ height: 44, width: 48 });
  });

  it('is a card 12 points in from the sides and 20 above the bottom of an iPhone with a home bar', async () => {
    const { root } = await player();
    const card = root.findAll((node) => String(node.type) === 'View' && style(node).width === 378)[0];
    expect(style(card)).toMatchObject({ marginBottom: 20, alignSelf: 'center', borderTopLeftRadius: 24, borderBottomLeftRadius: 36 });
  });

  it('switches the Tap Lock with one press, and says what a press will do', async () => {
    const off = await player();
    const lock = (root: ReactTestInstance) => root.find((node) => String(node.type) === 'Pressable' && /Taps$/.test(String(node.props.accessibilityLabel)));
    expect(lock(off.root).props.accessibilityLabel).toBe('Lock Taps');
    await act(async () => lock(off.root).props.onPress());
    expect(off.props.onTapLock).toHaveBeenCalledWith(true);
    const on = await player({ tapLock: true });
    expect(lock(on.root).props.accessibilityLabel).toBe('Unlock Taps');
    expect(lock(on.root).findByType('Icon' as never).props).toMatchObject({ name: 'lock', color: 'blue' });
    expect(lock(off.root).findByType('Icon' as never).props).toMatchObject({ name: 'unlock', color: 'ink' });
  });
});

async function button(sleep: SleepTimerState, chapterOffered = true, size = { width: 58, height: 44 }) {
  const onSleep = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(SleepTimerButton, { sleep, chapterOffered, onSleep, ...size })); });
  const entries = () => view.root.findAll((node) => ['Toggle', 'Button', 'Divider'].includes(String(node.type)))
    .map((node) => `${String(node.type)}:${node.props.label ?? ''}${node.props.isOn ? ' ✓' : ''}`);
  const face = () => view.root.findAll((node) => String(node.type) === 'Text' || String(node.type) === 'Icon').map((node) =>
    String(node.type) === 'Text' ? `${node.props.children}` : `${node.props.name} ${node.props.color}`);
  const said = () => view.root.findByType('Menu' as never).props.modifiers.find((one: { name: string }) => one.name === 'accessibilityLabel').value;
  return { view, onSleep, entries, face, said };
}

describe('the Sleep Timer menu', () => {
  it.each([{ width: 48, height: 44 }, { width: 69, height: 89 }])('gives its face the supplied size before any native layout report: %j (#331)', async (size) => {
    // A structural guard, not a simulation of SwiftUI: player-opening.cjs
    // measures the real first-frame jump. The face must not wait for the
    // RNHostView's initial zero height to become the Host's height.
    const states: SleepTimerState[] = [OFF, { ...OFF, choice: 'chapter' }, { ...OFF, choice: 30, left: 30 * 60_000 }];
    for (const sleep of states) {
      const b = await button(sleep, true, size);
      const face = b.view.root.findByType('RNHostView' as never).findByType('View' as never);
      expect(style(face)).toMatchObject({ ...size, alignItems: 'center', justifyContent: 'center' });
      expect(style(face).flex ?? 0).toBe(0);
    }
  });

  it('off: the chapter, then the lengths, nothing checked, and the moon in ink', async () => {
    const b = await button(OFF);
    expect(b.entries()).toEqual([
      'Toggle:When Current Chapter Ends', 'Toggle:5 Minutes', 'Toggle:10 Minutes', 'Toggle:15 Minutes',
      'Toggle:30 Minutes', 'Toggle:45 Minutes', 'Toggle:1 Hour',
    ]);
    expect({ face: b.face(), said: b.said() }).toEqual({ face: ['moon ink'], said: 'Sleep Timer' });
  });

  it('without Contents rows, offers no chapter', async () => {
    const b = await button(OFF, false);
    expect(b.entries()[0]).toBe('Toggle:5 Minutes');
  });

  it('set to the chapter: Turn Off Timer first, the chapter checked, and the moon in the App Colour', async () => {
    const b = await button({ ...OFF, choice: 'chapter' });
    expect(b.entries().slice(0, 3)).toEqual(['Button:Turn Off Timer', 'Divider:', 'Toggle:When Current Chapter Ends ✓']);
    expect({ face: b.face(), said: b.said() }).toEqual({ face: ['moon blue'], said: 'Sleep Timer, When Current Chapter Ends' });
  });

  it('set to a length: the time left, which a choice starts again', async () => {
    const b = await button({ choice: 30, left: 29 * 60_000 + 41_000, since: null, expired: false });
    expect({ face: b.face(), said: b.said() }).toEqual({ face: ['29:41'], said: 'Sleep Timer, 29:41 left' });
    expect(b.entries()).toContain('Toggle:30 Minutes ✓');
    const thirty = b.view.root.findAll((node) => String(node.type) === 'Toggle' && node.props.label === '30 Minutes')[0];
    await act(async () => thirty.props.onIsOnChange(false));
    expect(b.onSleep).toHaveBeenCalledWith(30);
    const off = b.view.root.findAll((node) => String(node.type) === 'Button')[0];
    await act(async () => off.props.onPress());
    expect(b.onSleep).toHaveBeenLastCalledWith(null);
  });
});
