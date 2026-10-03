import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { LibrarySelectionAction } from '../../src/app/library-selection-actions';

const platform = vi.hoisted(() => ({ Version: 27 }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('@expo/ui/swift-ui', () => ({ Host: 'NativeHost', Button: 'NativeButton' }));
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(
  ['accessibilityLabel', 'buttonBorderShape', 'buttonStyle', 'controlSize', 'disabled', 'font'].map((name) => [name, (value: unknown) => ({ name, value })]),
));
vi.mock('../../src/app/controls', async () => {
  const { createContext } = await import('react');
  return { SchemeContext: createContext('dark'), useAccent: () => ({ reading: '#abcdef' }) };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('uses native glass capsules, readable text, semantic deletion and native disabling', async () => {
  let renderer!: ReactTestRenderer;
  const onPress = vi.fn();
  await act(async () => { renderer = create(createElement(LibrarySelectionAction, { action: 'Move', disabled: true, onPress })); });
  expect(renderer.toJSON()).toMatchObject({ type: 'NativeHost', props: { matchContents: true, colorScheme: 'dark', seedColor: '#abcdef' }, children: [{
    type: 'NativeButton', props: { label: 'Move', role: 'default', modifiers: expect.arrayContaining([
      { name: 'buttonStyle', value: 'glass' }, { name: 'buttonBorderShape', value: 'capsule' },
      { name: 'disabled', value: true }, { name: 'accessibilityLabel', value: 'Move selected' },
    ]) },
  }] });
  await act(async () => renderer.update(createElement(LibrarySelectionAction, { action: 'Delete', disabled: false, onPress })));
  expect(renderer.toJSON()).toMatchObject({ props: { seedColor: undefined }, children: [{ props: { label: 'Delete', role: 'destructive', onPress } }] });
  await act(async () => renderer.update(createElement(LibrarySelectionAction, { action: 'Delete', disabled: true, working: true, onPress })));
  expect(renderer.toJSON()).toMatchObject({ children: [{ props: { label: 'Deleting…', modifiers: expect.arrayContaining([{ name: 'disabled', value: true }]) } }] });
  await act(async () => renderer.unmount());
});

it('uses the native bordered fallback before iOS 26 rather than an unsupported glass style', async () => {
  platform.Version = 18;
  let renderer!: ReactTestRenderer;
  try {
    await act(async () => { renderer = create(createElement(LibrarySelectionAction, { action: 'Move', disabled: false, onPress: vi.fn() })); });
    expect(renderer.toJSON()).toMatchObject({ children: [{ props: { modifiers: expect.arrayContaining([{ name: 'buttonStyle', value: 'bordered' }]) } }] });
  } finally {
    await act(async () => renderer.unmount());
    platform.Version = 27;
  }
});
