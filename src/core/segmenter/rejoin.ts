/**
 * A sentence the document's own markup cut in two, read as one.
 *
 * This is the third of the three repair layers the Zotero-TTS plugin needed
 * over Zotero's segmenter, and the only one ADR 0006 keeps: choosing EPUB first
 * retires 457 lines putting back a page's first line and 94 detecting equation
 * source at font size zero, both PDF-only.
 *
 * ## What the plugin's layer repairs, and what survives of it
 *
 * `src/read-aloud/paragraph-parts.ts` in that repo, 154 lines. Zotero cuts a
 * PDF into blocks with a model, and the model now and then starts a new block
 * on an ordinary body line; its own part-linking rule then refuses to rejoin
 * them, because it only links two blocks when the first one's last line runs
 * full to the margin — which a line cut mid-paragraph never does, being short
 * by definition. Read Aloud cuts sentences per chain, so the sentence across
 * the break was spoken as two, with a pause in the middle and the second half
 * starting mid-clause. Measured over the owner's manuscript: **19 of 559
 * utterances; 2 of 122 in the publisher's typeset version.** The fix put back
 * the part link Zotero had refused, and the counts fell to 1 of 541 and 0 of
 * 120.
 *
 * Its sieve had four tests. Three are textual and come across whole:
 *
 * 1. both blocks are paragraphs, neither excluded, and neither is already part
 *    of a chain;
 * 2. the first ends mid-sentence;
 * 3. the second begins as a continuation — a lowercase letter, a citation
 *    bracket, or a short bracket group then a lowercase word; never a capital,
 *    and never a bare digit, which opens real paragraphs too.
 *
 * The fourth is geometry: the second block sits where the first's next line
 * would be, directly below it in its column within 36 pt, at the top of the
 * next column, or on the next page. **That test cannot come across, because an
 * EPUB has no page.** `findSplitParagraphs` knows it: it returns `[]` outright
 * unless the document's processor type is `pdf`.
 *
 * ## Why the layer is still needed for EPUB, with the mechanism
 *
 * The plugin's cause was a model guessing at a PDF's blocks. An EPUB's blocks
 * are authored, so it is fair to ask whether one can be cut mid-sentence at
 * all. It can, and by ordinary means rather than exotic ones:
 *
 * - **HTML closes `<p>` for you.** The standard's optional-tag rule ends an
 *   open `p` element at the start tag of `address`, `blockquote`, `div`,
 *   `figure`, `hr`, `ol`, `p`, `table`, `ul` and a dozen more. So a page-break
 *   marker authored `<div epub:type="pagebreak"/>` rather than `<span>`, an
 *   illustration wrapped in a `<div>`, or a `<blockquote>` opened mid-sentence
 *   splits the paragraph around it — in the parsed DOM, not just visually, and
 *   epub.js hands us that DOM (ADR 0011).
 * - **Converted books are full of it.** An EPUB made from print or PDF by a
 *   converter commonly emits one `<p>` per typeset line, which puts a break in
 *   the middle of nearly every sentence. This is the plugin's own failure
 *   arriving by a different road: same cut, same pause, same half-sentence.
 * - **Verse and drama** are marked up a line to a `<p>`, and a sentence runs
 *   across the lines.
 *
 * What replaces the geometry test is the structure epub.js can actually report:
 * the two blocks are adjacent in reading order, both are paragraphs, and both
 * are in the same section. That is strictly less evidence than a page gives, so
 * the textual tests carry more weight here than they did there, and the layer
 * refuses more readily — a pause in the wrong place is a nuisance, a sentence
 * welded to the wrong neighbour is a lie about the document (PHILOSOPHY).
 *
 * ## What it will not do, and why that is right
 *
 * Test 3 asks for a **lowercase** letter, and `\p{Ll}` matches no character of
 * Han, Hiragana, Hangul, Hebrew, Arabic, Devanagari or Thai. So a cut paragraph
 * in any of those scripts is never rejoined. That is not an oversight inherited
 * from a Latin-only plugin: in a script without case there is nothing in the
 * text that distinguishes a continuation from a new paragraph, so the test
 * cannot be made to work and guessing is the one thing not allowed. The same
 * reasoning the plugin used to refuse a bare digit, which opens real paragraphs
 * too, applies to every uncased script at once.
 */

/**
 * What the document presents a Block as. A heading never continues into body
 * text and body text never continues into a heading — the one cut the plugin's
 * live run was still refusing after the fix was exactly that, a heading
 * `Image analysis` followed much later by `was performed using OCTAVA …`.
 *
 * Absent means `paragraph`: a caller with a DOM knows the difference and says
 * so, and a caller holding one Block of plain text has nothing else it could
 * mean.
 */
export type BlockRole = 'paragraph' | 'heading' | 'other';

/**
 * A **Block** as this directory needs it: a run of text the document presents
 * as one unit (CONTEXT.md), and the coordinate system its utterances' offsets
 * are expressed in.
 *
 * Text, not a node. `src/core/` runs under Node and takes what the platform has
 * as an argument, so the DOM walk that produces these lives above `core/` with
 * epub.js, and everything here is testable without one.
 */
export interface Block {
  text: string;
  role?: BlockRole;
  /**
   * Which part of the document this Block belongs to — for EPUB, the spine
   * item. Two Blocks in different sections are never joined: the last sentence
   * of one chapter file does not continue into the first of the next, and a
   * converter that ends a file mid-sentence has produced two documents' worth
   * of trouble that this layer is not the place to fix.
   */
  section?: string;
}

