import type { TextStyle } from 'react-native';

/**
 * The phone's own text styles: the one place the app's text sizes and weights
 * are written (#99, design 0061, design 0042).
 *
 * Every word the app sets itself refers to a style by name and adds only its
 * colour and layout, `{ ...TEXT.body, color: INK.text }`; the navigation bars'
 * titles, which the phone draws, are handed theirs from here too. A style the
 * app needs that is not here is a question for the owner, not a new number in a
 * component. The page's own text is not the app's: it is Appearance's, and so
 * is what a lookup was asked about and what it found (#98).
 *
 * **Sizes and weights** are Apple's, from the Human Interface Guidelines,
 * Typography, "iOS, iPadOS Dynamic Type sizes", at the default size (Large),
 * read on 2026-09-30: the weight each style has, and the weight it takes when
 * emphasized.
 *
 * **No line heights.** The same table gives each style a leading (Footnote 18,
 * Body 22), but the phone does not draw its own text on it: its Settings sets a
 * 13-point footer on a 16-point line (notes, 2026-09-23 17:18), about the
 * font's own line height of 15.5. Text left without a line height gets the
 * font's own, as the phone's does (design 0042: measured, not written down).
 * The one exception is a drawer's list row, on Apple Books' measured pitch
 * (`onLinePitch`, #117).
 */
const HIG = {
  title2: { size: 22, weight: '400', emphasized: '700' },
  title3: { size: 20, weight: '400', emphasized: '600' },
  headline: { size: 17, weight: '600', emphasized: '600' },
  body: { size: 17, weight: '400', emphasized: '600' },
  callout: { size: 16, weight: '400', emphasized: '600' },
  subhead: { size: 15, weight: '400', emphasized: '600' },
  footnote: { size: 13, weight: '400', emphasized: '600' },
  caption1: { size: 12, weight: '400', emphasized: '600' },
} as const satisfies Record<string, { size: number; weight: TextStyle['fontWeight']; emphasized: TextStyle['fontWeight'] }>;

export type TextStyleName = keyof typeof HIG;

type Styles = { readonly [name in TextStyleName]: Readonly<Pick<TextStyle, 'fontSize' | 'fontWeight'>> };

const styles = (emphasized: boolean): Styles => Object.fromEntries(Object.entries(HIG).map(([name, style]) =>
  [name, { fontSize: style.size, fontWeight: emphasized ? style.emphasized : style.weight }])) as unknown as Styles;

/** Each style at its own weight. */
export const TEXT = styles(false);

/** Each style at its emphasized weight: a chosen chip, the chapter being read. */
export const TEXT_EMPHASIZED = styles(true);

/**
 * How far a title above a page follows the phone's text size, as React
 * Native's multiplier (`fontScale`, 1 at the default size): never below the
 * default, never above `extra-extra-large`'s 1.235 (#100).
 */
const BAR_TITLE_SCALE = { min: 1, max: 1.235 } as const;

/**
 * A title above a page: every navigation bar's, and the reader's Document name,
 * at the phone's text size `fontScale` (#100).
 *
 * The phone grows its own bar titles with the text size, but only so far.
 * Measured on its own Settings › General › About (notes, 2026-09-30 12:05):
 * 17 pt at the default size and every smaller one, about 19 at `extra-large`,
 * about 21 at `extra-extra-large` and every larger size, accessibility sizes
 * included. That is Headline at the current size, held between 17 and 21.
 * React Native's own multipliers put 17 at exactly those sizes (1.118 gives
 * 19.0, 1.235 gives 21.0), so the title is Headline times the multiplier, held
 * between them.
 *
 * The size is worked out here and handed over whole: react-native-screens
 * fixes a bar title's font at 17 as soon as any title style is passed, and the
 * app passes the title's colour, so the phone cannot grow it itself. It is a
 * whole number of points because react-native-screens takes `titleFontSize` as
 * an `Int32` and drops the fraction: 20.995 was drawn at 20 (notes, 2026-09-30
 * 12:15). The reader's title takes the same whole number, to match.
 */
export function barTitle(fontScale: number): Readonly<Pick<TextStyle, 'fontSize' | 'fontWeight'>> {
  const scale = Math.min(BAR_TITLE_SCALE.max, Math.max(BAR_TITLE_SCALE.min, fontScale));
  return { fontSize: Math.round(HIG.headline.size * scale), fontWeight: HIG.headline.weight };
}

/**
 * A style on a line pitch of its own, `share` of its size: a drawer's list
 * rows, on Apple Books' 16.67 pt for 15 (#117, `drawer-list.ts`), the one
 * place the app's words are not left on the font's own line.
 *
 * A hundredth under the exact pitch. At 50/3 a title that wraps once was
 * given its two lines' height and drew only the first, cut off at the right:
 * twice the pitch came out a hair over the height the layout gave it, and the
 * phone dropped the line that did not fit (Reverend Insanity's Chapter 198,
 * notes 2026-10-01).
 */
export function onLinePitch(style: Readonly<Pick<TextStyle, 'fontSize' | 'fontWeight'>>, share: number): Readonly<Pick<TextStyle, 'fontSize' | 'fontWeight' | 'lineHeight'>> {
  return { ...style, lineHeight: Math.floor((style.fontSize ?? 0) * share * 100) / 100 };
}
