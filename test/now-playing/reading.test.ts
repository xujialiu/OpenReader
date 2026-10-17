import { describe, expect, it } from 'vitest';

import { contentsOf, EMPTY_CONTENTS } from '../../src/core/document/contents';
import { chapterOf, intentOf } from '../../src/now-playing/reading';
import { chapter, XIANNI_NAVIGATION, XIANNI_SPINE } from '../core/document/contents-fixture';

/**
 * The two decisions the lock screen makes (ADR 0016).
 *
 * Everything else in `src/now-playing/` is a sequence of calls into `MediaPlayer`
 * that needs a device to mean anything — `test/README.md` is explicit that native
 * modules are not tested in this suite by design, and a fake `MPNowPlayingInfoCenter`
 * would prove the fake was called. What is here is the part that runs under Node,
 * and it is the part that can be wrong while everything compiles: a lock screen
 * naming the wrong chapter, and a headphone tap doing the opposite of what the
 * screen thinks.
 */

const book = contentsOf(XIANNI_NAVIGATION, XIANNI_SPINE);

describe('what the lock screen’s second line says', () => {
  it('names the chapter being read when exactly one row names it', () => {
    // Spine 4 is `Text/chapter2.xhtml`, which `num_4` names and nothing else does.
    expect(chapterOf(book, { sectionIndex: chapter(2) })).toBe('第1章 离乡');
    expect(chapterOf(book, { sectionIndex: chapter(55) })).toBe('第54章 四年');
  });

  it('names the volume when the reading is on the volume’s own title page', () => {
    // A heading is also somewhere the reading can be: the book puts a title page
    // at the start of each volume, and that page is the heading's own href.
    expect(chapterOf(book, { sectionIndex: chapter(1) })).toBe('第一卷 平庸少年');
  });

  it('says nothing when no row names the section — which is ordinary, not a malformed book', () => {
    // Spine item 1 is `Text/copyright.xhtml`, the one of the owner's 2,077 that no
    // navPoint names. `currentRow` answers 'before' and reports the **cover**. A
    // marked row in a list the owner has just opened is read as "about here";
    // "封面" printed on a lock screen while chapter 41 is being read is a
    // statement, and it is false. So the line is left empty instead.
    expect(chapterOf(book, { sectionIndex: 1 })).toBe('');
  });

  it('says nothing before a Clip has played, and nothing for a book with no contents', () => {
    expect(chapterOf(book, null)).toBe('');
    expect(chapterOf(EMPTY_CONTENTS, { sectionIndex: 4 })).toBe('');
  });

  it('says nothing rather than a blank line when the book wrote a row with no label', () => {
    // A blank second line on a lock screen is indistinguishable from a bug in this
    // function, so an empty label is the same answer as no row.
    const unlabelled = contentsOf([{ id: 'a', href: 'Text/cover.xhtml', label: '   ', subitems: [] }], XIANNI_SPINE);
    expect(chapterOf(unlabelled, { sectionIndex: 0 })).toBe('');
  });
});

/**
 * #212: the Gutenberg Pride and Prejudice puts its chapters into a few files, all
 * at one level, and the line named the first chapter of the file for 56 of its
 * 61 chapters. Shaped like it: three sibling chapters in one file.
 */
describe('the line for a file several chapters share (#212)', () => {
  const siblings = contentsOf(
    [
      { id: 'a', href: '/f0.xhtml#a', label: 'Chapter I.' },
      { id: 'b', href: '/f0.xhtml#b', label: 'Chapter II.' },
      { id: 'c', href: '/f0.xhtml#c', label: 'Chapter III.' },
    ],
    ['f0.xhtml'],
  );
  const anchors = new Map([['a', 0], ['b', 5], ['c', 9]]);

  it('names the chapter being read once the page has said where each starts', () => {
    expect(chapterOf(siblings, { sectionIndex: 0, block: 0, anchors })).toBe('Chapter I.');
    expect(chapterOf(siblings, { sectionIndex: 0, block: 6, anchors })).toBe('Chapter II.');
    expect(chapterOf(siblings, { sectionIndex: 0, block: 9, anchors })).toBe('Chapter III.');
  });

  it('does not name Chapter I. while the reading may be in Chapter II. or III.', () => {
    // The issue's own repro: the file alone is known.
    expect(chapterOf(siblings, { sectionIndex: 0 })).toBe('');
    expect(chapterOf(siblings, { sectionIndex: 0, block: 6, anchors: null })).toBe('');
  });

  it('still names a part whose chapters share its file, which does contain the reading', () => {
    const part = contentsOf(
      [{ id: 'p', href: 'f0.xhtml', label: 'Part One', subitems: [
        { id: 'c1', href: 'f0.xhtml#c1', label: 'Chapter 1' },
        { id: 'c2', href: 'f0.xhtml#c2', label: 'Chapter 2' },
      ] }, { id: 'q', href: 'f1.xhtml', label: 'Part Two' }],
      ['f0.xhtml', 'f1.xhtml'],
    );
    expect(chapterOf(part, { sectionIndex: 0 })).toBe('Part One');
    expect(chapterOf(part, { sectionIndex: 0, block: 7, anchors: new Map([['c1', 1], ['c2', 6]]) })).toBe('Chapter 2');
  });

  it('says nothing when a sibling of the part shares its file', () => {
    const mixed = contentsOf(
      [{ id: 'p', href: 'f0.xhtml', label: 'Part One', subitems: [{ id: 'c1', href: 'f0.xhtml#c1', label: 'Chapter 1' }] },
        { id: 'q', href: 'f0.xhtml#q', label: 'Part Two' }],
      ['f0.xhtml'],
    );
    expect(chapterOf(mixed, { sectionIndex: 0 })).toBe('');
  });
});

describe('what a remote button is asking for', () => {
  it('resolves a toggle against whether the reading is running', () => {
    // `togglePlayPause` is what AirPods single-tap and most car head units send —
    // the command `react-native-audio-api` never registers (ADR 0016) — and it
    // carries no direction.
    expect(intentOf('toggle', true)).toBe('pause');
    expect(intentOf('toggle', false)).toBe('play');
  });

  it('honours an explicit press even when this side disagrees about what is happening', () => {
    // A lock screen showing Play offers `play`. Turning it into a pause because
    // "we think we are playing" is what would make a disagreement between the two
    // permanent instead of self-correcting.
    expect(intentOf('play', true)).toBe('play');
    expect(intentOf('pause', false)).toBe('pause');
  });
});
