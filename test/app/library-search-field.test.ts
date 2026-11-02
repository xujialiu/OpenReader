import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextInput } from 'react-native';
import { LibrarySearchField } from '../../src/app/library-search-field';

/**
 * A double of Reanimated that records what each shared value was asked to do
 * and finishes it only when the test says so. Animated styles are read once,
 * at render, from the values as they stand; the motion itself is the phone's
 * to show, measured natively (#341).
 */
type Motion = { kind: 'spring' | 'delay'; to: number; config?: Record<string, unknown>; delay?: number; done?: (finished: boolean) => void };
const motion = vi.hoisted(() => ({ values: [] as { name: string; now: number; running: Motion | null }[] }));
vi.mock('react-native-reanimated', async () => {
  const { createElement: element, useState } = await import('react');
  const View = ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => element('AnimatedView', props, children);
  return {
    default: { View },
    useSharedValue: (initial: number) => useState(() => {
      const value = { name: `v${motion.values.length}`, now: initial, running: null as Motion | null,
        get: () => value.now,
        set: (next: number | Motion) => {
          if (typeof next === 'number') { value.now = next; value.running = null; } else value.running = next;
        } };
      motion.values.push(value);
      return value;
    })[0],
    useAnimatedStyle: (style: () => unknown) => style(),
    cancelAnimation: (value: { running: Motion | null }) => { const was = value.running; value.running = null; was?.done?.(false); },
  };
});
// The phone's spring and the motion's own clock are `held-spring.test.ts`'s; here only what is asked of them.
vi.mock('../../src/app/held-spring', () => ({
  withHeldSpring: (to: number, done?: (finished: boolean) => void): Motion => ({ kind: 'spring', to, done }),
  withHeldDelay: (delay: number, to: number): Motion => ({ kind: 'delay', to, delay }),
}));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args) }));
const hosts = vi.hoisted(() => async (...names: string[]) => {
  const { createElement: element } = await import('react');
  return Object.fromEntries(names.map((name) => [name, ({ children, ...props }: Record<string, unknown> & { children?: ReactNode }) => element(name, props, children)]));
});
vi.mock('react-native', async () => ({ ...await hosts('View', 'Pressable', 'TextInput'), Platform: { OS: 'ios', Version: '27.0' }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} } }));
vi.mock('@expo/ui/swift-ui', () => hosts('Button', 'Capsule', 'Host'));
vi.mock('@expo/ui/swift-ui/modifiers', () => Object.fromEntries(
  ['accessibilityLabel', 'buttonBorderShape', 'buttonStyle', 'controlSize', 'disabled', 'foregroundStyle', 'glassEffect', 'labelStyle']
    .map((name) => [name, (...args: unknown[]) => ({ [name]: args })])));
