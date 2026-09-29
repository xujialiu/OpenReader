import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTENTS,
  contentsOf,
  currentRow,
  rowOfSection,
  type Contents,
  type NavigationEntry,
} from '../../../src/core/document/contents';
import {
  THREE_LEVELS,
  THREE_LEVELS_SPINE,
  XIANNI_NAVIGATION,
  XIANNI_SPINE,
  XIANNI_VOLUME_SIZES,
  chapter,
  navigationOfMeasuredShape,
} from './contents-fixture';

/**
 * ADR 0020's contents list, against the book it was designed for.
 *
 * "With the progress bar gone this is the only thing that answers 'where am I',
 * so being subtly wrong here is the expensive defect." Every case below that
 * concerns `currentRow` is therefore about the *precision* of the answer as much
 * as the answer, and the two cases the model refuses to resolve — a spine item
 * several entries name, and an href no spine item matches — get more space than
 * the ones it resolves.
 *
 * `contents-fixture.ts` says what was measured, what was sliced out of the real
 * file and what is invented.
 */

const label = (contents: Contents, row: number): string => contents.rows[row].label;
const labels = (contents: Contents): string[] => contents.rows.map((row) => row.label);
const targets = (contents: Contents): (number | null)[] => contents.rows.map((row) => row.target);
const depths = (contents: Contents): number[] => contents.rows.map((row) => row.depth);
const ranges = (contents: Contents): [number, number][] => contents.sections.map((section) => [section.start, section.end]);

/** The reading, in the only currency the contents can use — the shape `ReportedBlock` already has. */
const reading = (sectionIndex: number) => ({ sectionIndex });

describe("the owner's book, flattened", () => {
  const book = contentsOf(XIANNI_NAVIGATION, XIANNI_SPINE);

  it('produces one row per navigation entry, in the document’s own order', () => {
    expect(labels(book)).toEqual([
      '封面',
      '内容介绍',
      '第一卷 平庸少年',
      '第1章 离乡',
      '第2章 仙人',
      '第3章 测试',
      '第4章 无情',
      '第53章 强势',
      '第54章 四年',
      '第二卷 修真血影',
      '第55章 夺基大法',
      '第56章 天水城',
    ]);
  });

  it('nests exactly two levels, which is what the file has and not what it claims', () => {
    // `toc.ncx` declares `<meta name="dtb:depth" content="3"/>` and has two
    // levels. The depth comes from the tree, so the declaration cannot mislead it.
    expect(depths(book)).toEqual([0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1]);
  });

  it('resolves every row to the spine item its href names', () => {
    expect(targets(book)).toEqual([0, 2, 3, chapter(2), chapter(3), chapter(4), chapter(5), chapter(54), chapter(55), chapter(56), chapter(57), chapter(58)]);
    expect(book.unreachable).toBe(0);
  });

  it('makes a volume’s own entry a heading and a destination both', () => {
    // Spine item 3 is `Text/chapter1.xhtml`, the volume's own title page. A
    // heading that carried no target would make it unreachable from the contents.
    expect(book.rows[2].heading).toBe(true);
    expect(book.rows[2].target).toBe(3);
    expect(book.rows[9].heading).toBe(true);
    expect(book.rows[9].target).toBe(chapter(56));
  });

  it('marks nothing else as a heading', () => {
    expect(book.rows.filter((row) => row.heading).map((row) => row.label)).toEqual(['第一卷 平庸少年', '第二卷 修真血影']);
  });

  it('puts the cover and the introduction in one unheaded section, and each volume in its own', () => {
    // The book opens with two top-level entries that have nothing under them.
    // One section between them, with no heading: a sticky header with nothing
    // beneath it is not a heading, and one section per row would make a book with
    // no nesting into two thousand sections.
    expect(ranges(book)).toEqual([
      [0, 2],
      [2, 9],
      [9, 12],
    ]);
    expect(book.rows[book.sections[0].start].heading).toBe(false);
    expect(book.rows[book.sections[1].start].heading).toBe(true);
  });

  it('gives every row the section that contains it', () => {
    expect(book.rows.map((row) => row.section)).toEqual([0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2]);
  });

  it('leaves no row outside a section and no gap between two', () => {
    // The property a list depends on: `sections` tiles `rows` exactly, so
    // rendering section by section renders every row once.
    let at = 0;
    for (const section of book.sections) {
      expect(section.start).toBe(at);
      expect(section.end).toBeGreaterThan(section.start);
      at = section.end;
    }
    expect(at).toBe(book.rows.length);
  });

});

