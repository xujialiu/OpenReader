import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { View, type LayoutChangeEvent } from 'react-native';
import { useRowSweep, type SelectableRows } from '../../src/app/use-sweep';

const handlers = vi.hoisted(() => ({ start: (_event: { y: number }) => {}, update: (_event: { y: number }) => {}, end: () => {} }));
const nativeConfig = vi.hoisted(() => ({ runOnJS: vi.fn(), waitFor: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('react-native-gesture-handler', () => ({ Gesture: { Native: () => {
  const native = {
    runOnJS: (enabled: boolean) => { nativeConfig.runOnJS(enabled); return native; },
    requireExternalGestureToFail: (gesture: unknown) => { nativeConfig.waitFor(gesture); return native; },
  };
  return native;
}, Pan: () => {
  const gesture = {
    minPointers: vi.fn(() => gesture), minDistance: vi.fn(() => gesture), runOnJS: vi.fn(() => gesture),
    onStart: (fn: typeof handlers.start) => { handlers.start = fn; return gesture; },
    onUpdate: (fn: typeof handlers.update) => { handlers.update = fn; return gesture; },
    onFinalize: (fn: typeof handlers.end) => { handlers.end = fn; return gesture; },
  };
  return gesture;
} } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.useRealTimers());
const ids = ['folder:a', 'document:b', 'document:c', 'folder:d'];
function layout(y: number, height: number): LayoutChangeEvent {
  return { nativeEvent: { layout: { x: 0, y, width: 300, height } } } as LayoutChangeEvent;
}
async function mount(initial: Partial<SelectableRows> = {}) {
  let rows: SelectableRows = { ids, values: ids.map((id) => [id]), selected: new Set(), scope: 'root', ...initial };
  let sweep!: ReturnType<typeof useRowSweep<string>>;
  const select = vi.fn();
  let renderer!: ReactTestRenderer;
  function Probe() {
    sweep = useRowSweep<string>(rows, select);
    const Cell = sweep.list.CellRendererComponent;
    return createElement('List', null, ...ids.map((id, index) => {
      const props = { cellKey: id, item: id, index, onLayout: () => {}, style: {}, children: null };
      return createElement(Cell, { ...props, key: id });
    }));
  }
  await act(async () => { renderer = create(createElement(Probe)); });
  const measure = () => renderer.root.findAllByType(View).forEach((view, index) => view.props.onLayout(layout(index * 60, 60)));
  await act(async () => measure());
  return {
    select, get sweep() { return sweep; },
    update: async (patch: Partial<SelectableRows>) => { rows = { ...rows, ...patch }; await act(async () => { renderer.update(createElement(Probe)); }); },
    measure, close: async () => { await act(async () => renderer.unmount()); },
  };
}
it('routes native gestures on JS while retaining two-finger sweep priority', async () => {
  nativeConfig.runOnJS.mockClear(); nativeConfig.waitFor.mockClear();
  const h = await mount();
  expect(nativeConfig.runOnJS).toHaveBeenCalledExactlyOnceWith(true);
  expect(nativeConfig.waitFor).toHaveBeenCalledExactlyOnceWith(h.sweep.gesture);
  await h.close();
});
it('selects, retracts and deselects mixed Library ranges with the real sweep controller', async () => {
  const h = await mount();
  handlers.start({ y: 70 }); handlers.update({ y: 190 });
  expect([...h.select.mock.lastCall![0]]).toEqual(ids.slice(1));
  handlers.update({ y: 125 });
  expect([...h.select.mock.lastCall![0]]).toEqual(ids.slice(1, 3));
  handlers.end();
  await h.update({ selected: new Set(ids) });
  handlers.start({ y: 70 }); handlers.update({ y: 130 });
  expect([...h.select.mock.lastCall![0]]).toEqual([ids[0], ids[3]]);
  handlers.update({ y: 70 });
  expect([...h.select.mock.lastCall![0]]).toEqual([ids[0], ids[2], ids[3]]);
  await h.close();
});
it('ends an active sweep when disabled or when the row order changes', async () => {
  vi.useFakeTimers();
  const h = await mount();
  handlers.start({ y: 10 });
  expect(vi.getTimerCount()).toBe(1);
  await h.update({ enabled: false });
  expect(vi.getTimerCount()).toBe(0);
  h.select.mockClear();
  handlers.start({ y: 10 }); handlers.update({ y: 190 });
  expect(h.select).not.toHaveBeenCalled();
  await h.update({ enabled: true });
  handlers.start({ y: 10 });
  await h.update({ ids: [...ids].reverse(), values: [...ids].reverse().map((id) => [id]) });
  expect(vi.getTimerCount()).toBe(0);
  await h.close();
});
it('starts edge scrolling above floating actions and releases its timer on unmount', async () => {
  vi.useFakeTimers();
  const h = await mount({ bottomInset: 80 });
  const scrollToOffset = vi.fn();
  // The real controller needs only the scroll command; the rest of FlatList is irrelevant to this probe.
  h.sweep.list.ref({ scrollToOffset });
  h.sweep.list.onLayout(layout(0, 300));
  h.sweep.list.onContentSizeChange(300, 900);
  handlers.start({ y: 205 });
  vi.advanceTimersByTime(32);
  expect(scrollToOffset).toHaveBeenCalledWith(expect.objectContaining({ animated: false, offset: expect.any(Number) }));
  expect(scrollToOffset.mock.lastCall![0].offset).toBeGreaterThan(0);
  await h.close();
  expect(vi.getTimerCount()).toBe(0);
});
it('refuses a row press while a sweep runs and for 300 ms after it ends, and delivers every other press (#335)', async () => {
  vi.useFakeTimers();
  const h = await mount();
  const press = vi.fn();
  const row = h.sweep.guard(press);
  row('before');
  expect(press).toHaveBeenCalledTimes(1);
  // The lift of a sweep that ends on the row it began on: the press arrives before the pan finalizes, or after.
  handlers.start({ y: 10 }); handlers.update({ y: 40 });
  row('while the fingers are down');
  handlers.end();
  vi.advanceTimersByTime(299);
  row('just after');
  expect(press).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2);
  row('a tap afterwards', 2);
  expect(press).toHaveBeenCalledTimes(2);
  expect(press).toHaveBeenLastCalledWith('a tap afterwards', 2);
  await h.close();
});
it('does not quiet presses when the sweep is disabled and so never began, or when no sweep ran', async () => {
  vi.useFakeTimers();
  const h = await mount({ enabled: false });
  const press = vi.fn();
  const row = h.sweep.guard(press);
  handlers.start({ y: 10 });
  handlers.end();
  row('after a touch that began no sweep');
  handlers.end();
  row('after a second end');
  expect(press).toHaveBeenCalledTimes(2);
  await h.close();
});
it('keeps the selection of the sweep: a press dropped after a short sweep leaves the chosen start row to the sweep', async () => {
  vi.useFakeTimers();
  const h = await mount();
  const toggle = vi.fn();
  const row = h.sweep.guard(toggle);
  handlers.start({ y: 10 }); handlers.update({ y: 70 });
  expect([...h.select.mock.lastCall![0]]).toEqual(ids.slice(0, 2));
  handlers.end();
  row();
  expect(toggle).not.toHaveBeenCalled();
  await h.close();
});
