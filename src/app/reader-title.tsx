/**
 * The reader's title: the Document's name in the navigation bar, on up to two
 * lines (#85, ADR 0057).
 *
 * **The app draws it because the phone will not.** The bar's own title is one
 * line, and native-stack's `headerTitleStyle` has no line count, so a name
 * longer than the space between the two buttons lost its second half. This is
 * design 0042's second step: the phone's own title, copied rather than
 * remembered — 17-point semibold, centred, in the bar's text colour.
 *
 * **Not scaled by the owner's text size**, because the phone's own bar title is
 * not: two lines of a larger size would not fit the 54-point bar, and the bar
 * cannot grow without moving the page, which keeps room for its height (ADR
 * 0048).
 *
 * **Told how wide it may be.** React Native lays the title out before UIKit
 * places it between the two buttons, so it cannot learn the space from the bar.
 * `TITLE_SIDE` is that space's edge, measured rather than guessed: on the
 * iPhone 18 Pro simulator (iOS 27.0, 402 points wide), with a long name in the
 * phone's own title, the back button's glass ran from 16 to 60 points, More
 * actions' from 333 to 386, and the title's letters from 72.7 to 311.7 — about
 * 12 points from each button. So the right side, the wider one, keeps 402 - 333
 * + 12 = 81 points, and a title narrower than the window less 81 on each side
 * fits while centred.
 */

import { StyleSheet, Text, useWindowDimensions } from 'react-native';

import { INK } from './controls';

/** The room each side of the title leaves for a button and the gap before it, in points (measured, above). */
export const TITLE_SIDE = 81;

/** The phone's own bar title: 17-point semibold (measured against it on the simulator, ADR 0057). */
export const TITLE_SIZE = 17;

export function ReaderTitle({ title }: { title: string }) {
  const { width } = useWindowDimensions();
  return (
    <Text
      accessibilityRole="header"
      allowFontScaling={false}
      ellipsizeMode="tail"
      numberOfLines={2}
      style={[styles.title, { maxWidth: Math.max(0, width - 2 * TITLE_SIDE) }]}
    >
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: { color: INK.text, fontSize: TITLE_SIZE, fontWeight: '600', textAlign: 'center' },
});