describe('locating the reading in the owner’s book', () => {
  const book = contentsOf(XIANNI_NAVIGATION, XIANNI_SPINE);

  it('names the chapter whose spine item the reading is in', () => {
    const found = currentRow(book, reading(chapter(3)));
    expect(found).toEqual({ row: 4, precision: 'exact' });
    expect(label(book, found!.row)).toBe('第2章 仙人');
  });

  it('names the volume when the reading is in the volume’s own spine item', () => {
    expect(currentRow(book, reading(3))).toEqual({ row: 2, precision: 'exact' });
  });

  it('takes the reading from a Block, which is the only place the spine index comes from', () => {
    // `ReportedBlock` — `{ id, text, role, section, sectionIndex, cfi }` — is
    // accepted as it stands. A bare number would let a row index, a Block ordinal
    // or a spine index be passed interchangeably, and all three would type-check.
    const block = { id: '5.0', text: '……', role: 'paragraph', section: 'Text/chapter3.xhtml', sectionIndex: 5, cfi: '/6/12!/4/2' };
    expect(currentRow(book, block)).toEqual({ row: 4, precision: 'exact' });
  });

  it('reports the cover for the copyright page, which the navigation never mentions', () => {
    // Spine item 1, `Text/copyright.xhtml`, is the one of the book's 2,077 spine
    // items that no `navPoint` names. Measured, not contrived.
    expect(currentRow(book, reading(1))).toEqual({ row: 0, precision: 'before' });
    expect(label(book, 0)).toBe('封面');
  });

  it('reports the nearest row before a spine item no row names', () => {
    // Spine 20 is one of volume one's chapters that this slice drops — an
    // artefact of slicing, which the book itself does not have. It stands in for
    // the general case: a spine item the navigation skips.
    expect(currentRow(book, reading(20))).toEqual({ row: 6, precision: 'before' });
    expect(label(book, 6)).toBe('第4章 无情');
  });

  it('stays on the last row when the reading is past every entry', () => {
    expect(currentRow(book, reading(2076))).toEqual({ row: 11, precision: 'before' });
  });

  it('has no current row when every entry is after the reading', () => {
    // A book whose navigation begins part way into the spine, read from the top.
    const late = contentsOf([{ id: 'a', href: 'Text/chapter1.xhtml', label: 'One', subitems: [] }], XIANNI_SPINE);
    expect(currentRow(late, reading(0))).toBeNull();
    expect(currentRow(late, reading(3))).toEqual({ row: 0, precision: 'exact' });
  });
});

describe('the rule over bare spine items, as the download drawer uses it (#88)', () => {
  it('gives the answer currentRow gives for the same rows', () => {
    const book = contentsOf(XIANNI_NAVIGATION, XIANNI_SPINE);
    const targets = book.rows.map((row) => row.target);
    for (const at of [0, 1, 3, 5, 20, 2076]) expect(rowOfSection(targets, at)).toEqual(currentRow(book, reading(at)));
  });
  it('passes over rows that name no spine item', () => {
    expect(rowOfSection([null, 2, null, 4], 3)).toEqual({ row: 1, precision: 'before' });
    expect(rowOfSection([null, null], 3)).toBeNull();
  });
});

describe('a book whose navigation is empty', () => {
  // ADR 0020: epub.js "prefers navPath, falls back to ncxPath, and a book with
  // neither yields an empty Navigation that resolves normally rather than an
  // error". So this is an ordinary book, not a broken one.
  const nothing = contentsOf([], XIANNI_SPINE);

  it('produces something a list can render rather than an error', () => {
    expect(nothing).toEqual(EMPTY_CONTENTS);
  });

  it('has no current row anywhere in the document', () => {
    expect(currentRow(nothing, reading(0))).toBeNull();
    expect(currentRow(nothing, reading(1500))).toBeNull();
  });
});

