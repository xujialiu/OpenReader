/**
 * A **Reading Position**: where speech stopped in a Document, and how it is
 * found again (ADR 0008).
 *
 * A position is two things and exactly two: a **locator** in the format's own
 * terms, and a **text anchor**. Resolving one uses the locator first, compares
 * the text actually found against the anchor, and falls back to searching for
 * the anchor when they disagree.
 *
 * There is no third field, and the two that are missing are missing on purpose.
 * There is no Utterance index, because `sentencex` here and SDT in the desktop
 * plugin segment differently (ADR 0006) and "the 214th utterance" is therefore a
 * different place on each side — ADR 0008 exists to answer that. And there is no
 * character offset into the document as a whole, because it would be a third
 * numbering to keep in step with two that already exist.
 *
 * ## The locator is opaque
 *
 * ADR 0007: "a reading position stays opaque to everything except the renderer
 * that produced it." That is enforced here rather than asked for. A `Locator`'s
 * two properties are keyed by symbols this module does not export, so nothing
 * outside it can read one or build one — a caller cannot write
 * `{ format: 'epub', value: cfi }` and have it type-check, and cannot reach
 * inside one it was given. The renderer mints one with `createLocator` and gets
 * the string back out of `readLocator` by naming the format it understands, so a
 * PDF renderer handed an EPUB CFI gets null rather than a string it would try to
 * resolve.
 *
 * For EPUB the string is an epub.js CFI — specifically the **element** CFI the
 * renderer reports for a Block, with no text step, because ADR 0008 records that
 * Zotero's CFI generator and resolver disagree about text steps. The element
 * step is the part of the dialect both sides agree on, and the anchor is what
 * finds the Utterance inside the Block.
 */

import { anchorHasWords, compareMatches, createTextAnchor, matchAnchor, type AnchorAgreement, type AnchorMatch, type TextAnchor } from './anchor';
import type { DocumentFormat } from './identity';
import type { Stamp } from './stamp';

/**
 * Symbol keys, so the properties cannot be named from outside this file. Not
 * `declare const`: these have to exist at run time, and a `const` initialised
 * with `Symbol()` is already a `unique symbol` to the compiler.
 */
const locatorFormat = Symbol('Locator.format');
const locatorText = Symbol('Locator.text');

/** A place in a Document, in that format's own terms. Opaque: only the renderer that produced it can read it, through `readLocator`. */
export interface Locator {
  readonly [locatorFormat]: DocumentFormat;
  readonly [locatorText]: string;
}

/** A locator for `format`. The renderer that resolves this dialect is the only thing that should call this. */
export function createLocator(format: DocumentFormat, text: string): Locator {
  return { [locatorFormat]: format, [locatorText]: text };
}

/**
 * The locator's string, for a renderer that names the format it speaks — or
 * null when the locator is in a different format.
 *
 * Naming the format is the whole point. A locator carries no self-describing
 * syntax a reader could sniff, and a CFI handed to pdf.js would not fail loudly;
 * it would fail as nothing happening, or worse, as something happening in the
 * wrong place.
 */
export function readLocator(locator: Locator, format: DocumentFormat): string | null {
  return locator[locatorFormat] === format ? locator[locatorText] : null;
}

/** Whether two locators name the same place. What a caller compares after a `recovered` resolution, to decide whether to write the new one back. */
export function sameLocator(a: Locator, b: Locator): boolean {
  return a[locatorFormat] === b[locatorFormat] && a[locatorText] === b[locatorText];
}

/**
 * A place in a Document that speech can be resumed from: a locator and the
 * text anchor that verifies it. What the renderer produces at a Clip boundary,
 * and what resolving works on — everything about finding the sentence again is
 * decided by these two and nothing else.
 */
export interface ReadingPlace {
  locator: Locator;
  anchor: TextAnchor;
}

/**
 * Where speech stopped. One per Document, overwritten as the owner reads
 * (CONTEXT.md) — not a list the owner sees, and not something they create.
 *
 * A place **with its own Stamp** (`stamp.ts`): when speech stopped there and on
 * which device. The Stamp is the position's and not the Library entry's, because
 * the entry's moves whenever the owner touches the book and this one only when
 * the reading does — and it is this one a merge between devices compares.
 */
export interface ReadingPosition extends ReadingPlace {
  stamp: Stamp;
}

/**
 * A place for the characters `[start, end)` of the text at `locator`.
 *
 * Both halves from one call, because they have to describe the same place and
 * building them separately is how they stop doing so. For EPUB: the Block's CFI,
 * the Block's own verbatim text, and the Utterance's span within it — which is
 * exactly what the renderer has when speech reaches an Utterance.
 *
 * No Stamp: the renderer knows where speech is and not what time it is on which
 * device. The Library stamps a place as it stores it (`stampPlace`).
 */
export function readingPlaceAt(locator: Locator, text: string, start: number, end: number): ReadingPlace {
  return { locator, anchor: createTextAnchor(text, start, end) };
}

/** A place, stamped: what the Library keeps and what crosses to other devices. */
export function stampPlace(place: ReadingPlace, stamp: Stamp): ReadingPosition {
  return { locator: place.locator, anchor: place.anchor, stamp };
}

/** `readingPlaceAt` and `stampPlace` in one call, for a caller that has the Stamp in hand. */
export function readingPositionAt(locator: Locator, text: string, start: number, end: number, stamp: Stamp): ReadingPosition {
  return stampPlace(readingPlaceAt(locator, text, start, end), stamp);
}

/** One candidate place and its own text. For EPUB, a Block: its element CFI and the text the renderer reports for it, verbatim. */
export interface Place {
  locator: Locator;
  text: string;
}

