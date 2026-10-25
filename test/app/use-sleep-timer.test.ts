import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { leftAt, useSleepTimer, type SleepTimer } from '../../src/app/use-sleep-timer';
import type { StopRequest } from '../../src/app/use-reading';
import type { ContentsRow } from '../../src/core/document/contents';

/**
 * The Sleep Timer's state (#326): a length counts only while the Reading
 * plays, asks the Reading to stop after its sentence when it runs out, and is
 * done once the Reading has stopped; the chapter is asked for at once.
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const ROWS: readonly ContentsRow[] = [{ id: 'a', label: 'One', depth: 0, heading: false, section: 0, target: 1, fragment: '', href: 'one.xhtml' }];
const MINUTE = 60_000;

async function mounted(playing: boolean) {
  const asked: StopRequest[] = [];
  const stopAt = (request: StopRequest) => { asked.push(request); };
  let timer!: SleepTimer;
  function Probe({ on }: { on: boolean }) {
    timer = useSleepTimer(on, ROWS, stopAt);
    return null;
  }
  let view!: ReactTestRenderer;
  await act(async () => { view = create(createElement(Probe, { on: playing })); });
  return {
    timer: () => timer,
    asked,
    left: () => leftAt(timer, Date.now()),
    play: (on: boolean) => act(async () => { view.update(createElement(Probe, { on })); }),
    choose: (choice: Parameters<SleepTimer['choose']>[0]) => act(async () => { timer.choose(choice); }),
    slept: () => act(async () => { timer.slept(); }),
    pass: (ms: number) => act(async () => { vi.advanceTimersByTime(ms); }),
  };
}

describe('a length', () => {
  it('counts only while the Reading plays', async () => {
    const t = await mounted(true);
    await t.choose(30);
    await t.pass(10 * MINUTE);
    await t.play(false);
    expect(t.left()).toBe(20 * MINUTE);
    await t.pass(60 * MINUTE);
    expect({ left: t.left(), expired: t.timer().expired }).toEqual({ left: 20 * MINUTE, expired: false });
    await t.play(true);
    await t.pass(20 * MINUTE - 1);
    expect(t.timer().expired).toBe(false);
    await t.pass(1);
    expect(t.timer().expired).toBe(true);
    expect(t.asked.at(-1)).toEqual({ kind: 'sentence' });
  });

  it('chosen while paused waits for Play', async () => {
    const t = await mounted(false);
    await t.choose(5);
    await t.pass(10 * MINUTE);
    expect({ left: t.left(), asked: t.asked.at(-1) }).toEqual({ left: 5 * MINUTE, asked: null });
  });

  it('is done when the Reading stops after its sentence, or when the owner pauses it first', async () => {
    const t = await mounted(true);
    await t.choose(5);
    await t.pass(5 * MINUTE);
    await t.play(false);
    expect({ choice: t.timer().choice, asked: t.asked.at(-1) }).toEqual({ choice: null, asked: null });
  });

  it('chosen again starts again from the length', async () => {
    const t = await mounted(true);
    await t.choose(10);
    await t.pass(8 * MINUTE);
    await t.choose(10);
    expect(t.left()).toBe(10 * MINUTE);
  });
});

describe('the chapter', () => {
  it('is asked for at once, and is done when the Reading pauses at its end', async () => {
    const t = await mounted(true);
    await t.choose('chapter');
    expect(t.asked.at(-1)).toEqual({ kind: 'chapter', rows: ROWS });
    await t.slept();
    expect({ choice: t.timer().choice, asked: t.asked.at(-1) }).toEqual({ choice: null, asked: null });
  });

  it('outlasts a pause', async () => {
    const t = await mounted(true);
    await t.choose('chapter');
    await t.play(false);
    await t.play(true);
    expect({ choice: t.timer().choice, asked: t.asked.at(-1) }).toEqual({ choice: 'chapter', asked: { kind: 'chapter', rows: ROWS } });
  });

  it('Turn Off Timer takes the request back', async () => {
    const t = await mounted(true);
    await t.choose('chapter');
    await t.choose(null);
    expect({ choice: t.timer().choice, asked: t.asked.at(-1) }).toEqual({ choice: null, asked: null });
  });
});
