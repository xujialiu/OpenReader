import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DownloadContent } from '../../src/app/download-sheet';
import type { OfflineVoice } from '../../src/offline/model';
import { narrationIdentity } from '../../src/offline/narration-voice';

const mock = vi.hoisted(() => ({
  model: 'drama-3', alert: vi.fn(), requestProgress: vi.fn(), releaseProgress: vi.fn(),
  /** What `occupied` answers for the whole Document, and for one Voice. */
  document: 30, voice: 10,
  /** What `savedVoices` answers, when a test sets it. */
  saved: null as OfflineVoice[] | null,
  removeVoiceDownloads: vi.fn(async () => {}),
}));
const hosts = vi.hoisted(() => async (...names: string[]) => {
  const { createElement } = await import('react');
  return Object.fromEntries(names.map((name) => [name, ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => createElement(name, props, children)]));
});
vi.mock('react-native', async () => ({ ...await hosts('View', 'Text', 'Pressable', 'ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: mock.alert },
}));
vi.mock('react-native-gesture-handler', () => hosts('GestureDetector'));
vi.mock('../../src/app/controls', async () => ({ ...await hosts('ChoiceMenu'), INK: {}, useAccent: () => ({}), useBorders: () => ({}) }));
vi.mock('../../src/app/drawer', async () => ({ ...await hosts('DrawerList', 'DrawerRow', 'DrawerRowText'), DRAWER: { row: {} } }));
vi.mock('../../src/app/download-ring', () => hosts('DownloadRing'));
vi.mock('../../src/app/icon', () => hosts('Icon'));
vi.mock('../../src/app/use-sweep', () => ({ useSweep: () => ({ list: {}, gesture: {} }) }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ settings: { fish: { model: mock.model } } }) }));
vi.mock('../../src/app/settings', () => ({ PROVIDER_LABELS: { fish: 'Fish Audio', azure: 'Azure' } }));
vi.mock('../../src/offline/runtime', () => ({
  useDownloads: () => {}, requestPlan: () => {}, downloadTasks: () => [], indexingState: () => null,
  requestProgress: mock.requestProgress, releaseProgress: mock.releaseProgress,
  planOf: () => ({ version: 2, chapters: [] }), chapterProgress: () => new Map(),
  sameVoice: (a: OfflineVoice, b: OfflineVoice) => narrationIdentity(a) === narrationIdentity(b),
  savedVoices: () => mock.saved ?? [
    { provider: 'fish', voice: 'old', label: 'Hidden old-model Voice' },
    { provider: 'fish', model: 'drama-3', voice: 'other', label: 'Current-model Voice' },
    { provider: 'azure', voice: 'azure', label: 'Azure Voice' },
  ],
  occupied: (_document: string, voice?: OfflineVoice) => voice ? mock.voice : mock.document,
  removeVoiceDownloads: mock.removeVoiceDownloads,
  formatBytes: (n: number) => `${n} bytes`, downloadError: () => null, downloadsReady: () => true,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** Switch voice's menu (#329), or undefined where it is not offered. */
const switchVoice = (view: ReactTestRenderer) => view.root.findAll((node) => String(node.type) === 'ChoiceMenu' && node.props.label === 'Switch voice')[0];

/** The button whose words are `label`. */
const pressable = (view: ReactTestRenderer, label: string) => view.root.findAll((node) => String(node.type) === 'Pressable')
  .find((node) => node.findAll((child) => String(child.type) === 'DrawerRowText' && child.props.children === label).length)!;

it('shows Provider and Model on their own row, filters saved Fish Voices, and keeps delete-all document-wide', async () => {
  let view!: ReactTestRenderer;
  const onVoice = vi.fn();
  const render = (manage: boolean) => createElement(DownloadContent, {
    document: 'book', title: 'Book', voice: { provider: 'fish', voice: 'A', label: 'A very long narrator name that needs its own row' },
    place: null, manage, onManage: vi.fn(), onSelectAll: vi.fn(), onVoice,
  });
  const words = (type: string) => view.root.findAll((node) => String(node.type) === type).map((node) => [node.props.children].flat().join(''));
  /** What Switch voice's menu lists (#329). */
  const entries = () => (switchVoice(view)?.props.choices as { label: string }[]).map((c) => c.label);
  await act(async () => { view = create(render(false)); });
  try {
    expect(words('Text')).toContain('Model · Fish Audio · drama-3');
    expect(words('Text')).toContain('Voice · A very long narrator name that needs its own row');
    expect(entries()).toEqual(['Azure Voice', 'Current-model Voice']);
    expect(mock.requestProgress).toHaveBeenLastCalledWith('book', expect.objectContaining({ model: 'drama-3' }));
    await act(async () => { view.update(render(true)); });
    expect(words('Text')).toContain('Model · Fish Audio · drama-3');
    await act(async () => { pressable(view, 'Delete all audio').props.onPress(); });
    expect(mock.alert).toHaveBeenLastCalledWith('Delete all audio?',
      expect.stringContaining('across all providers, models and voices'), expect.any(Array));
    expect(mock.alert.mock.lastCall?.[1]).toContain('30 bytes');
    mock.model = 's2.1-pro-free';
    await act(async () => { view.update(render(false)); });
    expect(words('Text')).toContain('Model · Fish Audio · s2.1-pro-free');
    expect(entries()).toEqual(['Azure Voice', 'Hidden old-model Voice']);
    expect(onVoice).not.toHaveBeenCalled(); // displaying a Model never selects one
  } finally { await act(async () => view.unmount()); }
});

it('deletes all of the managed Voice\'s audio in its Model from the right of Delete all audio, and stays in Manage while anything is left (#306)', async () => {
  mock.model = 'drama-3';
  let view!: ReactTestRenderer;
  const onManage = vi.fn();
  const render = () => createElement(DownloadContent, {
    document: 'book', title: 'Book', voice: { provider: 'fish', voice: 'A', label: 'Aarav' },
    place: null, manage: true, onManage, onSelectAll: vi.fn(),
  });
  const confirm = async () => {
    const buttons = mock.alert.mock.lastCall?.[2] as { text: string; onPress?(): void }[];
    await act(async () => { buttons.find((b) => b.text === 'Delete')!.onPress!(); });
  };
  await act(async () => { view = create(render()); });
  try {
    // One row: Delete all audio first, the managed Voice's after it.
    const row = view.root.findAll((node) => String(node.type) === 'DrawerRow').find((node) => node.findAll((child) => child.props.children === 'Delete all audio').length)!;
    expect(row.findAll((node) => String(node.type) === 'DrawerRowText').map((node) => node.props.children)).toEqual(['Delete all audio', 'Delete all current voice audio']);
    await act(async () => { pressable(view, 'Delete all current voice audio').props.onPress(); });
    expect(mock.alert).toHaveBeenLastCalledWith('Delete all current voice audio?',
      "All saved audio for this document in Aarav (Fish Audio \u00b7 drama-3) will be deleted, freeing 10 bytes. Other voices' audio, the document and reading position will be kept.",
      expect.any(Array));
    // Other Voices still have audio: Manage stays open.
    await confirm();
    expect(mock.removeVoiceDownloads).toHaveBeenLastCalledWith('book', expect.objectContaining({ provider: 'fish', voice: 'A', model: 'drama-3' }));
    expect(onManage).not.toHaveBeenCalled();
    // Nothing left anywhere: back to Download.
    await act(async () => { pressable(view, 'Delete all current voice audio').props.onPress(); });
    mock.document = 0;
    await confirm();
    expect(onManage).toHaveBeenLastCalledWith(false);
    // A Voice with nothing saved is offered no delete of its own.
    mock.document = 30;
    mock.voice = 0;
    await act(async () => { view.update(render()); });
    expect(pressable(view, 'Delete all audio')).toBeDefined();
    expect(pressable(view, 'Delete all current voice audio')).toBeUndefined();
  } finally {
    mock.document = 30;
    mock.voice = 10;
    await act(async () => view.unmount());
  }
});

it('Switch voice lists the saved Voices by name in the Voice menu\'s order, checks the one shown, and chooses on Download or Manage (#329)', async () => {
  mock.model = 'drama-3';
  mock.saved = [
    { provider: 'fish', model: 'drama-3', voice: 'A', label: 'Aarav' },
    { provider: 'azure', voice: 'x', label: 'Gregory' },
    { provider: 'fish', model: 'drama-3', voice: 'g', label: 'Gregory' },
    { provider: 'fish', model: 'drama-3', voice: 'z', label: '晓晓' },
  ];
  let view!: ReactTestRenderer;
  const onVoice = vi.fn();
  const render = (manage: boolean) => createElement(DownloadContent, {
    document: 'book', title: 'Book', voice: { provider: 'fish', voice: 'A', label: 'Aarav' },
    place: null, manage, onManage: vi.fn(), onSelectAll: vi.fn(), onVoice,
  });
  const menu = () => switchVoice(view);
  const voiceLine = () => view.root.findAll((node) => String(node.type) === 'Text').map((node) => [node.props.children].flat().join('')).find((words) => words.startsWith('Voice · '));
  await act(async () => { view = create(render(false)); });
  try {
    // Han first by pinyin, then A to Z; a shared name carries its Provider; no row per Voice under the list.
    expect((menu().props.choices as { label: string }[]).map((c) => c.label)).toEqual(['晓晓', 'Aarav', 'Gregory (Azure)', 'Gregory (Fish Audio)']);
    expect(menu().props.chosen).toBe('fish/A');
    expect(view.root.findAll((node) => String(node.type) === 'DrawerRowText')).toHaveLength(0);
    // The checked entry changes nothing; another becomes the one Voice.
    await act(async () => { menu().props.onChoose('fish/A'); });
    expect(onVoice).not.toHaveBeenCalled();
    await act(async () => { menu().props.onChoose('azure/x'); });
    expect(onVoice).toHaveBeenLastCalledWith({ provider: 'azure', voice: 'x', label: 'Gregory' });
    // On Manage only the Voice managed changes.
    onVoice.mockClear();
    await act(async () => { view.update(render(true)); });
    await act(async () => { menu().props.onChoose('fish/g'); });
    expect(onVoice).not.toHaveBeenCalled();
    expect(voiceLine()).toBe('Voice · Gregory');
    expect(menu().props.chosen).toBe('fish/g');
    // Offered only when the menu holds a Voice other than the one shown.
    await act(async () => { view.update(render(false)); });
    mock.saved = [{ provider: 'fish', model: 'drama-3', voice: 'A', label: 'Aarav' }];
    await act(async () => { view.update(render(false)); });
    expect(menu()).toBeUndefined();
    mock.saved = [];
    await act(async () => { view.update(render(false)); });
    expect(menu()).toBeUndefined();
    mock.saved = [{ provider: 'azure', voice: 'x', label: 'Gregory' }];
    await act(async () => { view.update(render(false)); });
    expect((menu().props.choices as { label: string }[]).map((c) => c.label)).toEqual(['Gregory']);
    expect(menu().props.chosen).toBe('fish/A');
  } finally {
    mock.saved = null;
    await act(async () => view.unmount());
  }
});
