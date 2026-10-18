import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { GLIDE_SOURCE } from '../../src/renderer/glide';
import { highlighterSource } from '../../src/renderer/highlighter';

/**
 * The real page-program approach/glide/drift and nudge, against a whole-pixel,
 * clamped scroll container and an explicit frame queue (#196). Only geometry,
 * epub.js's scrollBy and the browser's frame scheduling are doubled; no WebKit
 * or native power-use claim is made here.
 */
const source = highlighterSource();
function fn(name: string): string {
  const from = source.indexOf(`  function ${name}(`);
  if (from < 0) throw new Error(`No page function ${name}`);
  const next = source.indexOf('\n  function ', from + 1);
  return source.slice(from, next < 0 ? undefined : next);
}

interface Page {
  aim(target: number): void;
  run(max?: number): number;
  grow(max: number): void;
  growAtEdge(): void;
  read(): { top: number; pending: number; nudges: number; speed: number; owed: number };
}
function page(top = 0, max = 5000, mode = 'continuous'): Page {
  return vm.runInNewContext(`(function () {
    ${GLIDE_SOURCE}
    var FRAME_MS = 1000 / 60, DRIFT_RESTS = 0.002, SCROLLING = ${JSON.stringify(mode)};
    var drifting = null, driftFrame = 0, glide = null, glideFrame = 0, followed = null;
    var state = { follow: true }, browsing = false, ownTop = null, scrolledTop = null;
    var top = ${top}, max = ${max}, target = top, nudges = 0, growAtEdge = false;
    var stage = { clientHeight: 600,
      get scrollTop() { return top; },
      get scrollHeight() { return max + 600; }
    };
    function scroller() { return stage; }
    function visibleOf() { return 600; }
    function moveFor() { return target - top; }
    var rendition = { manager: { scrollBy: function (x, by, ignore) {
      if (ignore) throw new Error('epub.js must receive the scroll');
      nudges++;
      top = Math.round(Math.max(0, Math.min(max, top + by)));
      // A manager may append a chapter during a scroll. A newly enlarged range
      // must not be mistaken for the end of the Document.
      if (growAtEdge && top === max) { max += 500; growAtEdge = false; }
    } } };
    var frames = new Map(), serial = 0, now = 0;
    var window = {
      requestAnimationFrame: function (callback) { frames.set(++serial, callback); return serial; },
      cancelAnimationFrame: function (id) { frames.delete(id); }
    };
    ${['nudge', 'halt', 'bring', 'glideStep', 'steer', 'kick', 'rest', 'drift', 'approach'].map(fn).join('\n')}
    return {
      aim: function (next) {
        target = next;
        approach({ line: { doc: 1, top: 0, height: 36, block: 1 }, lead: 0 });
      },
      run: function (maxFrames) {
        var count = 0;
        while (frames.size && count < (maxFrames === undefined ? 600 : maxFrames)) {
          var entry = frames.entries().next().value;
          frames.delete(entry[0]);
          now += FRAME_MS;
          entry[1](now);
          count++;
        }
        return count;
      },
      grow: function (next) { max = next; },
      growAtEdge: function () { growAtEdge = true; },
      read: function () { return { top: top, pending: frames.size, nudges: nudges,
        speed: drifting ? drifting.speed : 0, owed: drifting ? drifting.owed : 0 }; }
    };
  })()`) as Page;
}

function rested(p: Page) {
  expect(p.run()).toBeLessThan(120);
  expect(p.read()).toMatchObject({ pending: 0, speed: 0, owed: 0 });
  const before = p.read();
  expect(p.run(36000)).toBe(0); // A paused page has no perpetual frame work.
  expect(p.read()).toEqual(before);
}

describe('Continuous rests at a clamped document boundary (#196)', () => {
  it.each([
    [0, -250], [5000, 5250], [100, -250], [4900, 5250],
  ])('from %d towards unreachable %d, the glide hands off to a drift that rests', (top, target) => {
    const p = page(top);
    p.aim(target);
    rested(p);
    expect(p.read().top).toBe(target < 0 ? 0 : 5000);
  });

  it('rests when the entire Document fits without scrolling', () => {
    const p = page(0, 0);
    p.aim(250);
    rested(p);
    expect(p.read().top).toBe(0);
  });

  it('control: a reachable line still arrives', () => {
    const p = page();
    p.aim(100);
    rested(p);
    expect(p.read().top).toBeCloseTo(100, 0);
  });

  it('does not confuse subpixel accumulation with a blocked page', () => {
    const p = page(100);
    p.aim(108);
    p.run(1);
    expect(p.read().top).toBe(100);
    expect(p.read().pending).toBeGreaterThan(0);
    rested(p);
    expect(Math.abs(p.read().top - 108)).toBeLessThanOrEqual(1);
  });

  it('a new target wakes the rested follower', () => {
    const p = page();
    p.aim(-250);
    rested(p);
    p.aim(100);
    rested(p);
    expect(p.read().top).toBeCloseTo(100, 0);
  });

  it('a layout change can make the same target reachable', () => {
    const p = page(5000);
    p.aim(5250);
    rested(p);
    p.grow(6000);
    p.aim(5250);
    rested(p);
    expect(p.read().top).toBeCloseTo(5250, 0);
  });

  it('still scrolls through the manager and notices a section appended at the edge', () => {
    const p = page(5000);
    p.growAtEdge();
    p.aim(5020);
    rested(p);
    expect(Math.abs(p.read().top - 5020)).toBeLessThanOrEqual(1);
    expect(p.read().nudges).toBeGreaterThan(1);
  });

  it('control: By line starts no persistent drift either', () => {
    const p = page(0, 5000, 'line');
    p.aim(-250);
    rested(p);
  });
});
