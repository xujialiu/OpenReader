/**
 * The **Contents**: a Document's own list of its parts, flattened into the rows a
 * list shows, and the rule that says which row the reading is in (ADR 0020).
 *
 * ADR 0020 removed the progress bar, and named what replaces half of it: "it must
 * mount scrolled to the current chapter with that row marked, because with the
 * progress bar gone this is the only thing that answers 'where am I'." So being
 * subtly wrong here is the expensive defect, and most of this file is about
 * saying exactly how wrong the answer is allowed to be.
 *
 * ## What arrives, and what it is worth
 *
 * The EPUB library's template already posts the whole navigation at load
 * (`@epubjs-react-native/core`'s `lib/module/template.js:230-235`, forwarded by
 * `View.js:258-268`), as a tree of `{ id, href, label, parent?, subitems }`. Two
 * things about that shape are measured rather than assumed, and both are traps:
 *
 * - **`href` is the raw `src` of the `toc.ncx` `<content>` element**, or the raw
 *   `href` of a navigation document's `<a>`. epub.js resolves neither against
 *   anything. So it is relative to the file the navigation came from, and the
 *   spine's hrefs are relative to the package document. In the owner's book those
 *   are the same directory (`OEBPS/toc.ncx` beside `OEBPS/content.opf`) and the
 *   two spellings are byte-identical — which is why matching them as strings
 *   works, and why it is stated here instead of being discovered later. A book
 *   whose navigation lives in a different directory resolves **every** row to
 *   `null`, which is why `unreachable` is on the result: all-or-nothing is a fact
 *   a caller can act on, where one silently dead row is not.
 * - **`id` is not always a string.** epub.js's `ncxItem` computes it as
 *   `getAttribute('id') || false`, so a `navPoint` with no `id` yields the boolean
 *   `false`; a navigation document's `navItem` falls back to the href, so two
 *   entries pointing at one file share an id. The library's own type says
 *   `id: string`. So the id is display-and-key material only, never identity, and
 *   the nesting is read from `subitems` — never from `parent`, which is that same
 *   unreliable id.
 *
 * ## The one currency out
 *
 * A row's destination is a **spine index**, for `goToSection`. Nothing here can
 * produce a CFI: a CFI is a path into a rendered document's DOM, and the DOM
 * lives in the WebView. So `ContentsRow.target` is a spine index or null, and a
 * union with an unreachable CFI branch would be a stub that pretends to work.
 *
 * The cost is stated where it falls: `#fragment` is dropped. See `targetOf`.
 */

/**
 * A navigation entry as the EPUB library reports one.
 *
 * Structural, so the library's own `Section` objects can be passed straight in —
 * `src/core/` may not import the library (`eslint.config.js`), and it does not
 * need to.
 *
 * `parent` is deliberately absent: it is an id, ids are not reliably unique (see
 * the file comment), and `subitems` already carries the nesting completely.
 */
export interface NavigationEntry {
  /** Whatever the document called it. `false` for an `ncx` `navPoint` with no `id` — hence the runtime check, not the type. */
  id: string;
  /** The raw `src`/`href`, relative to the navigation file and possibly carrying a fragment. */
  href: string;
  /** The label as the document wrote it, untrimmed. */
  label: string;
  /** The entries beneath this one. Optional because the library types it `Array<any>`. */
  subitems?: readonly NavigationEntry[];
}

/** One row of the list: one navigation entry, flattened. */
export interface ContentsRow {
  /**
   * The entry's own id, trusted for nothing. Not unique in general, and not a
   * key: `rows` is an array and a row's index in it is what the list scrolls to.
   */
  id: string;
  /** What the row shows. Trimmed, with runs of whitespace collapsed — see `labelOf`. */
  label: string;
  /** 0 for a top-level entry, one more for each level under it. What the list indents by. */
  depth: number;
  /**
   * This row heads its section: a top-level entry that has entries under it.
   *
   * A heading is **also an ordinary destination** and keeps its `target`. In the
   * owner's book each volume's own entry points at a real spine item
   * (`第一卷 平庸少年` → `Text/chapter1.xhtml`, spine 3), so a heading that could
   * not be tapped would make that spine item unreachable from the contents.
   */
  heading: boolean;
  /** Which section this row belongs to — an index into `Contents.sections`. */
  section: number;
  /** The spine item to seek to, for `goToSection`, or null when the href names nothing in the spine. */
  target: number | null;
  /**
   * The href exactly as it arrived, fragment and all.
   *
   * Here so that an unreachable row can be reported rather than merely being
   * dead, and **not** a thing to seek to: `goTo` takes a CFI and `goToSection`
   * takes an index, and an href is neither (ADR 0020 — "do not add a third").
   */
  href: string;
}

