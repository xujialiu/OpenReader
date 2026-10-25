/**
 * The Sleep Timer's button in the Player's head row, beside the collapse arrow (#326,
 * design and ADR 0088), and the phone's own menu it opens.
 *
 * The menu is SwiftUI's, through `@expo/ui`, as every short choice in the app
 * is (`ChoiceMenu`, ADR 0035): one `Toggle` per choice, checked for the one in
 * force, in a fixed order, so a menu that opens upward from the bottom of the
 * screen is not listed backwards. While a Sleep Timer is set, `Turn Off Timer`
 * comes first. Choosing the checked entry again is choosing it again: a length
 * starts again from its whole length.
 *
 * Off, the button is a moon in the ink of the Player's other icons; set to the
 * chapter, the moon in the App Colour; set to a length, the time left in the
 * App Colour. The countdown is this component's own: it ticks once a second
 * while the length counts, and the reader around it is not drawn again.
 */

import { Button, Divider, Host, Menu, RNHostView, Toggle } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, accessibilityElement, accessibilityLabel, menuOrder } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { INK, useAccent } from './controls';
import { SIDE_TEXT_SCALE } from './player-layout';
import { Icon } from './icon';
import { countdown, sleepChoices, sleepLabel, type SleepChoice } from './sleep-timer';
import { TEXT_EMPHASIZED } from './text-styles';
import { leftAt, type SleepTimerState } from './use-sleep-timer';

export function SleepTimerButton({ sleep, chapterOffered, onSleep, width, height }: {
  sleep: SleepTimerState;
  /** Whether the Document has Contents rows, and so a chapter to end (owner's Q6). */
  chapterOffered: boolean;
  onSleep(choice: SleepChoice | null): void;
  width: number;
  height: number;
}) {
  const accent = useAccent();
  const [now, setNow] = useState(() => Date.now());
  const counting = sleep.since !== null;
  useEffect(() => {
    if (!counting) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);
  // Never earlier than the count began: `now` is the last tick, and may be.
  const left = typeof sleep.choice === 'number' ? countdown(leftAt(sleep, Math.max(now, sleep.since ?? now))) : null;
  const said = sleep.choice === null ? 'Sleep Timer'
    : left !== null ? `Sleep Timer, ${left} left` : `Sleep Timer, ${sleepLabel(sleep.choice)}`;
  return (
    // The home indicator's safe area is not this button's to keep clear of:
    // the Player already puts the row on its line (#325). Kept, SwiftUI shrank
    // the menu's label by the part of the host inside it, which drew the moon
    // 11 points above the lock beside it (measured on an iPhone 16 Pro).
    <Host style={{ width, height }} ignoreSafeArea="container">
      <Menu
        label={<RNHostView>
          <View style={styles.face} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {left !== null
              ? <Text style={[styles.left, { color: accent.reading }]} maxFontSizeMultiplier={SIDE_TEXT_SCALE}>{left}</Text>
              : <Icon name="moon" color={sleep.choice === null ? INK.text : accent.reading} />}
          </View>
        </RNHostView>}
        modifiers={[menuOrder('fixed'), accessibilityElement('ignore'), accessibilityLabel(said), accessibilityAddTraits(['isButton'])]}
      >
        {sleep.choice !== null ? <Button label="Turn Off Timer" onPress={() => onSleep(null)} /> : null}
        {sleep.choice !== null ? <Divider /> : null}
        {sleepChoices(chapterOffered).map((choice) => (
          <Toggle key={String(choice)} label={sleepLabel(choice)} isOn={choice === sleep.choice}
            onIsOnChange={() => onSleep(choice)} />
        ))}
      </Menu>
    </Host>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  // The speed's own size above it, and figures of one width, so the time does
  // not shift sideways as it counts down.
  left: { ...TEXT_EMPHASIZED.subhead, fontVariant: ['tabular-nums'] },
});
