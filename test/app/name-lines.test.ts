import { describe, expect, it } from 'vitest';

import { cutAtWord } from '../../src/app/name-lines';

/**
 * A long name in the Library is cut after a whole word (#87): `… The…`, never
 * `… The Lo…`. The lines come from laying the whole name out at the row's width
 * with no limit, the way `onTextLayout` reports them, trailing space included.
 */

const long = ['The First Legendary Beast ', 'Master, Volume Three: The Long ', 'Road Through the Northern ', 'Mountains and Beyond'];

describe('cutAtWord', () => {
  it('leaves a name that fits in the lines as it is', () => {
    expect(cutAtWord(['A Short Test of Reading Aloud'], 2)).toBeNull();
    expect(cutAtWord(['The First Legendary Beast ', 'Master'], 2)).toBeNull();
  });

  it("ends the last line on the word before the one that made room for the '…'", () => {
    expect(cutAtWord(long, 2)).toBe('The First Legendary Beast Master, Volume Three: The…');
  });

  it('keeps every line before the last whole', () => {
    expect(cutAtWord(long, 3)).toBe('The First Legendary Beast Master, Volume Three: The Long Road Through the…');
  });

  it('does not leave a comma, colon or dash in front of the …', () => {
    expect(cutAtWord(['Alpha Beta ', 'Gamma, Delta ', 'Epsilon'], 2)).toBe('Alpha Beta Gamma…');
    expect(cutAtWord(['Alpha Beta ', 'Gamma: Delta ', 'Epsilon'], 2)).toBe('Alpha Beta Gamma…');
    expect(cutAtWord(['Alpha Beta ', 'Gamma \u2014 Delta ', 'Epsilon'], 2)).toBe('Alpha Beta Gamma…');
  });

  it('drops a one-letter last word together with the word before it, so the … has room', () => {
    expect(cutAtWord(['Alpha ', 'Beta Gamma a ', 'Delta'], 2)).toBe('Alpha Beta…');
  });

  it("leaves the cut to the phone when the last line has no word to drop", () => {
    // One word longer than the line, or a name in a script without spaces:
    // the phone's own cut, after a letter, is the only one there is.
    expect(cutAtWord(['Alpha ', 'Supercalifragilistic', 'expialidocious'], 2)).toBeNull();
    expect(cutAtWord(['第一次读的书名很长', '第二行还有很多字', '第三行'], 2)).toBeNull();
    expect(cutAtWord(['Alpha ', 'Beta a ', 'Gamma'], 2)).toBeNull();
  });
});