describe('a book with one level', () => {
  const flat: NavigationEntry[] = [
    { id: 'a', href: 'Text/cover.xhtml', label: 'Cover', subitems: [] },
    { id: 'b', href: 'Text/chapter1.xhtml', label: 'One', subitems: [] },
    { id: 'c', href: 'Text/chapter2.xhtml', label: 'Two', subitems: [] },
  ];
  const contents = contentsOf(flat, XIANNI_SPINE);

  it('is one unheaded section holding every row', () => {
    expect(ranges(contents)).toEqual([[0, 3]]);
    expect(contents.rows.some((row) => row.heading)).toBe(false);
    expect(depths(contents)).toEqual([0, 0, 0]);
  });

  it('still locates the reading', () => {
    expect(currentRow(contents, reading(4))).toEqual({ row: 2, precision: 'exact' });
  });
});

describe('a book with three levels, and a file holding several chapters', () => {
  const contents = contentsOf(THREE_LEVELS, THREE_LEVELS_SPINE);

  it('flattens the third level as rows rather than as more sections', () => {
    expect(depths(contents)).toEqual([0, 0, 1, 2, 2, 1, 0, 1, 0]);
    expect(labels(contents)).toEqual([
      'Cover',
      'Part One',
      'Chapter One',
      'A first section',
      'A second section',
      'Chapter Two',
      'Part Two',
      'Chapter Three',
      'Appendix',
    ]);
  });

  it('opens a new unheaded section for a childless entry that follows a heading', () => {
    // Without this the Appendix would be rendered inside Part Two, which is not
    // where the document put it.
    expect(ranges(contents)).toEqual([
      [0, 1],
      [1, 6],
      [6, 8],
      [8, 9],
    ]);
    expect(contents.rows.map((row) => row.heading)).toEqual([false, true, false, false, false, false, true, false, false]);
  });

  it('drops the fragment, so five rows land on one spine item', () => {
    expect(targets(contents)).toEqual([0, 1, 1, 1, 1, 1, 3, 3, null]);
    expect(contents.rows[2].href).toBe('part1.xhtml#ch1');
  });

  it('names the first of the rows sharing a spine item, and says the answer is coarse', () => {
    // The reading could be under any of the five. Which one needs the rendered
    // document, because a fragment names an element. The coarse answer that
    // contains the reading beats the precise one that might not.
    expect(currentRow(contents, reading(1))).toEqual({ row: 1, precision: 'shared' });
    expect(label(contents, 1)).toBe('Part One');
  });

  it('says `exact` only when one row names the spine item', () => {
    expect(currentRow(contents, reading(0))).toEqual({ row: 0, precision: 'exact' });
    // Two rows name spine 3: Part Two and the chapter inside it.
    expect(currentRow(contents, reading(3))).toEqual({ row: 6, precision: 'shared' });
  });

  it('reports a row before, not a row sharing, when the spine item has no row of its own', () => {
    // `notes.xhtml` is spine item 2 and no entry names it. Five rows name spine
    // 1, but `before` is the honest word: the reading is not in any of them.
    expect(currentRow(contents, reading(2))).toEqual({ row: 1, precision: 'before' });
  });

  it('counts the row whose href is in no spine item, and keeps the href it could not resolve', () => {
    expect(contents.unreachable).toBe(1);
    expect(contents.rows[8].target).toBeNull();
    // Kept so that an unreachable row can be reported rather than merely being
    // dead. It is never handed to a seek: `goTo` takes a CFI, `goToSection` takes
    // an index, and an href is neither.
    expect(contents.rows[8].href).toBe('appendix.xhtml');
    // Still a row: dropping it would lose the Appendix from the list entirely.
    expect(label(contents, 8)).toBe('Appendix');
  });

  it('never returns an unreachable row as the current one', () => {
    expect(currentRow(contents, reading(9))).toEqual({ row: 6, precision: 'before' });
  });
});

