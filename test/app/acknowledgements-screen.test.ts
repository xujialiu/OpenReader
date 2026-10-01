import { createElement, type ReactNode } from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';

import { acknowledgement, acknowledgements } from '../../src/app/acknowledgements';

/**
 * #111: Acknowledgements is one card with a row per component, name on the
 * left and licence on the right, and a row opens that component's licence in
 * its own words, with its version and origin under it. The real screens, with
 * the settings controls replaced by probes that keep what they were handed.
 */
const rows = vi.hoisted(() => [] as { label: string; value?: string; onPress(): void }[]);
const prose = vi.hoisted(() => [] as string[]);
const footnotes = vi.hoisted(() => [] as ReactNode[]);
vi.mock('../../src/app/controls', () => ({
  SettingsPage: ({ children }: { children: ReactNode }) => children,
  SettingsGroup: ({ footer, children }: { footer: ReactNode; children: ReactNode }) => [footer, children],
  NavigationRow: (props: { label: string; value?: string; onPress(): void }) => {
    rows.push(props);
    return null;
  },
  ProseRow: ({ children }: { children: string }) => {
    prose.push(children);
    return null;
  },
  Footnote: ({ children }: { children: ReactNode }) => {
    footnotes.push(children);
    return null;
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const navigation = { navigate: vi.fn(), setOptions: vi.fn() };

async function render(element: ReturnType<typeof createElement>) {
  let tree: ReturnType<typeof create> | undefined;
  await act(async () => {
    tree = create(element);
  });
  await act(async () => tree!.unmount());
}

beforeEach(() => {
  rows.length = 0;
  prose.length = 0;
  footnotes.length = 0;
  navigation.navigate.mockClear();
  navigation.setOptions.mockClear();
});

it('lists every component, name and licence, in the list\'s order', async () => {
  const { AcknowledgementsScreen } = await import('../../src/app/acknowledgements-screen');
  await render(createElement(AcknowledgementsScreen, { navigation, route: {} } as never));
  expect(rows.map((row) => [row.label, row.value])).toEqual(acknowledgements().map((entry) => [entry.name, entry.license]));
});

it('opens a component\'s licence by its name', async () => {
  const { AcknowledgementsScreen } = await import('../../src/app/acknowledgements-screen');
  await render(createElement(AcknowledgementsScreen, { navigation, route: {} } as never));
  rows.find((row) => row.label === 'FFmpeg')!.onPress();
  expect(navigation.navigate).toHaveBeenCalledWith('Acknowledgement', { name: 'FFmpeg' });
});

it('shows the licence in its own words, titled with the name, and the version and origin under it', async () => {
  const { AcknowledgementScreen } = await import('../../src/app/acknowledgements-screen');
  await render(createElement(AcknowledgementScreen, { navigation, route: { params: { name: 'FFmpeg' } } } as never));
  const ffmpeg = acknowledgement('FFmpeg')!;
  expect(prose).toEqual([ffmpeg.text]);
  expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'FFmpeg', headerBackTitle: 'Acknowledgements' });
  expect(footnotes).toHaveLength(1);
  expect(footnotes[0]).toMatch(/^Version 8\.0\.1, part of react-native-audio-api\. /);
});

it('shows nothing for a name the list no longer has, as after an update removed it', async () => {
  const { AcknowledgementScreen } = await import('../../src/app/acknowledgements-screen');
  await render(createElement(AcknowledgementScreen, { navigation, route: { params: { name: 'no-such-component' } } } as never));
  expect(prose).toEqual([]);
});
