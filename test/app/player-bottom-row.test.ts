import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Player, type PlayerProps } from '../../src/app/player';
import { SleepTimerButton } from '../../src/app/sleep-timer-button';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { SleepTimerState } from '../../src/app/use-sleep-timer';

/**
 * The Player's bottom row (#325, #326): the Tap Lock at its left end and the
 * Sleep Timer at its right, in both layouts; and the Sleep Timer's menu.
 */

const dimensions = vi.hoisted(() => ({ width: 402, height: 874, fontScale: 1, scale: 3 }));
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
    Host: host('Host'), RNHostView: host('RNHostView'), Menu: ({ label, children, ...props }: Record<string, unknown> & { label?: ReactNode; children?: ReactNode }) => createElement('Menu', props, label, children), Toggle: host('Toggle'), Button: host('Button'), Divider: host('Divider'),
    Popover: Object.assign(host('Popover'), { Trigger: host('Trigger'), Content: host('Content') }),
  };
});
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(
  ['menuOrder', 'accessibilityElement', 'accessibilityLabel', 'accessibilityAddTraits'].map((name) => [name, (value: unknown) => ({ name, value })]),
));
vi.mock('../../src/playback', () => import('../../src/playback/rate'));
vi.mock('../../src/app/controls', () => ({
  INK: { text: 'ink' }, useBorders: () => ({ line: 'grey' }), useAccent: () => ({ following: 'orange', reading: 'blue' }),
}));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/loading-spinner', () => ({ LoadingSpinner: 'LoadingSpinner' }));
vi.mock('../../src/app/reading-button', () => ({ ReadingButton: 'ReadingButton', READING_BUTTON_PLACE: {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => Object.assign(dimensions, { width: 402, fontScale: 1 }));

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
  return { root: view.root, props };
}

/** The rows of controls, top to bottom, each as the names of what is in it. */
function rows(root: ReactTestInstance): string[][] {
  return root.findAll((node) => String(node.type) === 'View' && node.props.style?.flexDirection === 'row' && node.props.style?.justifyContent === 'space-between'
    && node.parent?.props.style?.gap === 6)
    .map((row) => row.children.filter((child): child is ReactTestInstance => typeof child !== 'string')
      .map((child) => String(child.props.accessibilityLabel ?? (typeof child.type === 'function' ? child.type.name : child.type))));
}

describe('the bottom row', () => {
  it('is the last row, the lock at its left and the Sleep Timer at its right', async () => {
    const { root } = await player();
    expect(rows(root).at(-1)).toEqual(['TapLockButton', 'SleepTimerButton']);
  });

  it('is the last row in the layout that gives Contents and the speed a row of their own', async () => {
    Object.assign(dimensions, { width: 390, fontScale: 3 });
    const { root } = await player();
    const all = rows(root);
    // The head, the transport, Contents and the speed, then this one.
    expect(all.length).toBe(4);
    expect(all[2]).toEqual(['Contents', 'SpeedBubble']);
    expect(all.at(-1)).toEqual(['TapLockButton', 'SleepTimerButton']);
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

async function button(sleep: SleepTimerState, chapterOffered = true) {
  const onSleep = vi.fn();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(SleepTimerButton, { sleep, chapterOffered, onSleep, width: 58, height: 44 })); });
  const entries = () => view.root.findAll((node) => ['Toggle', 'Button', 'Divider'].includes(String(node.type)))
    .map((node) => `${String(node.type)}:${node.props.label ?? ''}${node.props.isOn ? ' ✓' : ''}`);
  const face = () => view.root.findAll((node) => String(node.type) === 'Text' || String(node.type) === 'Icon').map((node) =>
    String(node.type) === 'Text' ? `${node.props.children}` : `${node.props.name} ${node.props.color}`);
  const said = () => view.root.findByType('Menu' as never).props.modifiers.find((one: { name: string }) => one.name === 'accessibilityLabel').value;
  return { view, onSleep, entries, face, said };
}

describe('the Sleep Timer menu', () => {
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
