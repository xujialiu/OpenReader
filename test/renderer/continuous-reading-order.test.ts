import vm from 'node:vm';
import { expect, it } from 'vitest';
import { GLIDE_SOURCE } from '../../src/renderer/glide';
import { highlighterSource } from '../../src/renderer/highlighter';

const program = highlighterSource();
const geometry = program.slice(program.indexOf('  function lineOf('), program.indexOf('  function middleOf('));

// Two lines of four text fragments each. Their logical indices stay fixed while
// their physical positions change. A DOM range returns only its selected text.
it.each([
  ['LTR', [0, 1, 2, 3]], ['RTL', [3, 2, 1, 0]], ['embedded LTR run', [3, 1, 2, 0]],
] as const)('advances with the spoken words on a %s line (#199)', (_label, order) => {
  const rects = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => {
    const offset = start + i;
    const top = Math.floor(offset / 4) * 40;
    const left = order[offset % 4] * 20;
    return { top, bottom: top + 32, height: 32, left, right: left + 20, width: 20 };
  });
  const parts = [{ at: 0, len: 2, node: 0 }, { at: 2, len: 6, node: 2 }];
  function createRange() {
    let start = 0, end = 0;
    return {
      setStart(node: number, offset: number) { start = node + offset; },
      setEnd(node: number, offset: number) { end = node + offset; },
      getClientRects: () => rects(start, end),
    };
  }
  const liveBlock = () => ({ parts, document: { createRange } });
  const measure = vm.runInNewContext(GLIDE_SOURCE + geometry + '\nleadOf', { liveBlock }) as
    (ranges: { block: string; start: number }[], line: object) => number;
  const leads = Array.from({ length: 8 }, (_, start) =>
    measure([{ block: 'b', start }], { index: 0, ...rects(start, start + 1)[0] }));
  expect(leads).toEqual([0, 10, 20, 30, 0, 10, 20, 30]);
});
