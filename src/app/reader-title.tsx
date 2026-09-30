/**
 * The reader's title: the Document's name in the navigation bar, on up to two
 * lines (#85, ADR 0057).
 *
 * **The app draws it because the phone will not.** The bar's own title is one
 * line, and native-stack's `headerTitleStyle` has no line count, so a name
 * longer than the space between the two buttons lost its second half. This is
 * design 0042's second step: the phone's own title, copied rather than
 * remembered — the phone's Headline, semibold, centred, in the bar's text colour.
 *
 * **As large as the other bars' titles** (`barTitle`, #100): 17 points at the
 * phone's default text size, growing with it as the phone's own bar titles do,
 * to 21 at most. The size is worked out from the text size rather than left to
 * React Native's scaling, which would grow it without that limit, so
 * `allowFontScaling` stays off. At 21, two lines take about 50 points, inside
 * the 54-point bar, which cannot grow without moving the page, which keeps room
 * for its height (ADR 0048).
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
 *
 * **Cut after a whole word**, as the Library's rows are (`NameText`, design
 * 0060). The unseen copy is laid out at the full width the title may take,
 * because the title's own box shrinks to its words.
 */

import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { INK } from './controls';
import { NameText } from './name-text';
import { barTitle } from './text-styles';

/** The room each side of the title leaves for a button and the gap before it, in points (measured, above). */
export const TITLE_SIDE = 81;

export function ReaderTitle({ title }: { title: string }) {
  const { width, fontScale } = useWindowDimensions();
  const room = Math.max(0, width - 2 * TITLE_SIDE);
  return (
    <View>
      <NameText name={title} lines={2} width={room} accessibilityRole="header" allowFontScaling={false}
        style={[styles.title, barTitle(fontScale), { maxWidth: room }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: INK.text, textAlign: 'center' },
});
