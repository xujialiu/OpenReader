import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { ProviderScreen } from '../../src/app/provider-screen';
import type { ScreenProps } from '../../src/app/routes';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/app/settings';
import { sharedFishModels, type FishSpeechModel } from '../../src/core/providers/fish-models';
import type { ProviderId } from '../../src/core/providers/types';

const mock = vi.hoisted(() => ({ settings: null as unknown as AppSettings, busy: false }));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
vi.mock('../../src/app/routes', () => ({ useShell: () => ({
  settings: mock.settings,
  setSettings: (next: (previous: AppSettings) => AppSettings) => { mock.settings = next(mock.settings); },
}) }));
vi.mock('../../src/app/controls', async () => {
  const { createElement } = await import('react');
  return Object.fromEntries(['ActionRow', 'FieldRow', 'Footnote', 'HeaderButton', 'SettingsGroup', 'SettingsPage', 'SwitchRow', 'TextRow', 'ValueRow']
    .map((name) => [name, ({ children, footer, ...props }: Record<string, unknown> & { children?: ReactNode; footer?: ReactNode }) =>
      createElement(name, props, children, footer)]));
});
vi.mock('../../src/app/use-provider-connection', () => ({ useProviderConnection: (id: ProviderId) => ({
  enabled: mock.settings.enabledProviders.includes(id), busy: mock.busy, note: null, toggle: () => {}, test: async () => {},
}) }));
vi.mock('../../src/app/use-provider-secrets', () => ({ useProviderKey: () => ({}), useGatewayHeaders: () => ({}) }));
vi.mock('../../src/app/use-secret-input', () => ({ useSecretInput: () => ({ value: '', change: () => {}, editable: true, error: null }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ERROR = 'Additional Models could not be loaded. Reopen this page to try again.';
let view: ReactTestRenderer | undefined;
let requests: { resolve(models: FishSpeechModel[]): void; reject(error: Error): void }[];
let load: MockInstance<typeof sharedFishModels.load>;
const navigation = { setOptions: () => {} };
const screen = (id: ProviderId) => createElement(ProviderScreen, {
  route: { key: 'provider', name: 'Provider', params: { id } }, navigation,
} as unknown as ScreenProps<'Provider'>);
async function show(id: ProviderId = 'fish') {
  await act(async () => {
    if (view) view.update(screen(id));
    else view = create(screen(id));
  });
}
const modelRow = () => view!.root.find((node) => String(node.type) === 'ValueRow' && node.props.label === 'Model');
const choices = () => modelRow().props.choices.map((choice: { value: string }) => choice.value);
const errors = () => view!.root.findAll((node) => String(node.type) === 'Footnote' && node.props.attention)
  .map((node) => [node.props.children].flat().join(''));

beforeEach(() => {
  mock.settings = { ...DEFAULT_SETTINGS, enabledProviders: [], fish: { ...DEFAULT_SETTINGS.fish, model: 'saved-model' } };
  mock.busy = false;
  requests = [];
  load = vi.spyOn(sharedFishModels, 'load').mockImplementation(() => new Promise((resolve, reject) => { requests.push({ resolve, reject }); }));
});
afterEach(async () => {
  if (view) await act(async () => view!.unmount());
  view = undefined;
  vi.restoreAllMocks();
});

it('keeps known and saved choices usable while discovery loads, then adds the answer without changing the selected Model', async () => {
  await show();
  expect(choices()).toEqual(['s2.1-pro-free', 's2.1-pro', 'drama-3', 's2-pro', 'saved-model']);
  expect(modelRow().props.chosen).toBe('saved-model');
  expect(errors()).toEqual([]);
  await act(async () => requests[0].resolve([{ id: 'discovered-model', free: false }]));
  expect(choices()).toContain('discovered-model');
  expect(modelRow().props.chosen).toBe('saved-model');
  await show();
  expect(load).toHaveBeenCalledTimes(1);
});

it('keeps choices after failure, clears the error on returning to Fish, and retries', async () => {
  await show();
  await act(async () => requests[0].reject(new Error('offline')));
  expect(errors()).toEqual([ERROR]);
  expect(choices()).toContain('saved-model');
  await show('local');
  expect(errors()).toEqual([]);
  expect(load).toHaveBeenCalledTimes(1);
  await show();
  expect(errors()).toEqual([]);
  expect(load).toHaveBeenCalledTimes(2);
  await act(async () => requests[1].resolve([{ id: 'retry-model' }]));
  expect(choices()).toContain('retry-model');
  expect(errors()).toEqual([]);
});

it.each(['success', 'failure'] as const)('ignores a late %s from the previous Fish visit', async (outcome) => {
  await show();
  await show('local');
  await show();
  await act(async () => {
    if (outcome === 'success') requests[0].resolve([{ id: 'stale-model' }]);
    else requests[0].reject(new Error('old request failed'));
  });
  expect(errors()).toEqual([]);
  expect(choices()).not.toContain('stale-model');
  await act(async () => requests[1].resolve([{ id: 'current-model' }]));
  expect(choices()).toContain('current-model');
});

it('starts a fresh retry when the failed screen is closed and reopened', async () => {
  await show();
  await act(async () => requests[0].reject(new Error('offline')));
  expect(errors()).toEqual([ERROR]);
  await act(async () => view!.unmount());
  view = undefined;
  await show();
  expect(errors()).toEqual([]);
  expect(load).toHaveBeenCalledTimes(2);
});

it('keeps the Model menu locked while enabled or testing', async () => {
  await show();
  expect(modelRow().props.disabled).toBe(false);
  mock.busy = true;
  await show();
  expect(modelRow().props.disabled).toBe(true);
  mock.busy = false;
  mock.settings = { ...mock.settings, enabledProviders: ['fish'] };
  await show();
  expect(modelRow().props.disabled).toBe(true);
  await act(async () => modelRow().props.onChoose('drama-3'));
  expect(mock.settings.fish.model).toBe('saved-model');
  expect(load).toHaveBeenCalledTimes(1);
});
