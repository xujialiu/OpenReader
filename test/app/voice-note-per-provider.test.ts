import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { useVoiceLists } from '../../src/app/use-voices';
import { rememberVoices } from '../../src/app/voice-catalog';
import { VoiceSheet } from '../../src/app/voice-sheet';

/**
 * #205. The real `useVoiceLists` and `VoiceSheet`, the hook held above the
 * Drawer as `ReadingView` holds it. Doubled: the Provider factory (Kokoro's
 * listing fails while its server is off), the Keychain, the file system, and the
 * Drawer's parts and React Native's. Like the installed BottomSheet, the Drawer
 * double mounts its content only while it is up.
 */
const disk = vi.hoisted(() => new Map<string, string>());
vi.mock('expo-file-system', () => ({ Paths: { document: 'test' }, File: class {
  constructor(_d: string, private name: string) {}
  get exists() { return disk.has(this.name); }
  textSync() { return disk.get(this.name); }
  write(v: string) { disk.set(this.name, v); }
} }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({ secretsWritten: 0 }) }));
vi.mock('../../src/keys/store', () => ({
  readProviderKey: async () => ({ outcome: 'found', secret: 'k' }),
  readGatewayHeaders: async () => ({ outcome: 'missing' }),
}));
const server = vi.hoisted(() => ({ off: true }));
const DOWN = 'Cannot reach Kokoro at http://mac.local:8880. Is the server running?';
vi.mock('../../src/core/providers/factory', () => ({
  createProvider: (id: string) => ({
    listVoices: async () => {
      if (id === 'local' && server.off) throw new Error(DOWN);
      return [{ id: `${id}/v`, label: `${id} voice`, locale: 'en' }];
    },
  }),
}));
vi.mock('../../src/app/drawer', () => ({
  Drawer: ({ visible, children }: { visible: boolean; children: ReactNode }) => (visible ? children : null),
  DrawerFooter: 'DrawerFooter', DrawerMenuRow: 'DrawerMenuRow', DrawerRow: 'DrawerRow', DrawerRowText: 'DrawerRowText',
}));
vi.mock('react-native', () => ({ FlatList: 'FlatList', StyleSheet: { create: <T,>(s: T) => s }, View: 'View' }));
vi.mock('../../src/app/controls', () => ({ INK: { text: '#000' }, useAccent: () => ({ reading: '#00f' }) }));
vi.mock('../../src/app/icon', () => ({ Icon: 'Icon' }));
vi.mock('../../src/app/loading-spinner', () => ({ LoadingSpinner: 'LoadingSpinner' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const settings = { ...DEFAULT_SETTINGS, provider: 'fish' as const, voice: 'fish/v', enabledProviders: ['fish', 'local'] as ('fish' | 'local')[] };

function Host({ visible, at = settings }: { visible: boolean; at?: typeof settings }) {
  const lists = useVoiceLists(at);
  return createElement(VoiceSheet, { visible, onClose() {}, settings: at, lists, onChoose() {} });
}

function drawn(tree: ReactTestRenderer) {
  const row = tree.root.findAll((node) => (node.type as unknown) === 'DrawerMenuRow' && node.props.label === 'Provider')[0]!;
  const list = tree.root.findAll((node) => (node.type as unknown) === 'FlatList')[0]!;
  return {
    choose: row.props.onChoose as (id: string) => void,
    provider: row.props.chosen as string,
    voices: (list.props.data as { id: string }[]).map((voice) => voice.id),
    notes: tree.root.findAll((node) => (node.type as unknown) === 'DrawerFooter' && node.props.attention === true)
      .map((node) => [node.props.children].flat().join('')),
  };
}

async function open(at = settings): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(Host, { visible: true, at })); });
  return tree;
}

beforeEach(() => { server.off = true; disk.clear(); });

it('shows a failed Voice listing only under the Provider it is about', async () => {
  const tree = await open();
  await act(async () => { drawn(tree).choose('local'); });
  expect(drawn(tree).notes).toEqual([DOWN]);

  await act(async () => { drawn(tree).choose('fish'); });
  expect(drawn(tree)).toMatchObject({ provider: 'fish', voices: ['fish/v'], notes: [] });

  // Closed, and opened again on the Provider in use.
  await act(async () => { tree.update(createElement(Host, { visible: false })); });
  await act(async () => { tree.update(createElement(Host, { visible: true })); });
  expect(drawn(tree)).toMatchObject({ provider: 'fish', notes: [] });

  // Kokoro's own sentence is still under Kokoro until it is asked again.
  await act(async () => { drawn(tree).choose('local'); });
  expect(drawn(tree).notes).toEqual([DOWN]);
  server.off = false;
  await act(async () => { tree.update(createElement(Host, { visible: false })); });
  await act(async () => { tree.update(createElement(Host, { visible: true })); });
  await act(async () => { drawn(tree).choose('local'); });
  expect(drawn(tree)).toMatchObject({ provider: 'local', voices: ['local/v'], notes: [] });
  await act(async () => { tree.unmount(); });
});

it('drops a Provider\'s sentence once its Voices are held, as after a Test connection in Settings', async () => {
  // Another Kokoro Address, whose Voices the first test has not left held.
  const at = { ...settings, local: { ...settings.local, baseURL: 'http://other.local:8880' } };
  const tree = await open(at);
  await act(async () => { drawn(tree).choose('local'); });
  expect(drawn(tree).notes).toEqual([DOWN]);

  await act(async () => { rememberVoices(at, 'local', [{ id: 'local/v', label: 'local voice', locale: 'en' }]); });
  expect(drawn(tree)).toMatchObject({ provider: 'local', voices: ['local/v'], notes: [] });
  await act(async () => { tree.unmount(); });
});