/**
 * One run of rows under one heading, as a half-open range of `Contents.rows`.
 *
 * A range rather than a copy of the rows, because there is then exactly one array
 * of rows and one numbering — the numbering the list scrolls to and the one
 * `currentRow` returns. Two arrays would be two things to keep in step.
 *
 * `rows[start].heading` says whether this section has a heading at all. A run of
 * top-level entries with nothing under them — the owner's book opens with two,
 * the cover and the introduction — is one **unheaded** section, because a sticky
 * header with nothing beneath it is not a heading, and because a book with no
 * nesting at all must not become two thousand sections of one row.
 */
export interface ContentsSection {
  start: number;
  end: number;
}

/** A Document's contents, ready for a list. */
export interface Contents {
  /** Every entry, in document order, one row each. */
  rows: readonly ContentsRow[];
  /** The rows grouped, in the same order. Contiguous and gapless: `sections[0].start` is 0 and each `end` is the next `start`. */
  sections: readonly ContentsSection[];
  /**
   * How many rows have no `target`.
   *
   * Equal to `rows.length` with an empty `spine` (the document message has not
   * arrived yet) and with a navigation whose hrefs are relative to somewhere
   * else. Both are states a caller should say out loud rather than present as a
   * list of rows that do nothing.
   */
  unreachable: number;
}

/** The contents of a Document with no navigation. ADR 0020: epub.js resolves a book with neither a navigation document nor an `ncx` to an empty `Navigation` "that resolves normally rather than an error", so this is ordinary and not a failure. */
export const EMPTY_CONTENTS: Contents = { rows: [], sections: [], unreachable: 0 };

/**
 * Flatten a navigation tree into the rows and sections a list renders, and
 * resolve each row to the spine item it names.
 *
 * `spine` is the spine items' hrefs **in spine order** — `spine[i]` is the href
 * of spine item `i`, which is the number `goToSection` takes. Only the WebView
 * knows them; see this directory's README for what the renderer must send.
 *
 * Document order is preserved exactly: a row's index in `rows` is its position in
 * the document's own list, which is what makes "scroll to the current row" mean
 * anything.
 */
export function contentsOf(navigation: readonly NavigationEntry[], spine: readonly string[]): Contents {
  const byHref = spineLookup(spine);
  const rows: ContentsRow[] = [];
  const sections: { start: number; end: number }[] = [];
  /** Whether the section being filled is headed, which decides whether a childless top-level entry may join it. */
  let headed = false;
  let unreachable = 0;

  const visit = (entry: NavigationEntry, depth: number): void => {
    // A falsy child: older epub.js `parseNavList` pushed `navItem`'s undefined
    // return for an `<li>` with neither an `<a>` nor a `<span>` in it.
    if (!entry) return;
    const subitems = Array.isArray(entry.subitems) ? entry.subitems : [];
    const href = typeof entry.href === 'string' ? entry.href : '';
    const heading = depth === 0 && subitems.length > 0;

    if (depth === 0 && (sections.length === 0 || heading || headed)) {
      sections.push({ start: rows.length, end: rows.length });
      headed = heading;
    }

    const target = targetOf(byHref, href);
    if (target === null) unreachable++;
    rows.push({
      id: typeof entry.id === 'string' ? entry.id : '',
      label: labelOf(entry.label),
      depth,
      heading,
      section: sections.length - 1,
      target,
      href,
    });

    for (const child of subitems) visit(child, depth + 1);
  };

  // A tree, not a graph: the navigation crosses the bridge as JSON, and JSON
  // cannot express a cycle. So the walk needs no seen-set and no depth cap.
  for (const entry of navigation) visit(entry, 0);

  // Ends last, from the next section's start, so a section cannot end before the
  // children of its own heading. Setting `end` while walking is how that breaks.
  for (let at = 0; at < sections.length; at++) {
    sections[at].end = at + 1 < sections.length ? sections[at + 1].start : rows.length;
  }

  return { rows, sections, unreachable };
}

