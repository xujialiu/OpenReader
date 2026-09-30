import type { TextStyle } from 'react-native';

/**
 * The phone's own text styles: the one place the app's text sizes, weights and
 * line heights are written (#99, design 0042).
 *
 * The numbers are Apple's, from the Human Interface Guidelines, Typography,
 * "iOS, iPadOS Dynamic Type sizes", at the default size (Large), read on
 * 2026-09-30: size and leading in points, the weight each style has, and the
 * weight it takes when emphasized. Text refers to a style by name and adds
 * only its colour and layout, `{ ...TEXT.body, color: INK.text }`; it never
 * carries a size of its own. A style the app needs that is not here is a
 * question for the owner, not a new number in a component.
 *
 * Each style keeps its own line height: the HIG's leading, so two lines of a
 * style sit as far apart wherever it is used.
 *
 * Not every surface uses these yet. The drawers and the Library do; the player,
 * the settings pages and the reader's title keep their own numbers until the
 * owner has judged this in the simulator (#99).
 */
const HIG = {
  title2: { size: 22, leading: 28, weight: '400', emphasized: '700' },
  title3: { size: 20, leading: 25, weight: '400', emphasized: '600' },
  headline: { size: 17, leading: 22, weight: '600', emphasized: '600' },
  body: { size: 17, leading: 22, weight: '400', emphasized: '600' },
  callout: { size: 16, leading: 21, weight: '400', emphasized: '600' },
  subhead: { size: 15, leading: 20, weight: '400', emphasized: '600' },
  footnote: { size: 13, leading: 18, weight: '400', emphasized: '600' },
  caption1: { size: 12, leading: 16, weight: '400', emphasized: '600' },
} as const satisfies Record<string, { size: number; leading: number; weight: TextStyle['fontWeight']; emphasized: TextStyle['fontWeight'] }>;

export type TextStyleName = keyof typeof HIG;

type Styles = { readonly [name in TextStyleName]: Readonly<Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight'>> };

const styles = (emphasized: boolean): Styles => Object.fromEntries(Object.entries(HIG).map(([name, style]) =>
  [name, { fontSize: style.size, lineHeight: style.leading, fontWeight: emphasized ? style.emphasized : style.weight }])) as unknown as Styles;

/** Each style at its own weight. */
export const TEXT = styles(false);

/** Each style at its emphasized weight: a chosen chip, the chapter being read. */
export const TEXT_EMPHASIZED = styles(true);
