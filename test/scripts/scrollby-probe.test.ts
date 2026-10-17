import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../manual-test/place-and-following/scrollby-probe.js', import.meta.url), 'utf8');

function recorder() {
  let now = 0;
  let frame: (() => void) | null = null;
  const container = { scrollTop: 0, scrollHeight: 2000, clientHeight: 600 };
  const context = vm.createContext({
    window: {},
    performance: { now: () => now },
    requestAnimationFrame: (callback: () => void) => { frame = callback; },
    rendition: { manager: { container, scrollBy: (_x: number, y: number) => { container.scrollTop += y; } } },
  });
  vm.runInContext(source, context);
  const read = () => JSON.parse(vm.runInContext('probe()', context)) as Record<string, number | boolean>;
  expect(read()).toEqual({ armed: true, scroller: true });
  return {
    read,
    advance(to: number) { now = to; frame?.(); },
    scroll() { vm.runInContext('rendition.manager.scrollBy(0, 10, false)', context); },
  };
}

describe('the manual scroll recorder reports elapsed windows and frames per second', () => {
  it('an idle one-second observation has a full window and 60 fps, not 0 ms and 0.06 fps', () => {
    const p = recorder();
    for (let frame = 1; frame <= 60; frame++) p.advance(frame * 1000 / 60);
    expect(p.read()).toMatchObject({ windowMs: 1000, scrollSpanMs: 0, framesPerSecond: 60, scrollByCalls: 0 });
    for (let frame = 61; frame <= 120; frame++) p.advance(frame * 1000 / 60);
    expect(p.read()).toMatchObject({ windowMs: 1000, framesPerSecond: 60, frames: 60 });
  });

  it('distinguishes the observation window from the interval occupied by scroll calls', () => {
    const p = recorder();
    p.advance(200); p.scroll();
    p.advance(400); p.scroll();
    p.advance(1000);
    expect(p.read()).toMatchObject({ windowMs: 1000, scrollSpanMs: 200, scrollByCalls: 2, pxRequested: 20, pxActuallyMoved: 20 });
  });
});
