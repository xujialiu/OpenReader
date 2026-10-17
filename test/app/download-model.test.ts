import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { DownloadContent } from '../../src/app/download-sheet';
import type { OfflineVoice } from '../../src/offline/model';
import { narrationIdentity } from '../../src/offline/narration-voice';

const mock = vi.hoisted(() => ({ model: 'drama-3', alert: vi.fn(), requestProgress: vi.fn(), releaseProgress: vi.fn() }));
const hosts = vi.hoisted(() => async (...names: string[]) => {
  const { createElement } = await import('react');
  return Object.fromEntries(names.map((name) => [name, ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => createElement(name, props, children)]));
});
vi.mock('react-native', async () => ({ ...await hosts('View', 'Text', 'Pressable', 'ActivityIndicator'),
  StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: mock.alert },
}));
vi.mock('react-native-gesture-handler', () => hosts('GestureDetector'));
vi.mock('../../src/app/controls', () => ({ INK: {}, useAccent: () => ({}), useBorders: () => ({}) }));
vi.mock('../../src/app/drawer', async () => ({ ...await hosts('DrawerList', 'DrawerRow', 'DrawerRowText'), DRAWER: { row: {} } }));
vi.mock('../../src/app/download-ring', () => hosts('DownloadRing'));
vi.mock('../../src/app/icon', () => hosts('Icon'));
vi.mock('../../src/app/use-sweep', () => ({ useSweep: () => ({ list: {}, gesture: {} }) }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ settings: { fish: { model: mock.model } } }) }));
vi.mock('../../src/app/settings', () => ({ PROVIDER_LABELS: { fish: 'Fish Audio' } }));
vi.mock('../../src/offline/runtime', () => ({
  useDownloads: () => {}, requestPlan: () => {}, downloadTasks: () => [], indexingState: () => null,
  requestProgress: mock.requestProgress, releaseProgress: mock.releaseProgress,
  planOf: () => ({ version: 2, chapters: [] }), chapterProgress: () => new Map(),
  sameVoice: (a: OfflineVoice, b: OfflineVoice) => narrationIdentity(a) === narrationIdentity(b),
  savedVoices: () => [
    { provider: 'fish', voice: 'old', label: 'Hidden old-model Voice' },
    { provider: 'fish', model: 'drama-3', voice: 'other', label: 'Current-model Voice' },
    { provider: 'azure', voice: 'azure', label: 'Azure Voice' },
  ],
  occupied: (_document: string, voice?: OfflineVoice) => voice ? 10 : 30,
  formatBytes: (n: number) => `${n} bytes`, downloadError: () => null, downloadsReady: () => true,
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('shows Provider and Model on their own row, filters saved Fish Voices, and keeps delete-all document-wide', async () => {
  let view!: ReactTestRenderer;
  const onVoice = vi.fn();
  const render = (manage: boolean) => createElement(DownloadContent, {
    document: 'book', title: 'Book', voice: { provider: 'fish', voice: 'A', label: 'A very long narrator name that needs its own row' },
    place: null, manage, onManage: vi.fn(), onSelectAll: vi.fn(), onVoice,
  });
  const words = (type: string) => view.root.findAll((node) => String(node.type) === type).map((node) => [node.props.children].flat().join(''));
  await act(async () => { view = create(render(false)); });
  try {
    expect(words('Text')).toContain('Model · Fish Audio · drama-3');
    expect(words('Text')).toContain('Voice · A very long narrator name that needs its own row');
    expect(words('DrawerRowText')).not.toContain('Use downloaded voice · Hidden old-model Voice');
    expect(words('DrawerRowText')).toContain('Use downloaded voice · Current-model Voice');
    expect(words('DrawerRowText')).toContain('Use downloaded voice · Azure Voice');
    expect(mock.requestProgress).toHaveBeenLastCalledWith('book', expect.objectContaining({ model: 'drama-3' }));
    await act(async () => { view.update(render(true)); });
    expect(words('Text')).toContain('Model · Fish Audio · drama-3');
    const remove = view.root.findAll((node) => String(node.type) === 'DrawerRow')
      .find((node) => node.findAll((child) => String(child.type) === 'DrawerRowText' && child.props.children === 'Delete all saved audio').length)!;
    await act(async () => { remove.props.onPress(); });
    expect(mock.alert).toHaveBeenLastCalledWith('Delete all saved audio?',
      expect.stringContaining('across all providers, models and voices'), expect.any(Array));
    expect(mock.alert.mock.lastCall?.[1]).toContain('30 bytes');
    mock.model = 's2.1-pro-free';
    await act(async () => { view.update(render(false)); });
    expect(words('Text')).toContain('Model · Fish Audio · s2.1-pro-free');
    expect(words('DrawerRowText')).toContain('Use downloaded voice · Hidden old-model Voice');
    expect(words('DrawerRowText')).not.toContain('Use downloaded voice · Current-model Voice');
    expect(onVoice).not.toHaveBeenCalled(); // displaying a Model never selects one
  } finally { await act(async () => view.unmount()); }
});
