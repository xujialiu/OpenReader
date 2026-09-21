/**
 * A Document's **body text size**: the size its own stylesheet sets most of its
 * text in, which is what the owner's Font Size is measured against (ADR 0030).
 *
 * The WebView counts the characters of each section it renders by the size the
 * Document set them in, and this decides from those counts. It is decided
 * **once per Document**, from the first pages with enough text on them, and
 * then remembered for that Document — so a title page does not become the body
 * text, and an appendix set smaller than the chapters stays smaller than them.
 */
import type { CharactersBySize } from './messages';

/**
 * The body text size of a Document that sets none of its own: the WebView's
 * initial `medium`. It is what every current Document measures at, and what a
 * Document is taken to be until its own has been decided.
 */
export const PLAIN_BODY_TEXT_SIZE = 16;

/**
 * How many characters are counted before the body text size is decided: more
 * than a title page or a page of small print in front of the first chapter
 * holds, and less than one chapter of prose.
 */
export const CHARACTERS_TO_DECIDE = 2000;

/** A size a stylesheet could be built from: a positive, finite number of pixels. */
export function isPixelSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** The size most of the counted characters are set in, or null while too few have been counted. */
export function decideBodyTextSize(counts: CharactersBySize): number | null {
  const bySize = new Map<number, number>();
  let total = 0;
  for (const [px, characters] of counts) {
    if (!isPixelSize(px) || !isPixelSize(characters)) continue;
    // To a hundredth of a pixel: the WebView divides the owner's percentage back
    // out of the size it reads, which is exact only up to floating point —
    // 15.999996px at 133.333298% is 12.0000003px.
    const size = Math.round(px * 100) / 100;
    bySize.set(size, (bySize.get(size) ?? 0) + characters);
    total += characters;
  }
  if (total < CHARACTERS_TO_DECIDE) return null;
  let body: number | null = null;
  let most = 0;
  for (const [px, characters] of bySize) {
    if (characters > most) {
      body = px;
      most = characters;
    }
  }
  return body;
}

/**
 * One more page counted, for a Document whose body text size is not decided yet:
 * every page counted so far, one entry per section, and the size once they
 * decide it.
 *
 * **A section rendered again replaces its own count.** epub.js renders a
 * section afresh after a resize or on the way back to it, and a title page
 * counted twice must still be a title page rather than enough text to decide.
 */
export function countPage(
  pages: ReadonlyMap<number, CharactersBySize>,
  section: number,
  counts: CharactersBySize,
): { pages: Map<number, CharactersBySize>; bodyTextSize: number | null } {
  const next = new Map(pages).set(section, counts);
  return { pages: next, bodyTextSize: decideBodyTextSize([...next.values()].flat()) };
}
