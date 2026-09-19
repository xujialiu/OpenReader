/**
 * The owner's book, as the contents model sees it — derived from the real file,
 * not invented.
 *
 * Source: `仙逆 (耳根).epub`, 34,453,009 bytes, EPUB **2.0**, no navigation
 * document, `toc.ncx` only (412,498 bytes). Measured from the archive members
 * `OEBPS/toc.ncx` and `OEBPS/content.opf` on 2026-09-19:
 *
 * | fact | value |
 * | --- | --- |
 * | `navPoint`s | 2,076 — 15 at the top, 2,061 beneath, nested exactly two levels |
 * | children per top entry | 0, 0, 54, 62, 60, 205, 67, 185, 228, 248, 343, 135, 180, 207, 87 |
 * | labels | 2 to 22 characters, mean 10.7; none padded, none holding a newline, tab or double space |
 * | hrefs carrying a `#fragment` | **0** |
 * | hrefs percent-encoded | **0** |
 * | `navPoint`s sharing an href | **0** — 2,076 distinct |
 * | ids | 2,076 distinct, `num_1` … `num_2076`, in document order |
 * | `playOrder` | strictly increasing |
 * | spine items | 2,077, all `linear="yes"`, all hrefs distinct |
 * | spine items named by no `navPoint` | **1** — index 1, `Text/copyright.xhtml` |
 * | spine index going backwards in document order | **0** times |
 * | the whole navigation as the library posts it | 241,468 UTF-8 bytes |
 * | the spine's hrefs as an array | 50,812 UTF-8 bytes |
 *
 * The `ncx`'s own `<meta name="dtb:depth" content="3"/>` says three levels. The
 * file has two. The declaration is simply wrong, which is why nothing here reads
 * it and the depth is taken from the tree.
 *
 * ## What is kept and what is dropped
 *
 * **The spine is kept whole**, because it compresses to nothing: the 2,077 hrefs
 * are exactly `Text/cover.xhtml`, `Text/copyright.xhtml`,
 * `Text/introduction.xhtml`, then `Text/chapter1.xhtml` … `Text/chapter2074.xhtml`
 * in order — verified member by member against `content.opf`, not inferred from a
 * sample. So every index below is the book's own index, and `Text/chapterN.xhtml`
 * is spine item `N + 2`.
 *
 * **The navigation is a slice**, because 241,468 bytes of real chapter titles do
 * not belong in a repository. Two contiguous windows are kept verbatim — labels,
 * ids and hrefs copied out of `toc.ncx` character for character:
 *
 * - spine 0–7: the cover, the introduction, volume one's own entry and its first
 *   four chapters. This window carries the shapes that matter at the start of a
 *   book: a top-level entry with nothing under it, twice; a top-level entry that
 *   is *both* a heading and a destination of its own; and the copyright page at
 *   spine 1, which the navigation does not mention at all.
 * - spine 56–60: volume one's last two chapters, volume two's own entry, and its
 *   first two chapters — the volume boundary, and the only place the nesting
 *   closes and reopens.
 *
 * Dropped: volume one's chapters 5–52 (`num_8` … `num_55`), volumes three to
 * thirteen, and 2,064 chapter titles. The gap between the two windows is an
 * artefact of slicing and the book has none — a test that leans on it says so.
 *
 * ## What the book does not contain
 *
 * It has **no fragment in any href** and **no third level**, so those shapes
 * cannot be sliced out of it. The trees below them are marked as invented, and
 * nothing here pretends a measurement stands behind them.
 */

import type { NavigationEntry } from '../../../src/core/document/contents';

/**
 * The whole spine of the owner's book, in spine order: 2,077 hrefs, each
 * `spine[i]` being the href of spine item `i`.
 *
 * Not a sample — the run of chapters was checked against every `itemref` in
 * `content.opf`, all 2,074 of them, and matched exactly.
 */
export const XIANNI_SPINE: readonly string[] = [
  'Text/cover.xhtml',
  'Text/copyright.xhtml',
  'Text/introduction.xhtml',
  ...Array.from({ length: 2074 }, (_, at) => `Text/chapter${at + 1}.xhtml`),
];

/** The spine index of a chapter file, so a test can say `chapter(55)` instead of 57 and be read afterwards. */
export const chapter = (number: number): number => number + 2;

/**
 * The slice of `toc.ncx`, in the shape `@epubjs-react-native/core` posts it.
 *
 * `parent` is omitted rather than set: epub.js fills it with the parent's id and
 * the model never reads it, and leaving it out is how a test proves that.
 */
