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
 * - **Collapsing leaves the Reading Button and nothing else**, and takes the
 *   navigation bar with it (#67, ADR 0048). Pressing the button brings the player
 *   and the bar back and never plays or pauses; a pause from anywhere else still
 *   re-opens both. It was the player's own Play/Pause until #67, chosen so that
 *   someone reaching out to stop the reading always had a button to press; the
 *   button is still always there, so that is kept, and stopping from collapsed
 *   now takes two presses instead of one (`reading-button.tsx`).
 * - **A or M says whether the page follows the reading** (#71, ADR 0050), in the
 *   place left free for it beside the Voice name, drawn as Zotero-TTS draws it.
 *   **A** is a mark and nothing else: a tap on it does nothing. **M** is the one
 *   button that brings the page back to the reading without starting it (#53).
 *   Collapsed to the Reading Button, neither is shown, because collapsed the
 *   page only follows.
 *
 * Transport icons share their visual language with Zotero-TTS (design 0026).
 */

import { Host, Popover, RNHostView } from '@expo/ui/swift-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { MAX_STEPPER_RATE, MIN_STEPPER_RATE, snapRate, stepRate } from '../playback';

import { INK, useBorders } from './controls';
import { Icon, type IconName } from './icon';
import { PROVIDER_LABELS, type AppSettings } from './settings';
import type { SkipTarget } from './use-reading';
import { LoadingSpinner } from './loading-spinner';
import { READING_BUTTON_PLACE, ReadingButton } from './reading-button';
import { TEXT, TEXT_EMPHASIZED } from './text-styles';

/** The open player's padding above and below its rows: part of the height the Line Position is measured above (`onOpenHeight`). */
const PLAYER_PADDING_TOP = 4;
const PLAYER_PADDING_BOTTOM = 28;

/**
 * The width of each end of the transport row: Contents at the left, the speed at
 * the right (#115).
 *
 * One number for both, because the row spreads its buttons with equal gaps, and
 * Play is in its middle only while the two ends are as wide as each other. With
 * Contents at 44 and the speed at 58, Play sat 7 points left of the player's
 * centre, under a Voice name that is centred (#70). 58 is the speed's: `1.00×`
 * needs it.
 */
const TRANSPORT_END = 58;

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
  buffering?: boolean;
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
  /**
   * What the player says when attention is needed, in the words of whatever said it.
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
   * Whether the page follows the reading (**A**) or the owner is browsing (**M**),
   * as the renderer last said (#71).
   */
  following: boolean;
  /** M: bring the page back to the reading and follow it again, without starting it (#71, #53). */
  onReturn(): void;
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
  /**
   * How tall the player is when it is **open and has nothing to say**, in points:
   * its controls, padding and border, without the notes above them (#71).
   *
   * The Line Position is measured above this rather than above `onHeight`'s
   * band, which grows with every note and shrinks to one button when collapsed
   * (ADR 0050). Measured from the controls themselves, so it is reported only
   * when they change — not when a note comes or goes, and not while collapsed,
   * when they are not drawn and the last height stands.
   */
  onOpenHeight(height: number): void;
}

/**
 * A known name survives leaving the reader; internal ids are never a caption.
 * Without a Voice no Provider was chosen, so none is named (#103).
 */
function voiceLine(settings: AppSettings, inUse: { label: string; locale: string } | null): string {
  if (!settings.voice) return 'Choose a Voice';
  const provider = PROVIDER_LABELS[settings.provider];
  if (!inUse) return `${provider} · Voice`;
  return inUse.label;
}

export function Player({
  settings,
  playing,
  buffering = false,
  collapsed,
  onCollapsed,
  enabled,
  voiceInUse,
  notes,
  onPlay,
  onPause,
  onSkip,
  onRate,
  onContents,
  onVoices,
  following,
  onReturn,
  onHeight,
  onOpenHeight,
}: PlayerProps) {
  const [speedOpen, setSpeedOpen] = useState(false);
  const closeSpeed = useCallback(() => setSpeedOpen(false), []);
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

  const borders = useBorders();
  const measure = useCallback(
    (event: LayoutChangeEvent) => {
      onHeight(event.nativeEvent.layout.height);
    },
    [onHeight],
  );
  // The controls plus what the player puts around them, which is the whole open
  // player whenever no note is showing: its padding and its hairline border.
  const measureControls = useCallback(
    (event: LayoutChangeEvent) => {
      onOpenHeight(event.nativeEvent.layout.height + PLAYER_PADDING_TOP + PLAYER_PADDING_BOTTOM + 2 * StyleSheet.hairlineWidth);
    },
    [onOpenHeight],
  );

  if (collapsed && notes.length === 0) {
    return (
      // `box-none` so the strip the button sits in does not eat taps on the text
      // beside it: with the controls hidden, tapping the page is the reading
      // position moving, and a band of dead page would be a puzzle.
      <View style={styles.collapsed} pointerEvents="box-none" onLayout={measure}>
        <ReadingButton playing={playing} buffering={buffering} label="Show the player" onPress={() => onCollapsed(false)} />
      </View>
    );
  }

  return (
    <View style={[styles.player, { borderColor: borders.line }]} onLayout={measure}>
      {notes.map((note) => (
        <Text key={note.said} style={[styles.note, note.attention && styles.noteAttention]}>{note.said}</Text>
      ))}
      {/* The controls in a box of their own, so they can be measured without the
          notes above them (onOpenHeight, #71). The box carries the gap the
          player puts between its rows. */}
      <View style={styles.controls} onLayout={measureControls}>
        <View style={styles.head}>
          {/* As wide as the collapse arrow, so the name is centred on the whole
              player rather than on what the arrow leaves (#70), and holding A or
              M (#71). */}
          <FollowingMark following={following} onReturn={onReturn} />
          {/* Only the name opens the Voices: its button hugs the text, and a tap
              beside it lands on this plain box and does nothing. */}
          <View style={styles.voiceSlot}>
            <Pressable accessibilityRole="button" accessibilityLabel="Choose a Voice" onPress={onVoices}
              style={({ pressed }) => [styles.voice, pressed && styles.pressed]}>
              <Text style={styles.voiceLabel} numberOfLines={1}>{voiceLine(settings, voiceInUse)}</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Collapse the player"
            onPress={() => onCollapsed(true)} style={({ pressed }) => [styles.chevronTap, pressed && styles.pressed]}>
            <Icon name="down" color={INK.quiet} size={20} />
          </Pressable>
        </View>

        <View style={styles.transport}>
          <Pressable accessibilityRole="button" accessibilityLabel="Contents" onPress={onContents}
            style={({ pressed }) => [styles.footTap, pressed && styles.pressed]}>
            <Icon name="contents" color={INK.text} />
          </Pressable>
          <Transport icon="previousParagraph" label="Previous paragraph" onPress={() => onSkip('previous-paragraph')} disabled={!enabled} />
          <Transport icon="previous" label="Previous sentence" onPress={() => onSkip('previous-sentence')} disabled={!enabled} />
          <Transport loading={buffering} icon={playing ? 'pause' : 'play'} label={playing ? 'Pause' : 'Play'} primary onPress={toggle} disabled={!enabled} />
          <Transport icon="next" label="Next sentence" onPress={() => onSkip('next-sentence')} disabled={!enabled} />
          <Transport icon="nextParagraph" label="Next paragraph" onPress={() => onSkip('next-paragraph')} disabled={!enabled} />
          <SpeedBubble rate={settings.rate} onRate={onRate} open={speedOpen} onOpen={setSpeedOpen} />
        </View>
      </View>
      {/* A tap outside the phone's bubble closes it, and without this it also
          pressed whatever React Native button it landed on: measured, a tap on
          Contents closed the bubble and opened the contents too (notes,
          2026-09-23). The page and the header take no such tap. Laid over the
          player and nothing else, so an outside tap only closes, as the phone's
          own bubbles and the drawer this replaced both behave. */}
      {speedOpen ? <Pressable style={StyleSheet.absoluteFill} onPress={closeSpeed}
        accessible={false} importantForAccessibility="no-hide-descendants" /> : null}
    </View>
  );
}

/**
 * A or M (#71, ADR 0050), drawn as Zotero-TTS's player draws it: one letter in a
 * small rounded block, A on a quarter-strength wash of the reading colour and M
 * on nothing, in the player's text colour, with no animation.
 *
 * **A is a mark, not a button.** It has no press at all, so a tap on it lands on
 * this plain box and does nothing, and a screen reader reads it as text: the
 * page is following, and there is nothing to ask for. **M is a button**, the
 * whole 44-point box, and it brings the page back to the reading without
 * starting it (#53).
 */
function FollowingMark({ following, onReturn }: { following: boolean; onReturn(): void }) {
  const mark = (
    <View style={[styles.mark, following && styles.markFollowing]}>
      <Text style={styles.markLetter}>{following ? 'A' : 'M'}</Text>
    </View>
  );
  if (following) {
    return (
      <View style={styles.headEnd} accessible accessibilityRole="text" accessibilityLabel="Following the reading">
        {mark}
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Return to the reading" onPress={onReturn}
      style={({ pressed }) => [styles.headEnd, pressed && styles.pressed]}>
      {mark}
    </Pressable>
  );
}

/** One transport button: an icon, a label for anyone who cannot see it, and a tap. */
function Transport({
  icon,
  label,
  onPress,
  primary,
  disabled,
  loading,
}: {
  icon: IconName;
  label: string;
  onPress(): void;
  primary?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {loading ? <LoadingSpinner color={primary ? INK.page : INK.text} /> : <Icon name={icon} color={primary ? INK.page : INK.text} size={primary ? 26 : 24} />}
    </Pressable>
  );
}

/**
 * The speed at the end of the transport row, and the phone's own bubble it
 * opens above itself (design 0041, #48).
 *
 * The bubble is the system's popover, drawn and dismissed by the phone, with the
 * stepper inside it as React Native (`RNHostView`), which keeps the stepper's
 * own taps and hold-to-repeat: measured, one tap is 0.05 and a two-second hold
 * 21 steps, the same as in the drawer it replaces. It opens where the number is
 * because a drawer for one number was taller than the player it adjusted (175
 * points against 134), and a short choice opens where it was tapped (design
 * 0035). A second tap on the number closes it again.
 *
 * `Host` is the size the label's tap target always was; the label fills it.
 */
function SpeedBubble({ rate, onRate, open, onOpen }: {
  rate: number; onRate(next: number): void; open: boolean; onOpen(open: boolean): void;
}) {
  const shown = snapRate(rate).toFixed(2);
  return (
    <Host style={styles.rateHost}>
      <Popover isPresented={open} onIsPresentedChange={onOpen} attachmentAnchor="top" arrowEdge="bottom">
        <Popover.Trigger>
          <RNHostView>
            <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed, ${shown} times`}
              onPress={() => onOpen(!open)} style={({ pressed }) => [styles.rateTap, pressed && styles.pressed]}>
              <Text style={styles.rateLabel}>{shown}×</Text>
            </Pressable>
          </RNHostView>
        </Popover.Trigger>
        <Popover.Content>
          <RNHostView matchContents>
            <View style={styles.bubble} accessibilityLabel="Playback speed">
              <Speed rate={rate} onRate={onRate} />
            </View>
          </RNHostView>
        </Popover.Content>
      </Popover>
    </Host>
  );
}

/**
 * The speed: two round buttons and a number, holding to repeat (ADR 0020).
 *
 * Sized to the player it belongs to rather than to a drawer of its own: the
 * number at the phone's body size, a step above the player's own, and the
 * buttons small round ones with a full-size target (design 0041). A first
 * version drew a 34-point number between 56-point buttons, and next to the
 * player's 13-point number it read as belonging to something else.
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
        hitSlop={4}
        style={({ pressed }) => [styles.step, pressed && styles.pressed, shown <= MIN_STEPPER_RATE && styles.disabled]}
      >
        <Icon name="minus" color={INK.text} size={18} strokeWidth={2} />
      </Pressable>
      {/* Two decimals always, so the number does not change width as it is held and
          the two buttons do not move under the finger. */}
      <Text style={styles.rate}>{shown.toFixed(2)}×</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Faster"
        onPressIn={() => hold(1)}
        onPressOut={release}
        disabled={shown >= MAX_STEPPER_RATE}
        hitSlop={4}
        style={({ pressed }) => [styles.step, pressed && styles.pressed, shown >= MAX_STEPPER_RATE && styles.disabled]}
      >
        <Icon name="plus" color={INK.text} size={18} strokeWidth={2} />
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
    borderRadius: 22,
    height: 48,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 0,
  },
  // A circle, as tall as the player already was. It was 56 wide by 52 tall, a
  // capsule that read as an oval (#48); a larger circle would make the player
  // taller, and every point of it is a point of the page it covers.
  buttonPrimary: { backgroundColor: INK.text, width: 52, minWidth: 52, height: 52, borderRadius: 26 },
  chevronTap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  collapsed: { alignItems: 'flex-end', ...READING_BUTTON_PLACE },
  // The player's own gap between its rows, carried by the box the rows are
  // measured in (onOpenHeight).
  controls: { gap: 6 },
  disabled: { opacity: 0.35 },
  footTap: { width: TRANSPORT_END, height: 44, alignItems: 'center', justifyContent: 'center' },
  head: { alignItems: 'center', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  // The box A or M sits in: as wide as the collapse arrow opposite (#70), and as
  // tall, so M's whole box is its 44-point target.
  headEnd: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  // Zotero-TTS's block, measured out of its player.css: 27 by 26, corners of 4,
  // the letter at 13 in the system font (#71).
  mark: { alignItems: 'center', borderRadius: 4, height: 26, justifyContent: 'center', width: 27 },
  markFollowing: { backgroundColor: INK.readingWash },
  markLetter: { ...TEXT_EMPHASIZED.footnote, color: INK.text },
  note: { ...TEXT.caption1, color: INK.quiet },
  noteAttention: { color: INK.attention },
  player: {
    backgroundColor: INK.panel,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    gap: 6,
    left: 0,
    paddingBottom: PLAYER_PADDING_BOTTOM,
    paddingHorizontal: 12,
    paddingTop: PLAYER_PADDING_TOP,
    position: 'absolute',
    right: 0,
  },
  pressed: { opacity: 0.65 },
  rateHost: { height: 44, width: TRANSPORT_END },
  rateTap: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  // A step above the voice's 14 beside it; at 13 it was the smallest thing on
  // the row of 24-point icons it ends.
  rateLabel: { ...TEXT_EMPHASIZED.subhead, color: INK.text, fontVariant: ['tabular-nums'] },
  bubble: { paddingHorizontal: 14, paddingVertical: 12 },
  rate: { ...TEXT.headline, color: INK.text, fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'center' },
  speed: { alignItems: 'center', flexDirection: 'row', gap: 16 },
  // Filled rather than outlined, the player's family of round buttons, at 36 with
  // `hitSlop` making up the 44-point target.
  step: { alignItems: 'center', backgroundColor: INK.line, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  transport: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  voice: { alignItems: 'center', justifyContent: 'center', maxWidth: '100%', minHeight: 44, minWidth: 44 },
  voiceLabel: { ...TEXT.subhead, color: INK.text },
  voiceSlot: { alignItems: 'center', flex: 1 },
});
