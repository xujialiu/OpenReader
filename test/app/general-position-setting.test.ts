import { createElement, type ReactNode, useState } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

import { Footnote, SettingsGroup, SwitchRow } from '../../src/app/controls';
import { GeneralScreen } from '../../src/app/general-screen';
import type { Shell } from '../../src/app/routes';
import { DEFAULT_SETTINGS } from '../../src/app/settings';

const world = vi.hoisted(() => ({ shell: null as Pick<Shell, 'settings' | 'setSettings'> | null }));
vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T) => styles }, Text: 'Text', Pressable: 'Pressable',
}));
vi.mock('../../src/app/routes', () => ({ useShell: () => world.shell }));
vi.mock('../../src/app/controls', () => ({
  SettingsPage: ({ children }: { children: ReactNode }) => children,
  SettingsGroup: ({ children, footer, ...props }: { children: ReactNode; footer?: ReactNode; title?: string }) =>
    createElement('SettingsGroup', props, children, footer),
  SwitchRow: 'SwitchRow', ValueRow: 'ValueRow', TextRow: 'TextRow', Footnote: 'Footnote',
  useAccent: () => ({ reading: '#000' }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('offers the default-off paused-saving switch before Reading aloud and changes only that setting (#367)', async () => {
  function Harness() {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    world.shell = { settings, setSettings };
    return createElement(GeneralScreen);
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Harness)); });
  try {
    const groups = tree.root.findAllByType(SettingsGroup);
    const titles = groups.map((group) => group.props.title);
    expect(titles.indexOf('Reading position')).toBeGreaterThan(-1);
    expect(titles.indexOf('Reading position')).toBeLessThan(titles.indexOf('Reading aloud'));
    const group = groups[titles.indexOf('Reading position')];
    expect(group.findByType(Footnote).props.children).toBe('Applies to sentence taps and the sentence and paragraph buttons.');
    const control = () => group.findByType(SwitchRow);
    expect(control().props.label).toBe('Save position while paused');
    expect(control().props.value).toBe(false);
    await act(async () => { control().props.onChange(true); });
    expect(world.shell!.settings).toEqual({ ...DEFAULT_SETTINGS, savePositionWhilePaused: true });
    expect(control().props.value).toBe(true);
    await act(async () => { control().props.onChange(false); });
    expect(world.shell!.settings).toEqual(DEFAULT_SETTINGS);
  } finally {
    await act(async () => { tree.unmount(); });
  }
});
