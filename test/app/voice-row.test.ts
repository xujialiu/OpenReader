import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/app/settings';
import type { VoiceLists } from '../../src/app/use-voices';
import { VoiceSheet } from '../../src/app/voice-sheet';
import type { ProviderId, VoiceInfo } from '../../src/core/providers/types';

/**
 * #232. The Voice drawer's third row: the Voices of the Language shown, as a
 * menu like Provider and Language above it. The Drawer's parts are doubled as
 * host elements, so what the sheet hands each row is read off its props.
 */
vi.mock('../../src/app/drawer', () => ({
  Drawer: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? children : null),
  DrawerFooter: 'DrawerFooter', DrawerMenuRow: 'DrawerMenuRow',
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FISH: VoiceInfo[] = [
  { id: 'en/b', label: 'Brian', locale: 'en' },
  { id: 'zh/x', label: '晓晓', locale: 'zh' },
  { id: 'en/a', label: 'Ava', locale: 'en' },
  { id: 'mul/d', label: 'Default', locale: 'mul' },
];
const settings = { ...DEFAULT_SETTINGS, provider: 'fish' as const, voice: 'en/b', enabledProviders: ['fish'] as ProviderId[] };
const lists: VoiceLists = {
  enabled: ['fish'],
  voicesOf: (provider) => (provider === 'fish' ? FISH : null),
  asking: () => false,
  noteOf: () => null,
  ask: () => {},
};

type Row = { label: string; choices: { value: string; label: string }[]; chosen: string; busy?: boolean; onChoose(next: string): void };

function rows(tree: ReactTestRenderer): Record<string, Row> {
  return Object.fromEntries(tree.root.findAll((node) => (node.type as unknown) === 'DrawerMenuRow').map((node) => [node.props.label, node.props as Row]));
}

async function open(pending: { provider: ProviderId; voice: string } | null = null, onChoose = vi.fn()) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(createElement(VoiceSheet, { visible: true, onClose() {}, settings, lists, pending, onChoose }));
  });
  return tree;
}

it('is a third menu row under Provider and Language, opening on the Voice in use with its Language’s Voices by name', async () => {
  const tree = await open();
  expect(Object.keys(rows(tree))).toEqual(['Provider', 'Language', 'Voice']);
  expect(rows(tree).Language.choices.map((choice) => choice.label)).toEqual(['Multilingual', 'Chinese', 'English']);
  expect(rows(tree).Language.chosen).toBe('en');
  expect(rows(tree).Voice).toMatchObject({ chosen: 'en/b', busy: false });
  expect(rows(tree).Voice.choices.map((choice) => choice.label)).toEqual(['Ava', 'Brian']);
  await act(async () => { tree.unmount(); });
});

it('reads with a Voice chosen from its menu, for the Provider shown', async () => {
  const onChoose = vi.fn();
  const tree = await open(null, onChoose);
  await act(async () => { rows(tree).Voice.onChoose('en/a'); });
  expect(onChoose).toHaveBeenCalledWith('fish', 'en/a');
  await act(async () => { tree.unmount(); });
});

it('names and checks nothing on a Language the Voice in use is not in, and chooses nothing for the owner', async () => {
  const onChoose = vi.fn();
  const tree = await open(null, onChoose);
  await act(async () => { rows(tree).Language.onChoose('zh'); });
  expect(rows(tree).Voice.choices.map((choice) => choice.value)).toEqual(['zh/x']);
  // What the row names is the chosen one's label among its choices: none here.
  expect(rows(tree).Voice.choices.some((choice) => choice.value === rows(tree).Voice.chosen)).toBe(false);
  expect(onChoose).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
});

it('shows the Voice being got ready, with the spinner, until it is', async () => {
  const tree = await open({ provider: 'fish', voice: 'en/a' });
  expect(rows(tree).Voice).toMatchObject({ chosen: 'en/a', busy: true });
  await act(async () => { tree.unmount(); });
});
