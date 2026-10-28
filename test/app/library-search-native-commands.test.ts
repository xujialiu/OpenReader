import { createElement, createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import type { SearchBarCommands } from 'react-native-screens';
import SearchBar from 'react-native-screens/src/components/SearchBar';

const native = vi.hoisted(() => ({
  target: { tag: 'native-search' }, supported: [] as string[],
  commands: {
    blur: vi.fn(), focus: vi.fn(), clearText: vi.fn(), setText: vi.fn(), cancelSearch: vi.fn(), toggleCancelButton: vi.fn(),
    captureScrollPosition: vi.fn(), restoreScrollPosition: vi.fn(),
  },
}));
vi.mock('react-native', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  const View = forwardRef<unknown>((_props, ref) => {
    useImperativeHandle(ref, () => native.target);
    return null;
  });
  return {
    View,
    codegenNativeComponent: () => View,
    codegenNativeCommands: ({ supportedCommands }: { supportedCommands: string[] }) => {
      native.supported = supportedCommands;
      return native.commands;
    },
  };
});
vi.mock('react-native-screens/src/utils', () => ({
  isSearchBarAvailableForCurrentPlatform: true,
  parseBooleanToOptionalBooleanNativeProp: (value: boolean | undefined) => value === undefined ? 'undefined' : String(value),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('the patched real SearchBar ref forwards semantic position commands to its generated native interface', async () => {
  const ref = createRef<SearchBarCommands>();
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(SearchBar, { ref })); });
  expect(native.supported).toEqual(expect.arrayContaining(['captureScrollPosition', 'restoreScrollPosition']));
  ref.current!.captureScrollPosition('browse');
  ref.current!.captureScrollPosition('results');
  ref.current!.restoreScrollPosition('top');
  ref.current!.restoreScrollPosition('browse');
  ref.current!.restoreScrollPosition('results');
  expect(native.commands.captureScrollPosition.mock.calls).toEqual([
    [native.target, 'browse'], [native.target, 'results'],
  ]);
  expect(native.commands.restoreScrollPosition.mock.calls).toEqual([
    [native.target, 'top'], [native.target, 'browse'], [native.target, 'results'],
  ]);
  await act(async () => view.unmount());
});
