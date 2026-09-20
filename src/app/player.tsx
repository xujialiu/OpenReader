/**
 * The player: the strip that floats over the page (ADR 0020).
 *
 * Ten decisions are in here and every one of them is in that ADR and its design
 * file. The ones this file is the whole of:
 *
 * - **It floats, and never pushes the page.** It is absolutely positioned over the
 *   document, so the text does not reflow when it appears, disappears, collapses or
 *   expands. The price is that it covers the last few lines, and the price of
 *   *that* is `onHeight` below: the centring has to know how much is covered, and
 *   the number changes when the player collapses (ADR 0011, ADR 0020).
 * - **There is no progress bar**, and the design file is the argument. On the
 *   owner's novel — one file, two thousand chapters — a bar would answer "how far
 *   through am I" with a number too small to read and destroy the reading position
 *   if it were dragged. Tapping a sentence and the contents list replace it.
 * - **Collapsing leaves one play button and nothing else** — no arrow to restore
 *   the player. Pressing it pauses, and pausing re-opens the player. One behaviour
 *   doing two jobs, chosen so that someone reaching out to stop the reading always
 *   has a button to press: with the controls hidden and no button, they would tap
 *   the page, and tapping the page moves the reading position.
 *
 * ## Why the buttons are characters
 *
 * There is no icon set in this binary and `controls.tsx` says why: a font shipped
 * for six glyphs. So the five transport controls are characters in the system font
 * with `accessibilityLabel`s saying what they are, and the two paragraph buttons
 * carry a pilcrow — the one glyph that means "paragraph" without a legend.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { MAX_STEPPER_RATE, MIN_STEPPER_RATE, snapRate, stepRate } from '../playback';

import { INK } from './controls';
import { PROVIDER_LABELS, type AppSettings } from './settings';
import type { SkipTarget } from './use-reading';

/**
 * How a held stepper button repeats, and why it is not simply "fast".
 *
 * Every rate change re-sends the whole Word Timing array to the WebView, scaled by
 * the new rate (`engine.setRate` → `cue` + `correct`), so the repeat cadence is a
 * message cadence on the bridge that ADR 0005 is about. It is held at eight a
 * second, which is the order of a word's own cadence and the most that rule
 * tolerates; what grows instead is the **number of steps each repeat takes**, which
 * is exactly what `stepRate`'s count parameter exists for ("a caller that coalesces
 * a burst of presses passes the count").
 *
 * So holding is slow enough to land on a value for the first second and then covers
 * the range: 0.50 to 4.00 is seventy steps, which is `8 + (70 - 8) / 3` repeats,
 * about three seconds.
 */
const HOLD_DELAY_MS = 350;
const HOLD_INTERVAL_MS = 120;
const HOLD_FINE_REPEATS = 8;
const HOLD_COARSE_STEPS = 3;

export interface PlayerProps {
  settings: AppSettings;
  playing: boolean;
  /**
   * Whether the player is down to its one button.
   *
   * Held by the screen rather than in here, beside the two sheets' visibility, for
   * one reason: **pausing re-opens the player**, and the pause is the screen's. A
   * state that lived in here would have to be told about a pause that happened
   * anywhere else.
   */
  collapsed: boolean;
  onCollapsed(collapsed: boolean): void;
  /**
   * Whether Play can do anything at all. False disables it and the skips, exactly
   * as the desktop plugin's own player disables its five "only when no session is
   * open" — never at a document boundary, where ADR 0020 records that Zotero's
   * popup carries no disabled state on any of the five and the ends re-speak
   * instead.
   */
  enabled: boolean;
  /**
   * The Voice in use as the Provider describes it — its own name and its locale —
   * or null until a list holding it has been asked for. See `voiceLine`.
   */
  voiceInUse: { label: string; locale: string } | null;
  /** What the reading is doing, in one line. Kept in the player so that collapsing hides it with everything else. */
  reading: string;
  /**
   * What the player says under the reading line, in the words of whatever said it.
   * Never swallowed (philosophy rule 1).
   *
   * `attention` and not one style for all of them: the screen that builds this list
   * already knows which of them is a failure and which is a statement of fact —
   * `ReadingStatus` keeps a resume that worked out of `note` precisely so — and
   * painting both in the attention colour threw that away, so a book that came back
   * to the right sentence said so in the colour of an error
   * (notes/NOTES_2026-09-20.md, 07:27).
   */
  notes: readonly { said: string; attention: boolean }[];
  onPlay(): void;
  onPause(): void;
  onSkip(target: SkipTarget): void;
  onRate(rate: number): void;
  onContents(): void;
  onVoices(): void;
  /**
   * How tall the player is, in points — the height it is covering at the bottom of
   * the page.
   *
   * The centring's input (ADR 0011, ADR 0020). It is the height of the **band** the
   * player occupies rather than the area it paints: collapsed, the button sits at
   * one end of a band that is mostly clear, and the centring aims at a scalar. The
   * error that costs is one button's height of extra margin at the bottom, in the
   * direction that keeps the spoken sentence visible.
   */
  onHeight(height: number): void;
}