describe('what the library actually hands over, which is not what its type says', () => {
  it('survives an id that is the boolean false', () => {
    // epub.js `ncxItem`: `var id = item.getAttribute('id') || false`. A navPoint
    // with no id yields `false`, and the library's own type says `id: string`.
    const entry = { id: false, href: 'Text/cover.xhtml', label: 'Cover', subitems: [] } as unknown as NavigationEntry;
    const contents = contentsOf([entry], XIANNI_SPINE);
    expect(contents.rows[0].id).toBe('');
    expect(contents.rows[0].target).toBe(0);
  });

  it('trims a label and collapses the whitespace inside it', () => {
    // epub.js hands back `textContent` untouched, so a pretty-printed
    // `<text>` arrives with its own indentation on it.
    const entry: NavigationEntry = { id: 'a', href: 'Text/cover.xhtml', label: '\n      第1章\n      离乡\n    ', subitems: [] };
    expect(contentsOf([entry], XIANNI_SPINE).rows[0].label).toBe('第1章 离乡');
  });

  it('survives a label that is not there', () => {
    // A malformed field costs that field and nothing else — the same asymmetry
    // `library.ts` parses by. A row with no label still points somewhere.
    const entry = { id: 'a', href: 'Text/cover.xhtml', subitems: [] } as unknown as NavigationEntry;
    const contents = contentsOf([entry], XIANNI_SPINE);
    expect(contents.rows[0].label).toBe('');
    expect(contents.rows[0].target).toBe(0);
  });

  it('treats a missing subitems as no children', () => {
    const entry = { id: 'a', href: 'Text/cover.xhtml', label: 'Cover' } as NavigationEntry;
    const contents = contentsOf([entry], XIANNI_SPINE);
    expect(contents.rows).toHaveLength(1);
    expect(contents.rows[0].heading).toBe(false);
  });

  it('skips a subitem that is not there', () => {
    // Older `parseNavList` pushed `navItem`'s undefined return for an `<li>` with
    // neither an `<a>` nor a `<span>` in it.
    const entry = {
      id: 'a',
      href: 'Text/chapter1.xhtml',
      label: 'One',
      subitems: [undefined, { id: 'b', href: 'Text/chapter2.xhtml', label: 'Two', subitems: [] }],
    } as unknown as NavigationEntry;
    expect(labels(contentsOf([entry], XIANNI_SPINE))).toEqual(['One', 'Two']);
  });

  it('reads the nesting from subitems and never from parent', () => {
    // `parent` is an id, and ids are not reliably unique — a navigation document
    // with no ids on its items falls back to the href, so two entries pointing at
    // one file share one. Here every entry claims the wrong parent and the tree is
    // still flattened by its subitems.
    const entry = {
      id: 'a',
      href: 'Text/chapter1.xhtml',
      label: 'One',
      parent: 'nonsense',
      subitems: [{ id: 'a', href: 'Text/chapter2.xhtml', label: 'Two', parent: 'a', subitems: [] }],
    } as unknown as NavigationEntry;
    const contents = contentsOf([entry], XIANNI_SPINE);
    expect(depths(contents)).toEqual([0, 1]);
    expect(contents.rows[0].heading).toBe(true);
  });
});

