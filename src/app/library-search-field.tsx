import { Button, Capsule, Host } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled as nativeDisabled, foregroundStyle, glassEffect, labelStyle } from '@expo/ui/swift-ui/modifiers';
import { useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { INK, SchemeContext, useAccent } from './controls';
import { Icon } from './icon';
import { TEXT } from './text-styles';

/** iOS 26's glass. Before it the phone drew a search field as a grey fill, which the capsule falls back to. */
const GLASS = Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * The room the field takes above the list: the capsule's 44 points, 1 above it
 * under the title bar and 15 below it above the list, as the phone left them.
 */
const SLOT = 60;
const CAPSULE = 44;
/** Close's room: the 10 points between it and the capsule, and Close as drawn (44 until it has been laid out). */
const GAP = 10;
const ROOM = GAP + 44;
/**
 * The phone's stacked search field moves on one spring, fitted from its frames
 * (iOS 27.0, notes 2026-11-02): natural frequency about 18.7 rad/s, damping
 * ratio about 0.8, so a 0.75-point overshoot of its 54. The list moves on the
 * same spring, and so does the field's fade on the way out. Reduce Motion
 * changes nothing on the phone, so it changes nothing here.
 */
const SPRING = { mass: 1, stiffness: 350, damping: 30, reduceMotion: ReduceMotion.Never };
/** Close arrives whole when the field has settled: about 0.35 s after the motion begins. */
const CLOSE_AFTER = 350;

/**
 * Library Search's field, drawn by the app under the page's title while search
 * is open (#339, design 0090). It copies the field the phone stacked under the
 * title before, as measured from the phone (iPhone 17, iOS 27.0, notes
 * 2026-11-01): a 44-point capsule 16 points in from each edge, its magnifying
 * glass 14 points in, the words 10 points after it in Body, and a 44-point round
 * close control 10 points to its right. The phone draws the capsule's glass and
 * the close control (`@expo/ui`); the field and the magnifying glass are the
 * app's.
 *
 * It moves as the phone's own field does (#341, notes 2026-11-02). Opening, the
 * capsule grows from nothing under the title with its top fixed, full width at
 * first and narrowing as Close's room opens, its magnifying glass and words at
 * full size, centred, clipped by it and fading in as it grows; the list's top
 * edge comes down with it in every frame; Close appears whole once it has
 * settled. Closing, the field, its words and Close fade out in place, over the
 * list, while the list's top edge goes back up on the same spring. Every value
 * moves from where it is, so a close during the opening, or an opening during
 * the close, turns back from there. When the page is not in front (`animate`
 * false) a close takes the field away at once.
 *
 * The field stays mounted while it fades, so it outlives `open`. It takes the
 * keyboard as it appears (`autoFocus`, which the text input acts on when it
 * reaches the window, so it cannot run before the field exists), gives it up
 * the moment `open` ends, and takes it again only when it opens while still
 * fading. While results are selected it is `locked`: greyed, with the query
 * showing and neither the field nor the close control answering.
 */
export function LibrarySearchField({ open, animate, field, query, locked, onChangeText, onClose, style }: {
  open: boolean; animate: boolean; field: RefObject<TextInput | null>; query: string; locked: boolean;
  onChangeText(text: string): void; onClose(): void; style?: StyleProp<ViewStyle>;
}) {
  const scheme = useContext(SchemeContext);
  const accent = useAccent();
  /** Drawn from the moment search opens until the field's fade has finished, so it outlives `open`. */
  const [present, setPresent] = useState(open);
  /** The list's top edge: the slot's share of its 60 points. */
  const lift = useSharedValue(0);
  /** The capsule's growth, its contents' fade-in and Close's room. It does not shrink on the way out. */
  const grow = useSharedValue(0);
  /** The whole field's opacity, which falls only on the way out. */
  const shown = useSharedValue(1);
  const close = useSharedValue(0);
  const roomWidth = useSharedValue(ROOM);
  const was = useRef(open);
  const turn = useRef(0);
  const settled = (at: number) => { if (turn.current === at) setPresent(false); };

  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const at = ++turn.current;
    if (open) {
      // Still drawn: the same mounted view, fading, which autoFocus does not act on again.
      const reopening = present;
      setPresent(true); // eslint-disable-line react-hooks/set-state-in-effect
      lift.set(withSpring(1, SPRING));
      grow.set(withSpring(1, SPRING));
      shown.set(withSpring(1, SPRING));
      if (close.get() < 1) close.set(withDelay(CLOSE_AFTER, withTiming(1, { duration: 0, reduceMotion: ReduceMotion.Never }), ReduceMotion.Never));
      if (reopening) field.current?.focus();
      return;
    }
    field.current?.blur();
    // A close before Close has appeared keeps it hidden.
    cancelAnimation(close);
    if (!animate) {
      cancelAnimation(lift); cancelAnimation(grow); cancelAnimation(shown);
      lift.set(0); grow.set(0); shown.set(1); close.set(0);
      setPresent(false);
      return;
    }
    shown.set(withSpring(0, SPRING));
    lift.set(withSpring(0, SPRING, (finished) => {
      if (finished) scheduleOnRN(settled, at);
    }));
    // `field`, the shared values and `settled` keep their identity; only the transitions matter here.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Once the field has gone, the next opening starts from nothing. */
  useLayoutEffect(() => {
    if (open || present) return;
    grow.set(0); close.set(0); shown.set(1);
  }, [open, present, grow, close, shown]);

  // The overshoot below zero on the way out lifts the list a fraction of a point past its place, as the phone's does.
  const slot = useAnimatedStyle(() => ({ height: Math.max(0, SLOT * lift.get()), marginBottom: Math.min(0, SLOT * lift.get()) }));
  const whole = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const capsule = useAnimatedStyle(() => ({ height: Math.max(0, CAPSULE * grow.get()) }));
  const clip = useAnimatedStyle(() => ({ borderRadius: Math.max(0, CAPSULE * grow.get()) / 2 }));
  const contents = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, grow.get())) }));
  const room = useAnimatedStyle(() => ({ width: Math.max(0, roomWidth.get() * grow.get()) }));
  const button = useAnimatedStyle(() => ({ opacity: close.get() }));

  if (!open && !present) return null;
  return <Animated.View style={[styles.slot, style, slot]} pointerEvents={open ? 'box-none' : 'none'}>
    <Animated.View style={[styles.bar, whole]} pointerEvents="box-none">
      <Animated.View style={[styles.capsule, locked && styles.locked, capsule]}>
        <Host style={StyleSheet.absoluteFill} colorScheme={scheme ?? undefined} pointerEvents="none">
          <Capsule modifiers={GLASS
            ? [foregroundStyle('#00000000'), glassEffect({ glass: { variant: 'regular' }, shape: 'capsule' })]
            : [foregroundStyle({ type: 'hierarchical', style: 'quaternary' })]} />
        </Host>
        <Animated.View style={[styles.clip, clip]}>
        <Animated.View style={[styles.contents, contents]}>
          <Pressable style={styles.field} disabled={locked} accessible={false} onPress={() => field.current?.focus()}>
            <View style={styles.magnifier} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name="search" color={INK.text} size={MAGNIFIER.box} strokeWidth={MAGNIFIER.stroke} />
            </View>
            <TextInput ref={field} style={styles.input} value={query} onChangeText={onChangeText} editable={!locked}
              autoFocus placeholder="Search Library" placeholderTextColor={INK.searchPrompt} selectionColor={accent.reading}
              accessibilityLabel="Search Library" testID="library-search-field"
              autoCapitalize="none" autoCorrect={false} spellCheck={false} clearButtonMode="while-editing"
              returnKeyType="search" enablesReturnKeyAutomatically onSubmitEditing={() => field.current?.blur()} />
          </Pressable>
        </Animated.View>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.room, room]} pointerEvents="box-none">
        <Animated.View style={[styles.close, button]} onLayout={(event) => roomWidth.set(event.nativeEvent.layout.width)}>
          <Host matchContents colorScheme={scheme ?? undefined}>
            <Button label="Close" systemImage="xmark" onPress={onClose} modifiers={[
              labelStyle('iconOnly'), buttonStyle(GLASS ? 'glass' : 'bordered'), buttonBorderShape('circle'), controlSize('large'),
              nativeDisabled(locked), accessibilityLabel('Close'),
            ]} />
          </Host>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  </Animated.View>;
}

