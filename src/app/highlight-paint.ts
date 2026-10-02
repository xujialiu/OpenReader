/**
 * What Appearance's Highlight section shows of the page (#118): the page's own
 * two colours under each theme, and the Highlight Colours laid over them as
 * the page lays them, the sentence first and the word over it.
 *
 * Here and not in `highlight-section.tsx` so that a test can reach it, as
 * `drawer-list.ts` is; it imports nothing that needs React Native.
 */

import { channels, readOpacity, type HighlightColour, type HighlightColours } from '../renderer/highlight-colours';

/**
 * The page a Document is read on, per theme: the light one is the reader's
 * white with the library's black text (`READER_THEME`), the dark one
 * `themeCss`'s `#111114` with `#e6e6ea` (`PALETTE.dark`).
 */
export const HIGHLIGHT_PAGE = {
  light: { page: '#ffffff', text: '#000000' },
  dark: { page: '#111114', text: '#e6e6ea' },
} as const;

/** `level` at its opacity over the opaque `base`, as one opaque `#rrggbb`: what the page shows where it marks text. */
export function paintOver(base: string, level: HighlightColour): string {
  const alpha = (readOpacity(level.opacity) ?? 0) / 100;
  const under = channels(base);
  const over = channels(level.color);
  return '#' + under.map((channel, at) => Math.round(channel * (1 - alpha) + over[at] * alpha).toString(16).padStart(2, '0')).join('');
}

/** The sentence being read, on `page`. */
export function sentencePaint(page: string, colours: HighlightColours): string {
  return paintOver(page, colours.sentence);
}

/** The word being spoken, inside its sentence on `page`: the word over the sentence over the page. */
export function wordPaint(page: string, colours: HighlightColours): string {
  return paintOver(sentencePaint(page, colours), colours.word);
}
