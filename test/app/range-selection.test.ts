import { describe, expect, it } from 'vitest';
import { beginSweep, edgeSpeed, rowAt, rowChapters, sweepTo } from '../../src/app/range-selection';
import type { Chapter } from '../../src/offline/model';

const chapter = (id: string, parent: string | null = null, textCount = 5): Chapter =>
  ({ id, title: id, depth: parent ? 1 : 0, parent, texts: [], textCount, prepared: true });

describe('what crossing a row selects (#57)', () => {
  const plan = [chapter('v1', null, 0), chapter('a', 'v1'), chapter('b', 'v1'), chapter('v2', null, 3), chapter('c', 'v2'), chapter('d')];
  const all = new Set(['a', 'b', 'v2', 'c', 'd']);
  it('a chapter row stands for itself, and one that cannot be chosen for nothing', () => {
    expect(rowChapters([plan[1], plan[5]], plan, new Set(), all)).toEqual([['a'], ['d']]);
    expect(rowChapters([plan[1], plan[5]], plan, new Set(), new Set(['d']))).toEqual([[], ['d']]);
  });
  it('an expanded volume stands only for its own text, since its chapters are rows of their own', () => {
    expect(rowChapters([plan[0], plan[3]], plan, new Set(), all)).toEqual([[], ['v2']]);
  });
  it('a collapsed volume stands for everything folded under it that can be chosen', () => {
    expect(rowChapters([plan[0], plan[3]], plan, new Set(['v1', 'v2']), all)).toEqual([['a', 'b'], ['v2', 'c']]);
    expect(rowChapters([plan[0]], plan, new Set(['v1']), new Set(['b']))).toEqual([['b']]);
  });
});

describe('a sweep (#57)', () => {
  const rows = [['r0'], ['r1'], [], ['r3'], ['r4', 'r5'], ['r6']];
  it('selects every row from where it began to the row under the fingers, and gives rows back when they move back', () => {
    const sweep = beginSweep(rows, 1, new Set());
    expect([...sweepTo(rows, sweep, 4)].sort()).toEqual(['r1', 'r3', 'r4', 'r5']);
    expect([...sweepTo(rows, sweep, 3)].sort()).toEqual(['r1', 'r3']);
  });
  it('turns round past where it began', () => {
    const sweep = beginSweep(rows, 3, new Set());
    expect([...sweepTo(rows, sweep, 0)].sort()).toEqual(['r0', 'r1', 'r3']);
  });
  it('adds to what earlier sweeps selected', () => {
    const sweep = beginSweep(rows, 3, new Set(['r0']));
    expect([...sweepTo(rows, sweep, 4)].sort()).toEqual(['r0', 'r3', 'r4', 'r5']);
  });
  it('takes rows out when it begins on a selected row', () => {
    const before = new Set(['r1', 'r3', 'r4', 'r5']);
    const sweep = beginSweep(rows, 3, before);
    expect(sweep.select).toBe(false);
    expect([...sweepTo(rows, sweep, 5)].sort()).toEqual(['r1']);
  });
  it('adds when it begins on a row only partly selected, or on one that stands for nothing', () => {
    expect(beginSweep(rows, 4, new Set(['r4'])).select).toBe(true);
    expect(beginSweep(rows, 2, new Set(['r1', 'r3'])).select).toBe(true);
  });
  it('keeps to the rows there are', () => {
    const sweep = beginSweep(rows, 4, new Set());
    expect([...sweepTo(rows, sweep, 99)].sort()).toEqual(['r4', 'r5', 'r6']);
  });
});

describe('finding the row under the fingers (#57)', () => {
  const extents = [{ top: 0, height: 62 }, { top: 62, height: 82 }, undefined, { top: 206, height: 62 }];
  it('names the row whose extent holds the point', () => {
    expect(rowAt(extents, 0)).toBe(0);
    expect(rowAt(extents, 61.9)).toBe(0);
    expect(rowAt(extents, 62)).toBe(1);
    expect(rowAt(extents, 230)).toBe(3);
  });
  it('takes the nearest laid-out row above the first, below the last, and over a row never laid out', () => {
    expect(rowAt(extents, -40)).toBe(0);
    expect(rowAt(extents, 900)).toBe(3);
    expect(rowAt(extents, 150)).toBe(1);
    expect(rowAt(extents, 200)).toBe(3);
  });
  it('finds nothing in a list with nothing laid out', () => {
    expect(rowAt([undefined, undefined], 10)).toBe(-1);
  });
});

describe('scrolling by itself at the edges (#57)', () => {
  it('is still away from the edges and faster the deeper into either band, up to the fastest', () => {
    expect(edgeSpeed(165, 330, 44, 1000)).toBe(0);
    expect(edgeSpeed(44, 330, 44, 1000)).toBe(0);
    expect(edgeSpeed(22, 330, 44, 1000)).toBe(-500);
    expect(edgeSpeed(-30, 330, 44, 1000)).toBe(-1000);
    expect(edgeSpeed(330 - 11, 330, 44, 1000)).toBe(750);
    expect(edgeSpeed(400, 330, 44, 1000)).toBe(1000);
  });
});