/**
 * The Voice in use, above the play button.
 *
 * Design 0020 promises "the service that is reading and the voice it is reading
 * with", and for a while this line kept the first half and spelled the second as
 * `zh/74c6aba5cbf94a15bbdc547ffce5cb38` — a Provider's internal id, which is not
 * the name of anything (notes/NOTES_2026-09-20.md, 07:14). The Voice's own name is
 * in the list the sheet fetched, so it is threaded through to here.
 *
 * The name and the locale are both shown **once the Provider's Voice list has been
 * asked for**, and not before. Neither is a property of the id: a Voice's name is
 * whatever the service calls it, two of the five Providers report a real locale per
 * Voice and three report none at all (ADR 0020), and the only way to know either is
 * to have the list — which is a request against the owner's account. Fetching one
 * so that a caption could be complete would be spending the owner's quota on a
 * caption (philosophy rule 4), so until then the id is shown, because it is the
 * only true thing there is to show.
 */
function voiceLine(settings: AppSettings, inUse: { label: string; locale: string } | null): string {
  const provider = PROVIDER_LABELS[settings.provider];
  if (!settings.voice) return `${provider} · choose a Voice`;
  if (!inUse) return `${provider} · ${settings.voice}`;
  return inUse.locale ? `${provider} · ${inUse.label} · ${inUse.locale}` : `${provider} · ${inUse.label}`;
}

export function Player({
  settings,
  playing,
  collapsed,
  onCollapsed,
  enabled,
  voiceInUse,
  reading,
  notes,
  onPlay,
  onPause,
  onSkip,
  onRate,
  onContents,
  onVoices,
  onHeight,
}: PlayerProps) {
  /**
   * Play or pause, and nothing else.
   *
   * **Pausing re-opens the player**, and that used to be a second line here.
   * It moved to `reading-view.tsx`, which owns `collapsed`, when ADR 0016 gave the
   * lock screen a pause of its own: a press on the lock screen has to leave the app
   * in a state this screen agrees with, and the only way that stays true is for
   * there to be one pause rather than two that were written to match.
   */
  const toggle = useCallback(() => {
    if (playing) {
      onPause();
      return;
    }
    onPlay();
  }, [playing, onPause, onPlay]);

  const measure = useCallback(
    (event: LayoutChangeEvent) => {
      onHeight(event.nativeEvent.layout.height);
    },
    [onHeight],
  );

  if (collapsed) {
    return (
      // `box-none` so the strip the button sits in does not eat taps on the text
      // beside it: with the controls hidden, tapping the page is the reading
      // position moving, and a band of dead page would be a puzzle.
      <View style={styles.collapsed} pointerEvents="box-none" onLayout={measure}>
        <Transport glyph={playing ? '‖' : '▸'} label={playing ? 'Pause' : 'Play'} primary onPress={toggle} disabled={!enabled} />
      </View>
    );
  }

  return (
    <View style={styles.player} onLayout={measure}>
      <View style={styles.head}>
        <Text style={styles.reading} numberOfLines={2}>
          {reading}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Collapse the player"
          hitSlop={10}
          onPress={() => onCollapsed(true)}
          style={({ pressed }) => [styles.chevronTap, pressed && styles.pressed]}
        >
          <Text style={styles.chevron}>⌄</Text>
        </Pressable>
      </View>

      {notes.map((note) => (
        <Text key={note.said} style={[styles.note, note.attention && styles.noteAttention]}>
          {note.said}
        </Text>
      ))}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose a Voice"
        onPress={onVoices}
        style={({ pressed }) => [styles.voice, pressed && styles.pressed]}
      >
        <Text style={styles.voiceLabel} numberOfLines={1}>
          {voiceLine(settings, voiceInUse)}
        </Text>
      </Pressable>

      <View style={styles.transport}>
        <Transport glyph="«¶" label="Previous paragraph" onPress={() => onSkip('previous-paragraph')} disabled={!enabled} />
        <Transport glyph="‹" label="Previous sentence" onPress={() => onSkip('previous-sentence')} disabled={!enabled} />
        <Transport glyph={playing ? '‖' : '▸'} label={playing ? 'Pause' : 'Play'} primary onPress={toggle} disabled={!enabled} />
        <Transport glyph="›" label="Next sentence" onPress={() => onSkip('next-sentence')} disabled={!enabled} />
        <Transport glyph="¶»" label="Next paragraph" onPress={() => onSkip('next-paragraph')} disabled={!enabled} />
      </View>

      <View style={styles.foot}>
        <Pressable
          accessibilityRole="button"
          onPress={onContents}
          style={({ pressed }) => [styles.footTap, pressed && styles.pressed]}
        >
          <Text style={styles.footLabel}>Contents</Text>
        </Pressable>
        <Speed rate={settings.rate} onRate={onRate} />
      </View>
    </View>
  );
}

