import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { highlighterSource } from '../../src/renderer/highlighter';

/** A correct CFI was redisplayed near the bottom because epub.js moved before
 * appending the next section. After fill, the same text must reach the TOP,
 * not merely remain somewhere visible (#319 beta7 device finding). */
function page() {
  let top = 9500;
  let limit = 9600;
  let sectionTop = 0;
  let localTop = 10_000;
  const frames: (() => void)[] = [];
  const anchor = { cfi: 'epubcfi-target', section: 15 };
  const stage = { getBoundingClientRect: () => ({ top: 0 }) };
  const locationOf = vi.fn(() => ({ top: localTop }));
  const contents = {
    sectionIndex: 15, locationOf,
    document: { defaultView: { frameElement: { getBoundingClientRect: () => ({ top: sectionTop - top }) } } },
  };
  const nudge = vi.fn((by: number) => { top = Math.min(limit, Math.max(0, top + by)); });
  const context = vm.createContext({
    resizeAnchor: anchor, browsing: true, state: { follow: true }, barCovered: 54,
    rendition: { getContents: () => [contents] }, scroller: () => stage, nudge,
    window: { requestAnimationFrame: (fn: () => void) => frames.push(fn) },
  });
  const source = highlighterSource();
  const start = source.indexOf('  function restoreResizeAnchor(');
  if (start < 0) throw new Error('Missing resize anchor restoration');
  const end = source.indexOf('\n  }\n', start) + '\n  }\n'.length;
  vm.runInContext(source.slice(start, end), context);
  return {
    context, nudge, locationOf,
    start: () => vm.runInContext('restoreResizeAnchor(resizeAnchor, 12, 0)', context),
    fill: () => { limit = 20_000; },
    moveSection: () => { sectionTop += 300; },
    reflow: () => { localTop += 120; },
    frame: () => frames.shift()?.(),
    drain: () => { let n = 0; while (frames.length) { if (++n > 20) throw new Error('Unbounded settle'); frames.shift()?.(); } },
    targetTop: () => sectionTop - top + localTop,
    queued: () => frames.length,
  };
}

describe('a browsed passage returns to the upper visible edge after resize (#319)', () => {
  it('without restoration, filling more scroll room leaves the old clamped target near the bottom', () => {
    const p = page();
    p.fill();
    p.drain();
    expect(p.targetTop()).toBe(500);
  });

  it('corrects the section-end clamp after the neighbouring section fills', () => {
    const p = page();
    p.start();
    expect(p.targetTop()).toBe(400); // initially clamped near the viewport bottom
    p.fill();
    p.frame();
    expect(p.targetTop()).toBe(54);
    p.moveSection(); // later frame layout still must not move the passage
    p.frame();
    expect(p.targetTop()).toBe(54);
    p.reflow();
    p.drain();
    expect(p.targetTop()).toBe(54);
    expect(p.context.resizeAnchor).toBeNull();
    expect(p.locationOf).toHaveBeenCalledWith('epubcfi-target');
  });

  it('never fights a new user gesture or a newer resize anchor', () => {
    for (const next of [null, { cfi: 'new-place', section: 16 }]) {
      const p = page();
      p.start();
      p.nudge.mockClear();
      p.context.resizeAnchor = next;
      p.fill();
      p.drain();
      expect(p.nudge).not.toHaveBeenCalled();
    }
  });

  it('leaves Following to the speech placement, not the browsing anchor', () => {
    const p = page();
    p.context.browsing = false;
    p.start();
    expect(p.nudge).not.toHaveBeenCalled();
    expect(p.queued()).toBe(0);
  });

  it('stops after its bounded frame budget when the document cannot scroll far enough', () => {
    const p = page();
    p.start();
    p.drain();
    expect(p.queued()).toBe(0);
    expect(p.context.resizeAnchor).toBeNull();
    expect(p.nudge.mock.calls.length).toBeLessThanOrEqual(13);
  });
});
