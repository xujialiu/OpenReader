/**
 * The **Reading Button** (CONTEXT.md, #67, ADR 0048): the round button that
 * stands for the reading in progress, and never plays or pauses it.
 *
 * In the reader it is all that is left of the player once it is collapsed, and
 * a press brings the player and the navigation bar back. It used to be the
 * player's own Play/Pause, and pressing it paused (design 0020); the owner asked
 * for the controls back without the voice stopping, so a press now only shows
 * them. A Play or Pause glyph on a button that does neither would be a lie, so
 * it carries the phone's own sign for sound that is playing: the waveform the
 * phone marks a playing track with, moving while the reading plays and still
 * while it is paused, and the spinner while the audio is still coming.
 *
 * Its own file, and positioned by `READING_BUTTON_PLACE`, because it is one
 * button wherever it appears: the same size, the same glyph and the same place
 * at the bottom right.
 *
 * The glyph is the phone's own symbol, drawn and animated by the phone
 * (design 0042, first step). The circle and the press are React Native's, so the
 * button keeps the player's own round shape and colours, and its label and state
 * for anyone who cannot see it. The symbol's host takes no touches of its own,
 * so a press anywhere on the circle is the circle's.
 */

import { Host, Image, useNativeState } from '@expo/ui/swift-ui';
import { symbolEffect } from '@expo/ui/swift-ui/modifiers';
import { useContext, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { INK, PALETTE, SchemeContext } from './controls';
import { LoadingSpinner } from './loading-spinner';

export interface ReadingButtonProps {
  /** Whether the reading is playing: the waveform moves while it is. */
  playing: boolean;
  /** Whether it is waiting for audio: the spinner stands in for the waveform. */
  buffering?: boolean;
  /** What a press does, for anyone who cannot see it. */
  label: string;
  onPress(): void;
}

export function ReadingButton({ playing, buffering = false, label, onPress }: ReadingButtonProps) {
  // The phone draws the symbol, and it takes a plain colour rather than one of
  // `INK`'s dynamic ones: the page's colour on the button's text-coloured circle,
  // for the theme on screen.
  const scheme = useContext(SchemeContext) ?? 'light';
  const moving = useNativeState(playing);
  useEffect(() => {
    moving.set(playing);
  }, [moving, playing]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: playing ? 'Playing' : 'Paused' }}
      accessibilityState={{ busy: buffering }}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {buffering ? (
        <LoadingSpinner color={INK.page} />
      ) : (
        <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
          <Host style={styles.symbol}>
            <Image
              systemName="waveform"
              size={24}
              color={PALETTE[scheme].page}
              modifiers={[symbolEffect({ effect: 'variableColor', fillStyle: 'iterative', inactiveLayers: 'dim' }, { isActive: moving })]}
            />
          </Host>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The player's own Play button, which it replaces in the same place: a circle
  // as tall as the player's row (#48).
  button: { alignItems: 'center', backgroundColor: INK.text, borderRadius: 26, height: 52, justifyContent: 'center', width: 52 },
  pressed: { opacity: 0.65 },
  symbol: { height: 28, width: 28 },
});

/**
 * Where the Reading Button sits: the bottom right, 16 points in and 28 up, where
 * the collapsed player's one button has always been. Absolute against the screen
 * it is drawn on.
 */
export const READING_BUTTON_PLACE = { bottom: 28, position: 'absolute', right: 16 } as const;