/**
 * The document, as resolving a position needs to see it. Injected, the way
 * everything platform-shaped enters `src/core/` — here the implementation is the
 * renderer, which is the only thing that can turn a CFI into text.
 */
export interface PlaceReader {
  /**
   * The text of the place a locator names, or **null** when the locator does not
   * resolve in this document at all.
   *
   * Null and "text that does not match" are different answers and both are
   * expected: a document re-saved with a different spine gives the first, and
   * the CFI disagreement of ADR 0008 gives the second.
   */
  textAt(locator: Locator): string | null;
  /**
   * Every place the anchor could be, in reading order.
   *
   * Only read when the locator failed or its text disagreed, which is why it is
   * a method and not an array: on the ordinary resume it is never called, and
   * walking a whole book's Blocks across the bridge is not free.
   */
  places(): Iterable<Place>;
}

/** Why the stored locator was not used as it stood. */
export type LocatorProblem = 'locator-did-not-resolve' | 'text-disagreed';

/** Why searching for the anchor did not settle it either. */
export type SearchProblem =
  /** The anchor is nowhere in the document, or nowhere that passes the agreement threshold. */
  | 'not-found'
  /**
   * Two places matched equally well and nothing distinguishes them. Refused
   * rather than picked: this is precisely the silent landing three paragraphs
   * away that ADR 0008 and philosophy rule 1 forbid.
   */
  | 'ambiguous'
  /** The quotation holds no letter or digit — a scene break, an Utterance that is not Speakable — so only an exact character match could ever have found it. */
  | 'anchor-not-matchable';

/**
 * What resolving a position produced.
 *
 * `verified` — the locator resolved and the text agrees. The ordinary case, and
 * the only one where nothing has moved.
 *
 * `recovered` — the locator was wrong or gone, and the anchor was found
 * somewhere else. `because` says which, so a caller can write the new locator
 * back and heal the stored position. This is the case the whole design exists
 * for.
 *
 * `unresolved` — no place could be named. **There is no fourth outcome and no
 * best guess.** Resuming at the start of a document is a visible, explicable
 * disappointment; resuming three paragraphs from where the owner stopped is the
 * failure this project was built to avoid.
 */
export type PositionResolution =
  | {
      outcome: 'verified';
      locator: Locator;
      /** UTF-16 code-unit offsets into the text of that place, half-open — the coordinates a `Range` is built from. */
      start: number;
      end: number;
      agreement: AnchorAgreement;
      /**
       * The same text occurs more than once *inside this one place* and the
       * offsets are the first of them.
       *
       * Reported, not refused. The place is right either way, and the candidates
       * are a sentence apart rather than a chapter apart; refusing to resume a
       * book because a paragraph says "He said nothing." twice would be the
       * wrong trade. Ambiguity **between** places is refused — see
       * `SearchProblem`.
       */
      ambiguous: boolean;
    }
  | {
      outcome: 'recovered';
      locator: Locator;
      start: number;
      end: number;
      agreement: AnchorAgreement;
      ambiguous: boolean;
      because: LocatorProblem;
    }
  | {
      outcome: 'unresolved';
      because: LocatorProblem;
      search: SearchProblem;
    };

/**
 * Resolve a position against a document.
 *
 * The order is fixed by ADR 0008 and it is the whole of the design:
 *
 * 1. the locator, which is fast and is usually right;
 * 2. the text found there against the anchor, because a locator that resolves
 *    is not the same thing as a locator that is correct — Zotero's own reader
 *    fails this way silently;
 * 3. failing that, a search for the anchor, which is slow and is what makes a
 *    position survive a document the locator no longer describes.
 */
export function resolveReadingPosition(position: ReadingPlace, document: PlaceReader): PositionResolution {
  const text = document.textAt(position.locator);
  if (text !== null) {
    const match = matchAnchor(position.anchor, text);
    if (match) return { outcome: 'verified', locator: position.locator, ...found(match) };
  }

  const because: LocatorProblem = text === null ? 'locator-did-not-resolve' : 'text-disagreed';
  const search = findAnchor(position.anchor, document.places());
  if (!search) return { outcome: 'unresolved', because, search: anchorHasWords(position.anchor) ? 'not-found' : 'anchor-not-matchable' };
  if (search.ambiguous) return { outcome: 'unresolved', because, search: 'ambiguous' };
  return { outcome: 'recovered', locator: search.place.locator, ...found(search.match), because };
}

const found = (match: AnchorMatch) => ({ start: match.start, end: match.end, agreement: match.agreement, ambiguous: match.ambiguous });

/** The best place for an anchor, and whether anything tied with it. */
export interface AnchorSearch {
  place: Place;
  match: AnchorMatch;
  /** Another place matched exactly as well. Nothing may choose between them. */
  ambiguous: boolean;
}

/**
 * The best place `anchor` matches, across the document.
 *
 * Every place is examined rather than stopping at the first hit, because
 * stopping is what makes a repeated paragraph resolve to whichever copy comes
 * first in the spine — a wrong answer that looks like a right one. The cost is a
 * pass over the document's Blocks, paid only on the fallback path.
 */
export function findAnchor(anchor: TextAnchor, places: Iterable<Place>): AnchorSearch | null {
  let best: { place: Place; match: AnchorMatch } | null = null;
  let tied = false;
  for (const place of places) {
    const match = matchAnchor(anchor, place.text);
    if (!match) continue;
    if (!best) {
      best = { place, match };
      continue;
    }
    const order = compareMatches(match, best.match);
    if (order < 0) {
      best = { place, match };
      tied = false;
    } else if (order === 0) {
      tied = true;
    }
  }
  return best ? { ...best, ambiguous: tied } : null;
}