/**
 * The label a row shows.
 *
 * epub.js hands back `textContent` verbatim — `ncxItem` does
 * `navLabel.textContent ? navLabel.textContent : ""` with no trim — so a
 * pretty-printed `<navLabel><text>\n  第1章\n</text></navLabel>` arrives with its
 * indentation attached. Collapsed and trimmed here because the row is one line,
 * which is what a browser would have done with the same text.
 *
 * Deliberately **not** Unicode-normalised. ADR 0008's normalisation is for text
 * anchors, where two spellings of the same characters must compare equal; a label
 * is only ever displayed, and rewriting what the document says to display it
 * would be a change nobody asked for. Measured on the owner's book: 0 of 2,076
 * labels carry leading or trailing whitespace, a newline, a tab or a run of two
 * spaces — so on that book this function is the identity, and it is here for the
 * books that are not that one.
 */
function labelOf(label: unknown): string {
  return typeof label === 'string' ? label.replace(/\s+/gu, ' ').trim() : '';
}

/**
 * Every spelling of every spine href, mapped to its index.
 *
 * This is the table epub.js builds in `Spine.append` — the href, `decodeURI` of
 * it and `encodeURI` of it, all three keyed to the same index — so a row resolves
 * here exactly when `Spine.get(href)` would have resolved it, whichever side of
 * the percent-encoding each file happens to be written on.
 *
 * Two deliberate differences from epub.js:
 *
 * - **The first occurrence wins**, where `Spine.append` overwrites and so keeps
 *   the last. A spine that lists one href twice is legal and rare; the earlier
 *   item is the one in document order, and it is the choice that keeps a row's
 *   target from going backwards as the list goes forwards.
 * - **Neither conversion is allowed to throw.** `decodeURI('a%zz.xhtml')` and
 *   `encodeURI('\uD800')` both raise `URIError`, and epub.js raises it out of
 *   `unpack` and loses the book. A spelling that cannot be computed is simply not
 *   registered.
 */
function spineLookup(spine: readonly string[]): Map<string, number> {
  const byHref = new Map<string, number>();
  const put = (href: string, index: number): void => {
    if (href !== '' && !byHref.has(href)) byHref.set(href, index);
  };
  for (let index = 0; index < spine.length; index++) {
    const href = spine[index];
    if (typeof href !== 'string') continue;
    put(href, index);
    put(recode(decodeURI, href), index);
    put(recode(encodeURI, href), index);
  }
  return byHref;
}

const recode = (convert: (value: string) => string, href: string): string => {
  try {
    return convert(href);
  } catch {
    return '';
  }
};

/**
 * The spine item an entry's href names, or null.
 *
 * **The fragment is dropped**, as `Spine.get` drops it, and that is the one
 * precision this file loses on purpose: `Text/part1.xhtml#ch3` seeks to the top
 * of `Text/part1.xhtml`. Keeping it would mean handing the href itself to the
 * renderer, which is the third currency ADR 0020 refuses; expressing it as a CFI
 * would mean resolving an element id against a document that is not loaded.
 *
 * A bare `#id` — a link into the navigation's own file — resolves to null.
 * `Spine.get` reads it as the spine href `id` with the `#` stripped
 * (`target.indexOf("#") === 0`), which would silently land on whichever spine
 * item happens to be spelled that way. That is a wrong answer dressed as a right
 * one, so it is not copied.
 */
