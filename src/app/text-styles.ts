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
