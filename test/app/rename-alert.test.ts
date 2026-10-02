import { createElement, createContext } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { RenameAlert } from '../../src/app/rename-alert';

vi.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles } }));
vi.mock('../../src/app/controls', () => ({ SchemeContext: createContext(null) }));
vi.mock('@expo/ui/swift-ui/modifiers', () => ({ disabled: (value: boolean) => ({ disabled: value }) }));
vi.mock('@expo/ui/swift-ui', () => {
  const host = (name: string) => function MockNative({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) {
    return createElement(name, props, children);
  };
  return { Alert: Object.assign(host('Alert'), { Trigger: host('Trigger'), Actions: host('Actions'), Message: host('Message') }),
    Button: host('Button'), Host: host('Host'), Text: host('Text'), TextField: host('TextField'), useNativeState: (name: string) => name };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('folder name validation alert (#121)', () => {
  it('updates the native message string and button validation together without presenting a second alert', async () => {
    let view!: ReactTestRenderer;
    const onSave = vi.fn();
    await act(async () => { view = create(createElement(RenameAlert, {
      name: '', onCancel: vi.fn(), onSave, title: 'Create folder', saveLabel: 'Create',
      validate: (name) => name.toLowerCase() === 'work' ? 'A folder with this name already exists here. Rename it first.' : null,
    })); });
    const alert = () => view.root.findAll((node) => String(node.type) === 'Alert')[0];
    expect(alert().props.message).toBe('');
    const initial = alert();
    const save = () => view.root.findAll((node) => String(node.type) === 'Button' && node.props.label === 'Create')[0];
    expect(save().props.modifiers).toEqual([{ disabled: true }]);
    await act(async () => view.root.findAll((node) => String(node.type) === 'TextField')[0].props.onTextChange('Work'));
    expect(alert()).toBe(initial);
    expect(alert().props.message).toContain('already exists');
    expect(save().props.modifiers).toEqual([{ disabled: true }]);
    await act(async () => view.root.findAll((node) => String(node.type) === 'TextField')[0].props.onTextChange('New folder'));
    expect(alert()).toBe(initial);
    expect(alert().props.message).toBe('');
    expect(save().props.modifiers).toEqual([{ disabled: false }]);
    await act(async () => save().props.onPress());
    expect(onSave).toHaveBeenCalledWith('New folder');
    await act(async () => view.unmount());
  });
});