/** The Blocks read as one text. One Block unless the repair layer put a sentence back together. */
export interface BlockRun {
  /** Indices into the Blocks that were passed in, ascending. */
  blocks: number[];
  /** Their texts in order, with a single space inserted where neither side supplied one. */
  text: string;
  /** Where each of `blocks`' own text starts in `text`. Parallel to `blocks`. */
  offsets: number[];
}

/**
 * A sentence's end: a terminator, then any closing quotes or brackets, then
 * nothing. The plugin's regular expression with the CJK and fullwidth
 * terminators and closing marks added, since this one reads books rather than
 * papers — it changes no outcome today, because an uncased script is never
 * rejoined, and a predicate that is wrong for Chinese would be borrowed later
 * and be wrong somewhere it mattered.
 *
 * Written out as characters rather than as `\p{Sentence_Terminal}`: only
 * `\p{L}` and `\p{Script=Han}` were measured on Hermes 250829098.0.17
 * (notes/NOTES_2026-09-19.md), and a property escape the engine does not know
 * is a `SyntaxError` at load.
 */
const SENTENCE_END = /[.!?…。！？｡︒‼⁇⁈⁉][)\]}"'”’»」』】》）]*\s*$/u;

/**
 * A continuation's start: a lowercase letter, a citation bracket (`[66]`,
 * `(12)`), or a short bracket group followed by a lowercase word.
 * `(Table 4) exhibited` was the one real split the plugin's first live run left
 * behind (2026-09-14). Never a capital, and never a bare digit.
 */
const CONTINUES = /^(?:\p{Ll}|[[(]\s*\p{Nd}|[[(][^\])]{1,40}[\])]\s*\p{Ll})/u;

/** Whether the text stops short of a sentence's end. Empty text continues nothing. */
export function endsMidSentence(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !SENTENCE_END.test(trimmed);
}

/** Whether the text reads as the second half of a sentence rather than the first half of one. */
export function continuesSentence(text: string): boolean {
  return CONTINUES.test(text.trim());
}

/**
 * The Blocks grouped into the texts they are segmented as, in reading order,
 * every Block accounted for.
 *
 * `rejoin` false turns the repair off and gives one run per Block, which is
 * what the plugin's `readAloud.joinSplitSentences` setting does and what a test
 * comparing the two needs.
 */
export function blockRuns(blocks: readonly Block[], rejoin = true): BlockRun[] {
  const runs: BlockRun[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    if (consumed.has(i)) continue;
    const members = [i];
    if (rejoin) {
      let a = i;
      for (;;) {
        const next = candidate(blocks, a);
        if (!next || !joins(blocks[a], blocks[next.index])) break;
        // Only now are the blank blocks in between spent: a refused join must
        // leave them where they were.
        for (const blank of next.blank) consumed.add(blank);
        consumed.add(next.index);
        members.push(next.index);
        a = next.index;
      }
    }
    runs.push(runOf(blocks, members));
  }
  return runs;
}

/**
 * The next Block that could continue `from`, and the Blocks jumped over to
 * reach it.
 *
 * Only Blocks with no non-whitespace at all are jumped over — an `<hr>`, an
 * empty `<p>` a converter left behind. Those produce no utterance either way,
 * so absorbing them costs nothing and moves nothing. A Block with something
 * visible in it is never jumped over, even when it is not Speakable: the
 * plugin skipped a PDF's running heads and page numbers because a classifier
 * had labelled them furniture, and an EPUB's text flow has no such label. A
 * `<div epub:type="pagebreak">143</div>` between two halves of a sentence
 * therefore refuses the join, which is the safe answer and the same answer the
 * plugin's own remaining-cuts report called "rightly refused".
 */
function candidate(blocks: readonly Block[], from: number): { index: number; blank: number[] } | null {
  const blank: number[] = [];
  for (let i = from + 1; i < blocks.length; i++) {
    if (!blocks[i].text.trim()) {
      blank.push(i);
      continue;
    }
    return { index: i, blank };
  }
  return null;
}

const HAS_LETTER = /\p{L}/u;

function joins(a: Block, b: Block): boolean {
  if ((a.role ?? 'paragraph') !== 'paragraph' || (b.role ?? 'paragraph') !== 'paragraph') return false;
  if (a.section !== b.section) return false;
  // A Block with no letter in it is not the first half of a sentence. It is a
  // page number, a figure number, a bullet — and it has no terminator either, so
  // `endsMidSentence` alone would take it for a sentence left hanging and weld
  // the next paragraph onto it. The continuation side needs no such test:
  // `CONTINUES` already asks for a lowercase letter, except where it asks for a
  // citation bracket, and `[66]` is a real continuation with no letter in it.
  if (!HAS_LETTER.test(a.text)) return false;
  return endsMidSentence(a.text) && continuesSentence(b.text);
}

const ENDS_BLANK = /\s$/u;
const STARTS_BLANK = /^\s/u;

function runOf(blocks: readonly Block[], members: readonly number[]): BlockRun {
  let text = '';
  const offsets: number[] = [];
  for (const member of members) {
    const own = blocks[member].text;
    // The break between two halves of a sentence was rendered as a line break,
    // which separates words. Nothing is inserted where either side already
    // brought its own space, so the offsets of a Block whose text already ends
    // in one are untouched.
    if (text && !ENDS_BLANK.test(text) && !STARTS_BLANK.test(own)) text += ' ';
    offsets.push(text.length);
    text += own;
  }
  return { blocks: [...members], text, offsets };
}
