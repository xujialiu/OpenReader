import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { highlighterSource } from '../../src/renderer/highlighter';

/**
 * Where the page puts a sentence whose Clip has no Word Timings (#197).
 *
 * The program's own `boxOf`, `visibleOf`, `lineAt` and `moveFor`, cut from the
 * source the WebView runs and evaluated in node:vm. Doubled: the scroll
 * container (its height and its top at 0), the section's iframe (at 0) and one
 * Range as tall as the sentence, drawn 900 px down the document. Nothing is
 * scrolled: the test applies the move moveFor returns and reads where the
 * sentence would then be. The page and Player sizes are ADR 0050's, measured on
 * the iPhone 17 simulator: a 758 px container and a 134.67 px open Player.
 */

const program = highlighterSource();

function fn(name: string): string {
  const from = program.indexOf('  function ' + name + '(');
  if (from < 0) throw new Error('the page program has no function ' + name);
  const next = program.indexOf('\n  function ', from + 1);
  return program.slice(from, next < 0 ? undefined : next);
}

const CONTAINER = 758;
const PLAYER = 134.67;
const LINE = 36;
const DRAWN_AT = 900;

interface Page {
  /** The Line Position, as a share of the page between the bar's room and the open Player. */
  share: number;
  lines: number;
  /** What the Player covers now; the open Player's height unless it is collapsed. */
  covered?: number;
  /** What the bar covers now, and the room kept for it. */
  bar?: number;
}

function place({ share, lines, covered = PLAYER, bar = 0 }: Page) {
  const height = lines * LINE;
  const move = vm.runInNewContext(
    [
      `var covered = ${covered}; var openPlayer = ${PLAYER}; var barCovered = ${bar}; var barReserved = ${bar};`,
      `var LINE_POSITION = ${share};`,
      `var view = { clientHeight: ${CONTAINER}, getBoundingClientRect: function () { return { top: 0 }; } };`,
      'function scroller() { return view; }',
      'var frame = { getBoundingClientRect: function () { return { top: 0 }; } };',
      `var range = { getBoundingClientRect: function () { return { top: ${DRAWN_AT}, bottom: ${DRAWN_AT + height}, height: ${height} }; } };`,
      'var built = { window: { frameElement: frame }, ranges: [range] };',
      ...['boxOf', 'visibleOf', 'lineAt', 'moveFor'].map(fn),
      'moveFor({ whole: built });',
    ].join('\n'),
  ) as number;
  const top = DRAWN_AT - move;
  return {
    top,
    bottom: top + height,
    middle: top + height / 2,
    /** Where lineAt puts the Line Position: measured with the open Player, without notes. */
    line: bar + (CONTAINER - bar - PLAYER) * share,
    seenFrom: bar,
    seenTo: CONTAINER - covered,
  };
}

describe('a sentence without Word Timings is held at the Line Position, above the Player (#197)', () => {
  it.each([
    [0.8, 8],
    [0.8, 10],
    [0.8, 14],
    [0.7, 14],
    [0.6, 17],
  ])('at %d with %d lines, it ends at the open Player\u2019s top rather than behind it', (share, lines) => {
    // Each fits above the Player (at most 17 lines, 612 of the 623.33 px seen),
    // and its middle at the Line Position would put its last lines behind it.
    const at = place({ share, lines });
    expect(at.line + (lines * LINE) / 2).toBeGreaterThan(at.seenTo + 1);
    expect(at.bottom).toBeCloseTo(at.seenTo, 5);
    expect(at.top).toBeGreaterThanOrEqual(at.seenFrom);
  });

  it.each([
    [0.5, 14],
    [0.5, 17],
    [0.8, 6],
  ])('at %d with %d lines, which already ends above the Player, its middle stays at the Line Position', (share, lines) => {
    const at = place({ share, lines });
    expect(at.middle).toBeCloseTo(at.line, 5);
    expect(at.bottom).toBeLessThanOrEqual(at.seenTo);
  });

  it('keeps the middle at the Line Position while the Player is collapsed and the end can be seen below it', () => {
    // The Line Position is measured with the Player open (#71); what can be seen
    // is what the collapsed Player leaves, so 10 lines at 80 % end in sight.
    const at = place({ share: 0.8, lines: 10, covered: 60 });
    expect(at.bottom).toBeLessThanOrEqual(at.seenTo);
    expect(at.middle).toBeCloseTo(at.line, 5);
  });

  it.each([0.5, 0.8])('at %d, a sentence taller than what can be seen starts at the top of it (ADR 0011)', (share) => {
    // 20 lines, 720 px, of 623.33 px seen: its opening words, the ones about to
    // be spoken, are what must be in sight. At 80 % its middle at the Line
    // Position put its top 138.66 px down and its last 6.5 lines out of sight.
    expect(place({ share, lines: 20 }).top).toBeCloseTo(0, 5);
    // Below the bar while it is shown (#67).
    const barred = place({ share, lines: 20, bar: 54 });
    expect(barred.top).toBeCloseTo(54, 5);
  });
});
