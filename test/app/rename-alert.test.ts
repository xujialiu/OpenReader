import { createElement, createContext } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameAlert } from '../../src/app/rename-alert';

const warning = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: warning } }));
vi.mock('../../src/app/controls', () => ({ SchemeContext: createContext(null) }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: (value: boolean) => ({ disabled: value }) }));
vi.mock('@expo/ui/swift-ui', () => {
  const host = (name: string) => function MockNative({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
    return createElement(name, props, children);
  };
  return { Alert: Object.assign(host('Alert'), { Trigger: host('Trigger'), Actions: host('Actions') }),
    Button: host('Button'), Host: host('Host'), Text: host('Text'), TextField: host('TextField'), useNativeState: (name: string) => name };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => warning.mockReset());

async function editor() {
  let view!: ReactTestRenderer;
  const onSave = vi.fn();
  const onCancel = vi.fn();
  await act(async () => { view = create(createElement(RenameAlert, {
    name: '', onCancel, onSave, title: 'Create folder', saveLabel: 'Create',
    validate: (name) => name.trim().toLowerCase() === 'work' ? 'A folder with this name already exists here. Rename it first.' : null,
  })); });
  return { view, onSave, onCancel,
    alert: () => view.root.findAll((node) => String(node.type) === 'Alert')[0],
    save: () => view.root.findAll((node) => String(node.type) === 'Button' && node.props.label === 'Create')[0],
    type: (name: string) => act(async () => view.root.findAll((node) => String(node.type) === 'TextField')[0].props.onTextChange(name)),
    unmount: () => act(async () => view.unmount()),
  };
}

describe('submit-time folder name validation (#121)', () => {
  it('keeps blank disabled, but allows submitting a collision so its complete warning can be shown', async () => {
    const e = await editor();
    expect(e.save().props.modifiers).toEqual([{ disabled: true }]);
    await e.type('   ');
    await act(async () => e.save().props.onPress());
    expect(e.onSave).not.toHaveBeenCalled();
    expect(warning).not.toHaveBeenCalled();
    await e.type('Work');
    expect(e.save().props.modifiers).toEqual([{ disabled: false }]);
    expect(warning).not.toHaveBeenCalled();
    await act(async () => e.save().props.onPress());
    expect(e.onSave).not.toHaveBeenCalled();
    expect(e.alert().props.isPresented).toBe(false);
    expect(warning.mock.calls[0][1]).toContain('“Work”');
    expect(warning.mock.calls[0][1]).toContain('already exists');
    await e.unmount();
  });
  it('returns to the same editor and draft, and allows correcting then saving the name', async () => {
    const e = await editor();
    const initial = e.alert();
    await e.type('Work');
    await act(async () => e.save().props.onPress());
    await act(async () => warning.mock.calls[0][2][1].onPress());
    expect(e.alert()).toBe(initial);
    expect(e.alert().props.isPresented).toBe(true);
    // No typing after reopening: submitting again still checks the same draft.
    await act(async () => e.save().props.onPress());
    expect(warning.mock.calls[1][1]).toContain('“Work”');
    await act(async () => warning.mock.calls[1][2][1].onPress());
    await e.type('New folder');
    await act(async () => e.save().props.onPress());
    expect(e.onSave).toHaveBeenCalledExactlyOnceWith('New folder');
    await e.unmount();
  });
  it('cancels from the warning without creating or renaming anything', async () => {
    const e = await editor();
    await e.type('Work');
    await act(async () => e.save().props.onPress());
    await act(async () => warning.mock.calls[0][2][0].onPress());
    expect(e.onCancel).toHaveBeenCalledOnce();
    expect(e.onSave).not.toHaveBeenCalled();
    await e.unmount();
  });
});