vi.mock('../../src/app/controls', async () => ({ INK: {}, SchemeContext: (await import('react')).createContext(null), useAccent: () => ({ reading: '#345678' }) }));
vi.mock('../../src/app/icon', () => hosts('Icon'));
vi.mock('../../src/app/text-styles', () => ({ TEXT: { body: {} } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const [lift, grow, shown, close] = [0, 1, 2, 3];

async function mount() {
  motion.values.length = 0;
  let focused = false;
  const input = { focus: vi.fn(), blur: vi.fn(), isFocused: () => focused };
  const field = { current: null as TextInput | null };
  const props = { open: false, animate: true, field, query: '', locked: false, onChangeText: vi.fn(), onClose: vi.fn() };
  let view!: ReactTestRenderer;
  // The page's ref is the drawn text input's, and empty while none is drawn.
  await act(async () => { view = create(createElement(LibrarySearchField, props), { createNodeMock: (node) => node.type === 'TextInput' ? input : null }); });
  const set = (next: Partial<typeof props>) => act(async () => { Object.assign(props, next); view.update(createElement(LibrarySearchField, { ...props })); });
  const text = () => view.root.findAll((node) => String(node.type) === 'TextInput')[0];
  return {
    field: input,
    value: (index: number) => motion.values[index],
    drawn: () => !!text(),
    slot: () => view.root.findAll((node) => String(node.type) === 'AnimatedView')[0],
    open: () => set({ open: true }),
    close: (animate = true) => set({ open: false, animate }),
    /** The text input reports that it has the keyboard, or has given it up, as the phone does after the work. */
    focused: () => act(async () => { focused = true; text().props.onFocus(); }),
    blurred: () => act(async () => { focused = false; text().props.onBlur(); }),
    /** Each running motion reaches its end, as the UI thread would. */
    settle: () => act(async () => {
      for (const value of motion.values) {
        const running = value.running;
        if (!running) continue;
        value.now = running.to; value.running = null;
        running.done?.(true);
      }
    }),
  };
}
const moving = (page: Awaited<ReturnType<typeof mount>>) => [lift, grow, shown, close].map((index) => page.value(index).running);

describe('the Library Search field moves as the phone\'s own does (#341)', () => {
  afterEach(() => vi.useRealTimers());
  it('draws nothing until search opens', async () => {
    const page = await mount();
    expect(page.drawn()).toBe(false);
  });
  it('waits for the keyboard, then opens on the phone\'s spring, and shows Close once 350 ms of the motion have run', async () => {
    const page = await mount();
    await page.open();
    expect(page.drawn()).toBe(true);
    // The field takes the keyboard by itself as it appears; nothing moves until it has.
    expect(page.field.focus).not.toHaveBeenCalled();
    expect(moving(page)).toEqual([null, null, null, null]);
    // The list's room starts at nothing.
    expect(page.slot().props.style).toContainEqual({ height: 0 });
    await page.focused();
    for (const index of [lift, grow, shown]) expect(page.value(index).running).toMatchObject({ kind: 'spring', to: 1 });
    expect(page.value(close).running).toMatchObject({ kind: 'delay', to: 1, delay: 350 });
  });
  it('opens all the same when the field never reports its focus', async () => {
    vi.useFakeTimers();
    const page = await mount();
    await page.open();
    await act(async () => { vi.advanceTimersByTime(599); });
    expect(page.value(lift).running).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(page.value(lift).running).toMatchObject({ kind: 'spring', to: 1 });
  });
  it('closes once the keyboard has gone, fading in place while the list goes back up, then goes', async () => {
    const page = await mount();
    await page.open(); await page.focused(); await page.settle();
    await page.close();
    expect(page.field.blur).toHaveBeenCalledTimes(1);
    expect(page.drawn()).toBe(true);
    expect(page.slot().props.pointerEvents).toBe('none');
    expect(moving(page)).toEqual([null, null, null, null]);
    await page.blurred();
    expect(page.value(shown).running).toMatchObject({ kind: 'spring', to: 0 });
    expect(page.value(lift).running).toMatchObject({ kind: 'spring', to: 0 });
    // The capsule does not shrink on the way out.
    expect(page.value(grow).running).toBeNull();
    expect(page.value(grow).now).toBe(1);
    await page.settle();
    expect(page.drawn()).toBe(false);
    // The next opening starts from nothing.
    expect([page.value(grow).now, page.value(shown).now, page.value(close).now]).toEqual([0, 1, 0]);
  });
  it('closes at once when the keyboard was already put away, and a blur with nothing waiting moves nothing', async () => {
    const page = await mount();
    await page.open(); await page.focused(); await page.settle();
    await page.blurred(); // a drag on the list puts the keyboard away
    expect(moving(page)).toEqual([null, null, null, null]);
    await page.close();
    expect(page.field.blur).not.toHaveBeenCalled();
    expect(page.value(lift).running).toMatchObject({ kind: 'spring', to: 0 });
  });
  it('a close during the opening holds it where it is until the keyboard has gone, and keeps Close hidden', async () => {
    const page = await mount();
    await page.open(); await page.focused();
    await page.close();
    expect(moving(page)).toEqual([null, expect.objectContaining({ to: 1 }), null, null]);
    expect(page.value(close).now).toBe(0);
    await page.blurred();
    expect(page.value(lift).running).toMatchObject({ kind: 'spring', to: 0 });
    expect(page.value(close).running).toBeNull();
  });
  it('an opening during the fade holds it, gives the same field the keyboard again and turns it back', async () => {
    const page = await mount();
    await page.open(); await page.focused(); await page.settle();
    await page.close(); await page.blurred();
    const fade = page.value(lift).running!;
    await page.open();
    expect(page.field.focus).toHaveBeenCalledTimes(1);
    expect([page.value(lift).running, page.value(shown).running]).toEqual([null, null]);
    await page.focused();
    for (const index of [lift, shown]) expect(page.value(index).running).toMatchObject({ kind: 'spring', to: 1 });
    // Close is already showing, so it stays.
    expect(page.value(close).running).toBeNull();
    expect(page.value(close).now).toBe(1);
    // The earlier fade's end, if it were still reported, does not take the open field away.
    fade.done?.(true);
    await page.settle();
    expect(page.drawn()).toBe(true);
  });
  it('never makes the list taller than its own room: the closing overshoot stops at the list\'s place', async () => {
    // A list taller than its room, even by the overshoot's fraction of a point, has its scroll
    // offset clamped at the very bottom and keeps it: Close came back 1 pt short (#341, notes 2026-11-02).
    const page = await mount();
    await page.open(); await page.focused(); await page.settle();
    await page.close(); await page.blurred();
    page.value(lift).now = -0.0124;
    await page.open(); // any render reads the styles again
    expect(page.slot().props.style).toContainEqual({ height: 0 });
  });
  it('a close while the page is not in front takes the field away at once', async () => {
    const page = await mount();
    await page.open(); await page.focused(); await page.settle();
    await page.close(false);
    expect(page.field.blur).toHaveBeenCalledTimes(1);
    expect(page.drawn()).toBe(false);
    expect(motion.values.every((value) => value.running === null)).toBe(true);
  });
});