describe('the spine lookup, which is epub.js’s own table', () => {
  const one = (href: string, spine: readonly string[]) => contentsOf([{ id: 'a', href, label: 'A', subitems: [] }], spine);

  it('matches a percent-encoded spine href against a plain navigation href', () => {
    // `Spine.append` keys the href, `decodeURI` of it and `encodeURI` of it to the
    // same index, so either file may be written on either side of the encoding.
    expect(one('Text/a b.xhtml', ['Text/a%20b.xhtml']).rows[0].target).toBe(0);
  });

  it('matches a plain spine href against a percent-encoded navigation href', () => {
    expect(one('Text/a%20b.xhtml', ['Text/a b.xhtml']).rows[0].target).toBe(0);
  });

  it('does not throw on an escape that cannot be decoded', () => {
    // `decodeURI('Text/a%zz.xhtml')` raises URIError, and epub.js raises it out of
    // `unpack` and loses the book.
    expect(() => one('Text/a%zz.xhtml', ['Text/a%zz.xhtml'])).not.toThrow();
    expect(one('Text/a%zz.xhtml', ['Text/a%zz.xhtml']).rows[0].target).toBe(0);
  });

  it('does not throw on an href that cannot be encoded', () => {
    // A lone surrogate: `encodeURI('\uD800')` raises URIError too.
    expect(() => one('Text/\uD800.xhtml', ['Text/\uD800.xhtml'])).not.toThrow();
    expect(one('Text/\uD800.xhtml', ['Text/\uD800.xhtml']).rows[0].target).toBe(0);
  });

  it('refuses a bare fragment even when a spine item is spelled like it', () => {
    // `Spine.get` reads `#chapter1` as the spine href `chapter1`, which would land
    // on whichever item happens to be spelled that way. A same-document link is
    // not a spine item.
    expect(one('#chapter1', ['chapter1', 'other.xhtml']).rows[0].target).toBeNull();
  });

  it('resolves an href the spine lists twice to the first of them', () => {
    // epub.js's own table keeps the last, because it overwrites. The first is the
    // one in document order, and it is what keeps a row's target from going
    // backwards as the list goes forwards.
    expect(one('Text/a.xhtml', ['Text/b.xhtml', 'Text/a.xhtml', 'Text/c.xhtml', 'Text/a.xhtml']).rows[0].target).toBe(1);
  });

  it('makes every row unreachable while the spine has not arrived', () => {
    // The spine's hrefs cross the bridge in one message at load. Until they do,
    // every row is unreachable — which is a state to say out loud, not a list of
    // rows that quietly do nothing.
    const waiting = contentsOf(XIANNI_NAVIGATION, []);
    expect(waiting.rows).toHaveLength(12);
    expect(waiting.unreachable).toBe(12);
    expect(currentRow(waiting, reading(5))).toBeNull();
  });

  it('makes every row unreachable when the navigation’s hrefs are relative to somewhere else', () => {
    // `toc.ncx` beside `content.opf` is why matching the two as strings works on
    // the owner's book. A navigation one directory down resolves nothing, and it
    // fails as all of the rows rather than one of them.
    const elsewhere = XIANNI_NAVIGATION.map((entry) => ({ ...entry, href: `../${entry.href}`, subitems: [] }));
    const contents = contentsOf(elsewhere, XIANNI_SPINE);
    expect(contents.unreachable).toBe(contents.rows.length);
  });
});

describe('at the book’s full size', () => {
  // The measured shape, 2,076 entries: 15 top-level, 2,061 beneath, volumes of 54
  // to 343 chapters. The labels are invented; nothing here reads one.
  const contents = contentsOf(navigationOfMeasuredShape(), XIANNI_SPINE);

  it('flattens all 2,076 entries', () => {
    expect(contents.rows).toHaveLength(2076);
    expect(contents.unreachable).toBe(0);
  });

  it('merges the two childless entries and gives each of the thirteen volumes a section', () => {
    expect(contents.sections).toHaveLength(14);
    expect(ranges(contents)[0]).toEqual([0, 2]);
    expect(contents.sections.map((section) => section.end - section.start)).toEqual([
      2,
      ...XIANNI_VOLUME_SIZES.slice(2).map((children) => children + 1),
    ]);
  });

  it('keeps the spine order the book has, so nothing was reordered', () => {
    const order = contents.rows.map((row) => row.target!);
    expect(order.every((target, at) => at === 0 || target > order[at - 1])).toBe(true);
    expect(order[0]).toBe(0);
    expect(order[2075]).toBe(2076);
  });

  it('locates the reading at either end and in the middle', () => {
    expect(currentRow(contents, reading(0))).toEqual({ row: 0, precision: 'exact' });
    expect(currentRow(contents, reading(1))).toEqual({ row: 0, precision: 'before' });
    expect(currentRow(contents, reading(2))).toEqual({ row: 1, precision: 'exact' });
    expect(currentRow(contents, reading(1039))).toEqual({ row: 1038, precision: 'exact' });
    expect(currentRow(contents, reading(2076))).toEqual({ row: 2075, precision: 'exact' });
  });
});
