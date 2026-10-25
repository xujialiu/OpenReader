import { describe, expect, it } from 'vitest';

import { chapterEnd, countdown, sleepChoices, sleepLabel, type ChapterWalk } from '../../src/app/sleep-timer';
import { contentsOf } from '../../src/core/document/contents';

/**
 * Where the Sleep Timer's current chapter ends (#326): the last sentence before
 * the Reading would go on into another Contents row by itself, by the rule the
 * Contents marks its row with.
 */

const SPINE = ['cover.xhtml', 'one.xhtml', 'two.xhtml', 'copyright.xhtml', 'three.xhtml'];

/** Utterances by `[section, block]`, one per Block unless a Block is listed twice. */
function walk(
  places: readonly [number, number][],
  from: number,
  options: { ended?: boolean; anchors?: [number, Record<string, number>][]; navigation?: { href: string; label: string }[] } = {},
): ChapterWalk {
  const navigation = (options.navigation ?? [
    { href: 'one.xhtml', label: 'One' },
    { href: 'two.xhtml', label: 'Two' },
    { href: 'three.xhtml', label: 'Three' },
  ]).map((entry, i) => ({ id: `n${i}`, ...entry }));
  return {
    from,
    through: places.length,
    ended: options.ended ?? false,
    placeOf: (at) => (places[at] ? { section: places[at][0], block: places[at][1] } : { section: null, block: null }),
    anchors: new Map((options.anchors ?? []).map(([section, starts]) => [section, new Map(Object.entries(starts))])),
    rows: contentsOf(navigation, SPINE).rows,
  };
}

describe('the end of the current chapter', () => {
  it('is the last sentence of a chapter that is its own file', () => {
    const places: [number, number][] = [[1, 0], [1, 1], [1, 2], [2, 0], [2, 1]];
    expect(chapterEnd(walk(places, 0))).toBe(2);
    expect(chapterEnd(walk(places, 2))).toBe(2);
  });

  it('is where the next chapter starts inside a file that holds several', () => {
    const places: [number, number][] = [[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [2, 0]];
    const w = walk(places, 1, {
      navigation: [{ href: 'one.xhtml#a', label: 'One' }, { href: 'one.xhtml#b', label: 'One, part two' }, { href: 'two.xhtml', label: 'Two' }],
      anchors: [[1, { a: 0, b: 3 }]],
    });
    expect(chapterEnd(w)).toBe(2);
    expect(chapterEnd({ ...w, from: 3 })).toBe(4);
  });

  it('takes in a page the Contents does not list, as part of the row before it', () => {
    const places: [number, number][] = [[2, 0], [2, 1], [3, 0], [3, 1], [4, 0]];
    expect(chapterEnd(walk(places, 0))).toBe(3);
  });

  it('ends the text before the first row where that row starts', () => {
    const places: [number, number][] = [[0, 0], [0, 1], [1, 0]];
    expect(chapterEnd(walk(places, 0))).toBe(1);
  });

  it('is not known while the text laid out so far is all in the row', () => {
    const places: [number, number][] = [[1, 0], [1, 1], [1, 2]];
    expect(chapterEnd(walk(places, 0))).toBeNull();
  });

  it('is the last sentence of the Document when the row runs to its end', () => {
    const places: [number, number][] = [[4, 0], [4, 1], [4, 2]];
    expect(chapterEnd(walk(places, 1, { ended: true }))).toBe(2);
  });
});

describe('the menu and the button', () => {
  it('offers the chapter first, and only with a Contents to end a row of', () => {
    expect(sleepChoices(true).map(sleepLabel)).toEqual([
      'When Current Chapter Ends', '5 Minutes', '10 Minutes', '15 Minutes', '30 Minutes', '45 Minutes', '1 Hour',
    ]);
    expect(sleepChoices(false)).not.toContain('chapter');
  });

  it('counts down in minutes and seconds, rounded up', () => {
    expect(countdown(60 * 60_000)).toBe('60:00');
    expect(countdown(29 * 60_000 + 40_200)).toBe('29:41');
    expect(countdown(400)).toBe('0:01');
    expect(countdown(0)).toBe('0:00');
    expect(countdown(-5)).toBe('0:00');
  });
});
