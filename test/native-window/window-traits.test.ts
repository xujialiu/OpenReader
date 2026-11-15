import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ os: 'ios', view: vi.fn(() => 'NativeWindowTraits') }));
vi.mock('expo', () => ({ requireNativeView: native.view }));
vi.mock('react-native', () => ({ Platform: { get OS() { return native.os; } } }));
beforeEach(() => {
  vi.resetModules();
  native.os = 'ios';
  native.view.mockClear();
});

describe('the window-trait observation boundary (#362)', () => {
  it('loads only the local native view and forwards the actual window event', async () => {
    const { WindowTraitsObserver } = await import('../../modules/open-reader-window');
    const onVerticalBarChange = vi.fn();
    const element = WindowTraitsObserver({ onVerticalBarChange, pointerEvents: 'none' });
    expect(native.view).toHaveBeenCalledExactlyOnceWith('OpenReaderWindow');
    expect(element?.props.onVerticalBarChange).toBe(onVerticalBarChange);
    expect(element?.props.pointerEvents).toBe('none');
  });

  it('requires no Apple view on another platform', async () => {
    native.os = 'android';
    const { WindowTraitsObserver } = await import('../../modules/open-reader-window');
    expect(WindowTraitsObserver({ onVerticalBarChange: vi.fn() })).toBeNull();
    expect(native.view).not.toHaveBeenCalled();
  });
});