/**
 * The measured magnifying glass: 16 points across, 2 thick. `Icon`'s search path
 * fills 19 of its 24 units, so a 20-point box draws it 16 across.
 */
const MAGNIFIER = { box: 20, stroke: 2.2, inset: 12 } as const;

const styles = StyleSheet.create({
  // Above the list, so the field fades over it as the list comes back up, as the title bar's did.
  slot: { zIndex: 1, overflow: 'visible' },
  // The capsule's top is a point below the title bar's, its bottom 15 above the list, as the phone left them.
  bar: { position: 'absolute', top: 0, left: 0, right: 0, height: SLOT, flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 1 },
  capsule: { flex: 1 },
  // The glass is not clipped; the contents are, full size from the start and centred in the growing capsule.
  clip: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', justifyContent: 'center' },
  contents: { height: CAPSULE },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingLeft: MAGNIFIER.inset, paddingRight: 6 },
  magnifier: { width: MAGNIFIER.box, height: MAGNIFIER.box },
  input: { ...TEXT.body, color: INK.text, flex: 1, alignSelf: 'stretch', marginLeft: 10, paddingVertical: 0 },
  room: { height: CAPSULE, overflow: 'visible' },
  // Close at the room's right end, which is the margin: the room opens from nothing as the capsule grows.
  close: { position: 'absolute', top: 0, bottom: 0, right: 0, paddingLeft: GAP, justifyContent: 'center' },
  locked: { opacity: 0.5 },
});
