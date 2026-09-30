import { describe, expect, it } from 'vitest';

import { wordCuts } from '../../src/app/name-lines';

/**
 * A long name is cut after a whole word (#87, design 0060): `… The…`, never
 * `… The Lo…`. The lines come from laying the whole name out at its width with
 * no limit, the way `onTextLayout` reports them, trailing space included. The
 * cuts come longest first; `NameText` lays each out in turn and shows the first
 * that fits, because only the layout knows whether the `…` still has room.
 */

const long = ['The First Legendary Beast ', 'Master, Volume Three: The ', 'Long Road Through the ', 'Northern Mountains and Beyond'];

describe('wordCuts', () => {
  it('offers no cut for a name that fits in the lines', () => {
    expect(wordCuts(['A Short Test of Reading Aloud'], 2)).toEqual([]);
    expect(wordCuts(['The First Legendary Beast ', 'Master'], 2)).toEqual([]);
  });

  it('keeps the whole last line first, then gives up one word at a time', () => {
    expect(wordCuts(long, 2)).toEqual([
      'The First Legendary Beast Master, Volume Three: The…',
      'The First Legendary Beast Master, Volume Three…',
      'The First Legendary Beast Master, Volume…',
      'The First Legendary Beast Master…',
    ]);
  });

  it('keeps every line before the last whole', () => {
    expect(wordCuts(long, 3)[0]).toBe('The First Legendary Beast Master, Volume Three: The Long Road Through the…');
  });

  it('does not leave a comma, colon or dash in front of the …', () => {
    expect(wordCuts(['Alpha Beta ', 'Gamma, Delta: ', 'Epsilon'], 2)).toEqual(['Alpha Beta Gamma, Delta…', 'Alpha Beta Gamma…']);
    expect(wordCuts(['Alpha Beta ', 'Gamma \u2014 ', 'Epsilon'], 2)).toEqual(['Alpha Beta Gamma…']);
  });

  it('never cuts inside a word', () => {
    // One word longer than the line, or a name in a script without spaces: the
    // only cut offered is after the whole line, and when that does not fit, the
    // phone's own cut after a letter is the one there is.
    expect(wordCuts(['Alpha ', 'Supercalifragilistic', 'expialidocious'], 2)).toEqual(['Alpha Supercalifragilistic…']);
    expect(wordCuts(['第一次读的书名很长', '第二行还有很多字', '第三行'], 2)).toEqual(['第一次读的书名很长第二行还有很多字…']);
  });
});