/** One transport button: a character, a label for anyone who cannot see it, and a tap. */
function Transport({
  glyph,
  label,
  onPress,
  primary,
  disabled,
}: {
  glyph: string;
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.glyph, primary && styles.glyphPrimary]}>{glyph}</Text>
    </Pressable>
  );
}

/**
 * The speed: two arrows and a number, holding to repeat (ADR 0020).
 *
 * A stepper and not a menu of presets, because people settle on a pace that is
 * theirs and it is rarely one of five. It goes **slower** than natural speech as
 * well as faster: a dense paragraph or an unfamiliar language is a reason to slow
 * down, and the reading machinery costs nothing to run slowly.
 *
 * Every number shown comes out of `stepRate`, which walks an integer grid in
 * hundredths — so the value displayed is the value the node and the Word Timings
 * are both given, and no sum of 0.05s ever reaches the screen (`rate.ts` is the
 * argument, and it is not a small one).
 */
function Speed({ rate, onRate }: { rate: number; onRate(next: number): void }) {
  /** The live rate for the repeat below, which fires from a timer and cannot read a prop. */
  const rateRef = useRef(rate);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const release = useCallback(() => {
    if (delay.current) clearTimeout(delay.current);
    if (repeat.current) clearInterval(repeat.current);
    delay.current = null;
    repeat.current = null;
  }, []);

  // A finger held when the player closes, or when the screen goes away, would
  // otherwise leave an interval changing the reading speed of nothing.
  useEffect(() => release, [release]);

  const hold = useCallback(
    (direction: 1 | -1) => {
      release();
      onRate(stepRate(rateRef.current, direction));
      delay.current = setTimeout(() => {
        delay.current = null;
        let repeats = 0;
        repeat.current = setInterval(() => {
          repeats++;
          // Slow enough to land on a value at first, then covering the range — by
          // taking more steps per repeat rather than repeating faster. See the
          // constants above for why the cadence is the thing held down.
          const steps = repeats > HOLD_FINE_REPEATS ? HOLD_COARSE_STEPS : 1;
          onRate(stepRate(rateRef.current, direction * steps));
        }, HOLD_INTERVAL_MS);
      }, HOLD_DELAY_MS);
    },
    [onRate, release],
  );

  const shown = snapRate(rate);
  return (
    <View style={styles.speed}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Slower"
        onPressIn={() => hold(-1)}
        onPressOut={release}
        disabled={shown <= MIN_STEPPER_RATE}
        hitSlop={6}
        style={({ pressed }) => [styles.step, pressed && styles.pressed, shown <= MIN_STEPPER_RATE && styles.disabled]}
      >
        <Text style={styles.stepLabel}>−</Text>
      </Pressable>
      {/* Two decimals always, so the number does not change width as it is held and
          the two arrows do not move under the finger. */}
      <Text style={styles.rate}>{shown.toFixed(2)}×</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Faster"
        onPressIn={() => hold(1)}
        onPressOut={release}
        disabled={shown >= MAX_STEPPER_RATE}
        hitSlop={6}
        style={({ pressed }) => [styles.step, pressed && styles.pressed, shown >= MAX_STEPPER_RATE && styles.disabled]}
      >
        <Text style={styles.stepLabel}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * Both states are `position: absolute` against the reader's own box, which is the
 * whole of "it floats over the page": the document's layout does not mention it, so
 * nothing about the document changes when it appears or goes.
 */
const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: INK.panel,
    borderColor: INK.line,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    minWidth: 52,
    paddingHorizontal: 10,
  },
  buttonPrimary: { backgroundColor: INK.text, borderColor: INK.text, minWidth: 64 },
  chevron: { color: INK.quiet, fontSize: 20, lineHeight: 22 },
  chevronTap: { paddingHorizontal: 6 },
  collapsed: { alignItems: 'flex-end', bottom: 28, position: 'absolute', right: 16 },
  disabled: { opacity: 0.35 },
  foot: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  footLabel: { color: INK.text, fontSize: 15, fontWeight: '600' },
  footTap: { paddingVertical: 6 },
  glyph: { color: INK.text, fontSize: 18, fontWeight: '600' },
  glyphPrimary: { color: INK.page },
  head: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  note: { color: INK.quiet, fontSize: 12, lineHeight: 17 },
  noteAttention: { color: INK.attention },
  player: {
    backgroundColor: INK.panel,
    borderColor: INK.line,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    gap: 10,
    left: 0,
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 10,
    position: 'absolute',
    right: 0,
  },
  pressed: { opacity: 0.65 },
  rate: { color: INK.text, fontSize: 15, fontVariant: ['tabular-nums'], fontWeight: '600', minWidth: 62, textAlign: 'center' },
  reading: { color: INK.reading, flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  speed: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  step: {
    alignItems: 'center',
    backgroundColor: INK.page,
    borderColor: INK.line,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  stepLabel: { color: INK.text, fontSize: 18, fontWeight: '600' },
  transport: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'center' },
  voice: { alignSelf: 'center', paddingVertical: 2 },
  voiceLabel: { color: INK.text, fontSize: 14, fontWeight: '600' },
});