export const XIANNI_NAVIGATION: readonly NavigationEntry[] = [
  { id: 'num_1', href: 'Text/cover.xhtml', label: '封面', subitems: [] },
  { id: 'num_2', href: 'Text/introduction.xhtml', label: '内容介绍', subitems: [] },
  {
    id: 'num_3',
    href: 'Text/chapter1.xhtml',
    label: '第一卷 平庸少年',
    subitems: [
      { id: 'num_4', href: 'Text/chapter2.xhtml', label: '第1章 离乡', subitems: [] },
      { id: 'num_5', href: 'Text/chapter3.xhtml', label: '第2章 仙人', subitems: [] },
      { id: 'num_6', href: 'Text/chapter4.xhtml', label: '第3章 测试', subitems: [] },
      { id: 'num_7', href: 'Text/chapter5.xhtml', label: '第4章 无情', subitems: [] },
      // Volume one's chapters 5 to 52 are dropped here: `num_8` … `num_55`,
      // `Text/chapter6.xhtml` … `Text/chapter53.xhtml`, spine 8 to 55.
      { id: 'num_56', href: 'Text/chapter54.xhtml', label: '第53章 强势', subitems: [] },
      { id: 'num_57', href: 'Text/chapter55.xhtml', label: '第54章 四年', subitems: [] },
    ],
  },
  {
    id: 'num_58',
    href: 'Text/chapter56.xhtml',
    label: '第二卷 修真血影',
    subitems: [
      { id: 'num_59', href: 'Text/chapter57.xhtml', label: '第55章 夺基大法', subitems: [] },
      { id: 'num_60', href: 'Text/chapter58.xhtml', label: '第56章 天水城', subitems: [] },
    ],
  },
];

/** How many chapters each of the book's 15 top-level entries holds. Measured; the two zeroes are the cover and the introduction. */
export const XIANNI_VOLUME_SIZES: readonly number[] = [0, 0, 54, 62, 60, 205, 67, 185, 228, 248, 343, 135, 180, 207, 87];

/**
 * A navigation of the book's **measured shape** at full size: 15 top-level
 * entries holding `XIANNI_VOLUME_SIZES` children each, 2,076 entries in all,
 * every href pointing at the spine item the real entry points at (entry 0 at
 * spine 0, and entry `i` after it at spine `i + 1`, because spine item 1 is the
 * copyright page no entry names).
 *
 * The **labels are invented** — eleven characters each, against the book's
 * measured mean of 10.7 — because 2,064 real chapter titles are what this fixture
 * exists to avoid committing. Nothing about flattening or locating reads a label's
 * content, so the shape is the part that has to be real, and it is.
 */
export function navigationOfMeasuredShape(): NavigationEntry[] {
  const top: NavigationEntry[] = [];
  let ordinal = 0;
  const next = (): NavigationEntry => {
    const at = ordinal++;
    return {
      id: `num_${at + 1}`,
      href: XIANNI_SPINE[at === 0 ? 0 : at + 1],
      label: `第${at}章 平庸少年之卷`.slice(0, 11),
      subitems: [],
    };
  };
  for (const children of XIANNI_VOLUME_SIZES) {
    const entry = next();
    const subitems: NavigationEntry[] = [];
    for (let child = 0; child < children; child++) subitems.push(next());
    top.push({ ...entry, subitems });
  }
  return top;
}

/**
 * **Invented, not measured.** The owner's book has no fragment in any href and no
 * third level, so these shapes cannot come from it — and they are the two shapes
 * most likely to be got wrong, because one of them is what the model refuses to
 * resolve.
 *
 * `part1.xhtml` is named three times: once by the part's own entry and once by
 * each of the two chapters inside it, which is how a book that puts several
 * chapters in one file is written. All three resolve to the same spine item, and
 * that is the `'shared'` case.
 */
export const THREE_LEVELS: readonly NavigationEntry[] = [
  { id: 'cover', href: 'cover.xhtml', label: 'Cover', subitems: [] },
  {
    id: 'p1',
    href: 'part1.xhtml',
    label: 'Part One',
    subitems: [
      {
        id: 'p1c1',
        href: 'part1.xhtml#ch1',
        label: 'Chapter One',
        subitems: [
          { id: 'p1c1s1', href: 'part1.xhtml#ch1s1', label: 'A first section', subitems: [] },
          { id: 'p1c1s2', href: 'part1.xhtml#ch1s2', label: 'A second section', subitems: [] },
        ],
      },
      { id: 'p1c2', href: 'part1.xhtml#ch2', label: 'Chapter Two', subitems: [] },
    ],
  },
  {
    id: 'p2',
    href: 'part2.xhtml',
    label: 'Part Two',
    subitems: [{ id: 'p2c1', href: 'part2.xhtml', label: 'Chapter Three', subitems: [] }],
  },
  // A childless top-level entry *after* a heading, which is the shape the owner's
  // book does not have — its two childless entries both come first — and the one
  // that would land an appendix inside Part Two's section if sections were opened
  // only by headings. Its href is in no spine item, so it is also the unreachable
  // row.
  { id: 'app', href: 'appendix.xhtml', label: 'Appendix', subitems: [] },
];

/** The spine `THREE_LEVELS` is resolved against. `notes.xhtml` is in the spine and in no entry; `appendix.xhtml` is in an entry and in no spine. */
export const THREE_LEVELS_SPINE: readonly string[] = ['cover.xhtml', 'part1.xhtml', 'notes.xhtml', 'part2.xhtml'];