function targetOf(byHref: Map<string, number>, href: string): number | null {
  const hash = href.indexOf('#');
  const bare = hash === -1 ? href : href.slice(0, hash);
  if (bare === '') return null;
  const index = byHref.get(bare);
  return index === undefined ? null : index;
}

/**
 * Where the reading is, as much of it as the contents can use.
 *
 * `ReportedBlock` satisfies this, so the Block the reading is on goes straight
 * in. That is the point of taking an object rather than a number: a spine index,
 * a row index and a Block's ordinal are all numbers, and passing the wrong one
 * would type-check and answer confidently.
 */
export interface ReadingSpineItem {
  /** The spine index of the section the reading is in — `ReportedBlock.sectionIndex`. */
  sectionIndex: number;
}

/**
 * How exactly the current row was pinned down. The list can mark a row either
 * way; a caller that shows "where am I" in words should not claim more than this
 * allows.
 */
export type RowPrecision =
  /** Exactly one row names the spine item the reading is in. Nothing is being guessed. */
  | 'exact'
  /**
   * More than one row names it, and the **first** of them is reported.
   *
   * Not resolvable from this data: rows sharing a spine item differ only by their
   * fragment, a fragment names an element, and where an element falls needs the
   * rendered document. The first row is the coarse answer that contains the
   * reading rather than the precise one that might not — naming a later sibling
   * while the reading is above it would be the confident wrong answer ADR 0020
   * calls the expensive defect.
   */
  | 'shared'
  /**
   * No row names the spine item the reading is in, so the nearest row before it
   * is reported.
   *
   * Ordinary, not a malformed book: the owner's book has 2,077 spine items and
   * 2,076 navigation entries, and the one with no entry is spine item 1,
   * `Text/copyright.xhtml`. Reading it reports the cover.
   */
  | 'before';

/** Which row the reading is in. */
export interface CurrentRow {
  /** An index into `Contents.rows`. */
  row: number;
  precision: RowPrecision;
}

/**
 * The row the reading is in, or null when no row can contain it.
 *
 * The rule, stated once: **the row whose spine item is the latest one at or
 * before the reading's, and the first such row in document order.**
 *
 * Written that way rather than as "the last row at or before the reading"
 * because the two differ on a navigation whose entries are not in spine order,
 * where the second rule returns whichever such row happens to come last in the
 * list — an arbitrary answer that reads like a considered one. On the owner's
 * book the order never goes backwards (measured: 0 decreases across 2,076
 * entries) and the two rules agree.
 *
 * Null when the contents are empty, when no row resolved to a spine item at all,
 * and when every row that did resolve points past the reading — a book whose
 * navigation begins at spine item 3 while the reading is in item 0.
 *
 * What it cannot do, in one place:
 *
 * - **It works at spine-item granularity and no finer.** `'shared'` above.
 * - **It does not read a CFI.** A CFI's first component does encode the spine
 *   position, but decoding it would put epub.js's CFI dialect inside `src/core/`,
 *   which is precisely what ADR 0008 keeps out — Zotero's generator and resolver
 *   already disagree about that dialect. The renderer reports `sectionIndex`
 *   beside every Block; that is the number.
 * - **It does not read a Block id.** `highlighter.ts:334` mints it as
 *   `sectionIndex + '.' + ordinal`, so the spine index is in there as a decimal
 *   prefix — and parsing it back out would be a second numbering to keep in step
 *   with one that already crosses the bridge.
 */
export function currentRow(contents: Contents, reading: ReadingSpineItem): CurrentRow | null {
  const at = reading.sectionIndex;
  /** The latest spine item at or before the reading that any row names. */
  let latest = -1;
  let row = -1;
  /** How many rows name `latest`. More than one and the answer is coarse. */
  let sharing = 0;
  for (let index = 0; index < contents.rows.length; index++) {
    const target = contents.rows[index].target;
    if (target === null || target > at) continue;
    if (target > latest) {
      latest = target;
      row = index;
      sharing = 1;
    } else if (target === latest) {
      sharing++;
    }
  }
  if (row < 0) return null;
  if (latest !== at) return { row, precision: 'before' };
  return { row, precision: sharing > 1 ? 'shared' : 'exact' };
}
