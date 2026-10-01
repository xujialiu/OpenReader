import { useEffect, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { INK } from './controls';

const SIZE = 24;
const RADIUS = 10;
const ROUND = 2 * Math.PI * RADIUS;

/**
 * The App Store's download ring, in the column the selection circle uses so the
 * two line up (design 0027, "Choose chapters or the whole document").
 *
 * A thin track in the line colour; an arc in the reading colour that fills
 * clockwise from twelve o'clock, which is where the HIG's circular indicator
 * starts; a quarter arc that turns while `spinning`, for the moment the chapter's
 * text is still being counted and there is no fraction. The glyph in the middle
 * says what a tap does: a square while the chapter goes on by itself (tap
 * pauses it), a triangle while it waits for the owner (tap resumes it). "Resume"
 * is the word Apple's own download menus use (#56).
 *
 * Two drawings, not one: the arc is on its own layer because the spin is a
 * rotation of that layer, and turning the whole ring would turn the square with
 * it (ADR 0027).
 */
export function DownloadRing({ fraction, spinning, halted, onPress }: {
  fraction: number; spinning: boolean; halted: boolean; onPress(): void;
}) {
  // Held in state rather than a ref, so nothing reads a ref during render.
  const [turn] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!spinning) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => { loop.stop(); turn.setValue(0); };
  }, [spinning, turn]);
  const arc = ROUND * (spinning ? 0.25 : Math.min(1, Math.max(0, fraction)));
  return <Pressable accessibilityRole="button" accessibilityLabel={halted ? 'Resume download' : 'Pause download'} hitSlop={12} onPress={onPress} style={styles.ring}>
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={RADIUS} stroke={INK.line} strokeWidth={2} />
      {halted ? <Path d="M10 8.3 15.6 12 10 15.7Z" fill={INK.reading} /> : <Rect x={9} y={9} width={6} height={6} rx={1} fill={INK.reading} />}
    </Svg>
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
      <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={RADIUS} stroke={INK.reading} strokeWidth={2} strokeDasharray={`${arc} ${ROUND}`} transform="rotate(-90 12 12)" />
      </Svg>
    </Animated.View>
  </Pressable>;
}
const styles = StyleSheet.create({ ring: { width: SIZE, height: SIZE } });
