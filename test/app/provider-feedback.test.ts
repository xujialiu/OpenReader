import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProviderScreen } from '../../src/app/provider-screen';
import { flushProviderEdits } from '../../src/app/provider-edits';
import type { ScreenProps } from '../../src/app/routes';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';

const store = vi.hoisted(() => ({
  settings: null as unknown as AppSettings, key: '', refuseHeaders: false, test: vi.fn(),
}));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({
  settings: store.settings,
  setSettings: (next: (previous: AppSettings) => AppSettings) => { store.settings = next(store.settings); },
}) }));
vi.mock('../../src/app/provider-connection', () => ({ testProviderConnection: store.test }));
vi.mock('../../src/app/voice-catalog', () => ({ rememberVoices() {} }));
vi.mock('../../src/app/use-provider-secrets', () => {
  const key = {
    with: async (read: (value: string) => unknown) => read(store.key),
    save: async (next: string) => { store.key = next; return null; },
  };
  const headers = {
    with: async (read: (value: string) => unknown) => read(''),
    save: async () => store.refuseHeaders ? 'refused' : null,
  };
  return { useProviderKey: () => key, useGatewayHeaders: () => headers };
});
vi.mock('../../src/app/controls', async () => {
  const { createElement } = await import('react');
  const controls = ['ActionRow', 'FieldRow', 'Footnote', 'HeaderButton', 'SettingsGroup', 'SettingsPage', 'SwitchRow', 'TextRow', 'ValueRow'];
  return Object.fromEntries(controls.map((name) => [
    name, ({ children, footer, ...props }: Record<string, unknown> & { children?: ReactNode; footer?: ReactNode }) =>
      createElement(name, props, children, footer),
  ]));
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let tree: ReactTestRenderer | undefined;
const screen = () => createElement(ProviderScreen, {
  route: { params: { id: 'compatible' } }, navigation: { setOptions() {} },
} as unknown as ScreenProps<'Provider'>);
async function show() {
  await act(async () => {
    if (tree) tree.update(screen());
    else tree = create(screen());
  });
}
async function close() { await act(async () => tree?.unmount()); tree = undefined; }
const row = (label: string) => tree!.root.find((node) => typeof node.type === 'string' && node.props.label === label);
const notes = () => tree!.root.findAll((node) => String(node.type) === 'Footnote')
  .map((node) => [node.props.children].flat().join(''));
const testConnection = () => act(async () => row('Test connection').props.onPress());
async function edit(label: string, value: string) {
  await act(async () => {
    row(label).props.onChangeText(value);
    await flushProviderEdits('compatible').catch(() => {});
  });
  await show();
}
beforeEach(async () => {
  store.settings = { ...DEFAULT_SETTINGS, compatible: { baseURL: 'https://a.invalid', model: 'A' } };
  store.key = '';
  store.refuseHeaders = false;
  store.test.mockReset().mockResolvedValue([]);
  await show();
});
afterEach(close);

it.each(['Address', 'Model', 'API key', 'Extra headers'])('retires the tested result when %s changes', async (label) => {
  await testConnection();
  expect(notes()).toEqual(['Connection successful']);
  await act(async () => row('Sentences at once').props.onChoose(2));
  await show();
  expect(notes()).toEqual(['Connection successful']);
  await edit(label, 'changed');
  expect(notes()).toEqual([]);
  expect(store.test).toHaveBeenCalledTimes(1);
});

it('opens a fresh detail after a failed check', async () => {
  store.test.mockRejectedValueOnce(new Error('offline'));
  await testConnection();
  expect(notes()).toEqual(['offline']);
  await close();
  await show();
  expect(notes()).toEqual([]);
});

it('shares a pending check across visits and displays its answer only on the visit that started it', async () => {
  let release!: () => void;
  store.test.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  await testConnection();
  await close();
  await show();
  expect(row('Test connection').props.disabled).toBe(true);
  await testConnection();
  expect(store.test).toHaveBeenCalledTimes(1);
  await act(async () => release());
  expect(row('Test connection').props.disabled).toBe(false);
  expect(notes()).toEqual([]);
  await testConnection();
  expect(notes()).toEqual(['Connection successful']);
});

it('reports a refused headers save on that field and blocks testing until it is repaired', async () => {
  store.refuseHeaders = true;
  try {
    await edit('Extra headers', 'first');
    await edit('API key', 'saved');
    expect(store.key).toBe('saved');
    expect(notes()).toEqual(['Extra headers: Could not save. Try again.']);
    await close();
    await show();
    expect(notes()).toEqual(['Extra headers: The previous edit could not be saved.']);
    await testConnection();
    expect(store.test).not.toHaveBeenCalled();
    store.refuseHeaders = false;
    await edit('Extra headers', 'second');
    await testConnection();
    expect(notes()).toEqual(['Connection successful']);
  } finally {
    store.refuseHeaders = false;
    await edit('Extra headers', 'cleared');
  }
});
