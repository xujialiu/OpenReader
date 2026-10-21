import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { Player, type PlayerProps } from '../../src/app/player';
import { DEFAULT_SETTINGS } from '../../src/app/settings';

/**
 * A drag on the open Player moves nothing (#312).
 *
 * The whole Player used to sit in one `ScrollView`, capped at 75 % of the
 * window for the largest text sizes. React Native leaves `alwaysBounceVertical`
 * on for a vertical `ScrollView`, so on iOS it rubber-banded at every size: a
 * drag slid the controls up and down inside the panel and they sprang back.
 *
 * The native bounce cannot be seen from here, so this pins the shape that rules
 * it out: no scroll view above the controls, none at all without notes, and the
 * notes' own one, there only for notes too long for the room above the
 * Player, not bouncing while they fit. The simulator check that measures the
 * drag itself is `test/manual-test/player-and-reading-held/player-drag.md`.
 */

vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5, absoluteFill: {} },
  useWindowDimensions: () => ({ width: 402, height: 874, fontScale: 1, scale: 3 }),
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

const NOTE = { said: 'No provider is enabled. Enable one in Settings to listen.', attention: true };

async function openPlayer(notes: PlayerProps['notes']) {
  const props: PlayerProps = {
    settings: DEFAULT_SETTINGS, playing: false, collapsed: false, enabled: true,
    voiceInUse: null, notes, following: true, barHeight: 64,
    onCollapsed: vi.fn(), onPlay: vi.fn(), onPause: vi.fn(), onSkip: vi.fn(), onRate: vi.fn(),
    onContents: vi.fn(), onVoices: vi.fn(), onReturn: vi.fn(), onHeight: vi.fn(), onOpenHeight: vi.fn(),
  };
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(createElement(Player, props)); });
  return view.root;
}

const scrollViews = (root: ReactTestInstance) => root.findAll((node) => String(node.type) === 'ScrollView');

function ancestors(node: ReactTestInstance): ReactTestInstance[] {
  const above: ReactTestInstance[] = [];
  for (let at = node.parent; at; at = at.parent) above.push(at);
  return above;
}

describe('a drag on the open Player moves nothing (#312)', () => {
  it('puts no scroll view above any of its controls, with or without a note', async () => {
    for (const notes of [[], [NOTE]]) {
      const root = await openPlayer(notes);
      const controls = root.findAll((node) => String(node.type) === 'Pressable');
      expect(controls.map((node) => node.props.accessibilityLabel)).toContain('Play');
      for (const control of controls) {
        expect(ancestors(control).filter((node) => String(node.type) === 'ScrollView'), String(control.props.accessibilityLabel))
          .toHaveLength(0);
      }
    }
  });

  it('has no scroll view at all while it has nothing to say', async () => {
    expect(scrollViews(await openPlayer([]))).toHaveLength(0);
  });

  it('gives the notes one scroll view, which does not bounce while they fit', async () => {
    const [notes] = scrollViews(await openPlayer([NOTE]));
    expect(notes.props.alwaysBounceVertical).toBe(false);
    expect(notes.findAll((node) => String(node.type) === 'Text').map((node) => node.props.children)).toEqual([NOTE.said]);
  });

  it('grows no higher than the bottom of the navigation bar', async () => {
    const root = await openPlayer([NOTE]);
    const box = root.findAll((node) => String(node.type) === 'View')[0];
    expect(box.props.pointerEvents).toBe('box-none');
    expect([box.props.style].flat()).toContainEqual(expect.objectContaining({ top: 64 }));
  });
});
