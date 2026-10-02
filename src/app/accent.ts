/**
 * **The reading accent**: the colour the app draws its own marks in — a
 * check, the current row, a link, the download ring, a drawer's action — taken
 * from the word's Highlight Colour (#118, the owner's Q6 = B, Q8 = A).
 *
 * The hue is the word's own. The colour is mixed towards black on a light
 * theme, or towards white on a dark one, just far enough to read at 4.5:1
 * against every surface it is drawn on, and no further: Blue's `#4456de`
 * already reads at 5.3:1 on the light grey and is kept, and Amber's `#ffa800`
 * already reads on the dark ones and is kept there. The word's opacity is the
 * page's business and plays no part in the accent.
 *
 * The one exception is the player's A (#71), which is not an accent but the
 * page's own mark in miniature: the word's colour at the word's opacity
 * (owner's Q5 = A).
 *
 * Pure, so a test can reach it: `controls.tsx` hands it to the screens through
 * `useAccent()`.
 */

import { channels, rgba, type HighlightColours } from '../renderer/highlight-colours';

/** The two themes, as `SchemeContext` names them. */
export type AccentScheme = 'light' | 'dark';

/**
 * The surfaces the accent is drawn on, per theme, as `PALETTE` and `DRAWER`
 * colour them (`controls.tsx`, `drawer.tsx`). The accent must reach 4.5:1 on
 * each.
 *
 * - Light: the page and a settings card (`#ffffff`), and the settings page
 *   and a drawer's sheet (`#f4f4f6`).
 * - Dark: the page and the settings page (`#111114`), and a settings card and
 *   a drawer's sheet (`#1c1c21`).
 */
export const ACCENT_SURFACES: Readonly<Record<AccentScheme, readonly string[]>> = {
  light: ['#ffffff', '#f4f4f6'],
  dark: ['#111114', '#1c1c21'],
};

/**
 * The surfaces of a drawer that sit a step off its sheet: the marked row
 * (`DRAWER.colours.*.mark`, the chapter being read) and the header's round
 * button and capsule (`DRAWER.colours.*.button`). The base accent does not
 * reach 4.5:1 on them, so what is drawn on them takes `onMark`.
 */
export const MARK_SURFACES: Readonly<Record<AccentScheme, readonly string[]>> = {
  light: ['#dcdce2', '#ffffff'],
  dark: ['#3e3e47', '#2c2c32'],
};

/** The contrast the accent is held to: WCAG's for text. */
export const ACCENT_CONTRAST = 4.5;

/** WCAG's relative luminance of a `#rrggbb` colour. */
function luminance(color: string): number {
  const [r, g, b] = channels(color).map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** `color` mixed `share` of the way to `toward` (0 black, 255 white), channel by channel, as `#rrggbb`. */
function mix(color: string, toward: number, share: number): string {
  return '#' + channels(color).map((value) => Math.round(value + (toward - value) * share).toString(16).padStart(2, '0')).join('');
}

/**
 * `color` with its hue kept, darkened (light theme) or lightened (dark theme)
 * the least that reads at 4.5:1 on every one of `surfaces`. Unchanged when it
 * already does.
 *
 * The mix is searched in halves over the rounded colour: each step towards
 * black or white moves every channel the same way, so a mix that reads is
 * followed only by mixes that read too.
 */
export function accentOn(color: string, scheme: AccentScheme, surfaces: readonly string[]): string {
  const toward = scheme === 'light' ? 0 : 255;
  const reads = (share: number) => surfaces.every((surface) => contrast(mix(color, toward, share), surface) >= ACCENT_CONTRAST);
  if (reads(0)) return mix(color, toward, 0);
  let short = 0;
  let enough = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (short + enough) / 2;
    if (reads(middle)) enough = middle;
    else short = middle;
  }
  return mix(color, toward, enough);
}

/** What `useAccent()` gives a screen: the accent for the theme on screen, from the owner's Highlight Colours. */
export interface ReadingAccent {
  /** The accent, on the app's own surfaces (`ACCENT_SURFACES`). */
  reading: string;
  /** The accent on a drawer's marked row and round button (`MARK_SURFACES`), a step further from the word's colour because those are a step off the sheet. */
  onMark: string;
  /** The wash under the player's A: the word's colour at the word's opacity, the same in both themes. */
  following: string;
}

/** The reading accent for `scheme`, from `highlight`'s word. */
export function readingAccent(highlight: HighlightColours, scheme: AccentScheme): ReadingAccent {
  return {
    reading: accentOn(highlight.word.color, scheme, ACCENT_SURFACES[scheme]),
    onMark: accentOn(highlight.word.color, scheme, MARK_SURFACES[scheme]),
    following: rgba(highlight.word),
  };
}
