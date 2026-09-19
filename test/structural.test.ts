import { describe, expect, it } from 'vitest';

import { pin, pinCount } from './structural';

/**
 * `structural.ts` is the tool the source-text rules in this suite are read
 * through, and its whole value is in the failure it produces. A guard nobody has
 * watched fire is a comment (`test/README.md`), and this one guards against a
 * test that cannot fail — so if it were itself unable to fail, the hole would be
 * one level up and invisible from either side.
 *
 * The ambiguity case is the one that matters. Four agents shipped an assertion
 * whose marker appeared twice; the point of this file is that the fifth cannot.
 */
describe('pin', () => {
  const text = ['var covered = 0;', 'covered = message.bottomPx;', 'return covered;'].join('\n');

  it('passes when one line answers to the marker', () => {
    expect(() => pin(text, 'covered = message.bottomPx;', 'a program')).not.toThrow();
  });

  it('refuses a marker that is not there, because that is the line the rule guards', () => {
    expect(() => pin(text, 'covered = inset;', 'a program')).toThrow(/no longer contains "covered = inset;"/);
  });

  it('refuses an ambiguous marker, and says which lines made it ambiguous', () => {
    // The defect this file exists for: `covered = ` matches the declaration as
    // well as the assignment, so the assignment could go and the search would
    // still find something. The line numbers are what make the failure
    // actionable — without them the author has to go and count.
    expect(() => pin(text, 'covered = ', 'a program')).toThrow(/contains "covered = " 2 times, at lines 1, 2/);
    expect(() => pin(text, 'covered = ', 'a program')).toThrow(/cannot fail/);
  });

  it('counts occurrences without overlapping them, so a repeated marker is not double-counted', () => {
    // `aaaa` holds two `aa`, not three: an overlapping count would call a
    // single-occurrence marker ambiguous and send the author narrowing a marker
    // that was already the only one of its kind.
    expect(() => pin('aaaa', 'aa', 'a string')).toThrow(/2 times/);
    expect(() => pin('aaa', 'aa', 'a string')).not.toThrow();
  });

  it('names the text in the message, because the marker alone does not say where to look', () => {
    expect(() => pin(text, 'nothing', 'src/renderer/highlighter.ts, function centre')).toThrow(
      /^src\/renderer\/highlighter\.ts, function centre/,
    );
  });
});

describe('pinCount', () => {
  it('passes only on the number that was counted', () => {
    expect(() => pinCount('a\nb\na', 'a', 2, 'a string')).not.toThrow();
    expect(() => pinCount('a\nb\na', 'a', 1, 'a string')).toThrow(/2 times, not 1/);
    expect(() => pinCount('a\nb\na', 'c', 2, 'a string')).toThrow(/0 times, not 2\.$/);
  });
});
