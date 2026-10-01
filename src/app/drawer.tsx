/**
 * **A drawer**, on the phone's own sheet (#117, ADR 0066).
 *
 * `@expo/ui`'s SwiftUI `BottomSheet`, with the drawer's React Native content
 * hosted in it through `RNHostView`. The phone draws the sheet, its drag, its
 * drag indicator and its two heights; the app draws what is on it, to the
 * phone's own measurements (design 0042). Everything a drawer is drawn to is
 * in `DRAWER` below, and every drawer takes it from there, so two drawers
 * cannot end up a few points apart. The drawers not moved yet still use
 * `sheet.tsx`.
 *
 * ## Two heights
 *
 * A drawer opens at the **Drawer Height**, the owner's (`drawer-height.ts`),
 * every time: the sheet's content is mounted afresh at each opening, and the
 * first detent in the list is where it starts (`PresentationModifiers.swift`).
 * Swiping up takes it to the phone's `large`; swiping down returns it, and
 * then closes it. A swipe up on its content grows the drawer first and only
 * then scrolls the content: `@expo/ui` 57 has no
 * `presentationContentInteraction`, and the owner accepted iOS's default.
 *
 * ## The page behind
 *
 * At the Drawer Height the page is neither dimmed nor locked
 * (`presentationBackgroundInteraction`, enabled up through that detent): a
 * drawer that covers the page's controls under a dark wash leaves the page
 * unjudgeable while, say, a colour is chosen for it. At `large` the phone dims
 * it. A tap outside never closes a drawer; a swipe down does.
 *
 * ## The header is the app's
 *
 * `@expo/ui` 57 has no inline title mode, so the system's toolbar would always
 * start with a large title on the left. The header is drawn here instead: a
 * centred title in Headline, an optional round back button copied from the
 * system's pushed page, and no close button, since a swipe down is how a sheet
 * is dismissed (the HIG's Sheets page).
 *
 * ## Colours
 *
 * The app's own, opaque, for the theme the shell resolved (`SchemeContext`),
 * not the phone's. In the light the sheet is the settings pages' grey and its
 * cards are their white cards. In the dark the settings page is the reader's
 * own near-black, and a drawer that colour had no edge against the page it
 * rises over, so the dark drawer is a step lighter, the settings card's grey,
 * and its cards a step lighter again (the owner's Q44). Plain strings per
 * theme, because a SwiftUI modifier cannot take an `INK` colour (a
 * `DynamicColorIOS`) and a border must not (ADR 0046).
 *
 * ## One at a time
 *
 * Every drawer, old (`sheet.tsx`) and new, and the lookup drawer, waits its
 * turn through `useDrawerTurn` (`drawer-turns.ts`): asking for one while
 * another is up closes that one first.
 */

import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import {
  environment, presentationBackground, presentationBackgroundInteraction, presentationDetents,
  presentationDragIndicator, tint,
} from '@expo/ui/swift-ui/modifiers';
import { useCallback, useContext, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Footnote, INK, PALETTE, SchemeContext, SETTINGS_SURFACE } from './controls';
import { drawerDetentHeight } from './drawer-height';
import { createDrawerTurns } from './drawer-turns';
import { Icon, type IconName } from './icon';
import { useShell } from './routes';
import { TEXT } from './text-styles';

/**
 * Every value a drawer is drawn to (#117), measured on the phone's own sheet
 * on an iOS 27.0 iPhone 17 simulator (notes, 2026-10-01 11:35 and 11:45, at
 * `large`, where nothing is scaled). The height it opens at is worked out in
 * `drawer-height.ts`, where a test can reach the arithmetic.
 */
export const DRAWER = {
  /** The height a drawer can be swiped up to, above the Drawer Height: the phone's own full height. */
  expanded: 'large',
  header: {
    /** From the sheet's top edge to the top of the header's buttons: the system's close button is 15.67 below it. */
    top: 16,
    /** The header's row, as tall as its round buttons; the title is centred on it. */
    height: 44,
    /** From the header's row to what is under it. */
    gap: 16,
  },
  /**
   * The round button at either end of the header, copied from the system's
   * pushed-page back button (`/tmp/sheet-probe/14-…-pushed.png`): a 44-pt
   * circle 16 from the screen's edge and from the sheet's top. The back
   * chevron measured 11 × 18.7 pt, 1.5 pt left of the circle's centre; the
   * action's icon is drawn at the size the system's close X is, about 17 pt
   * of glyph.
   */
  button: {
    size: 44, side: 16,
    back: { glyph: 32, stroke: 2, nudge: -1.5 },
    action: { glyph: 22, stroke: 1.8, nudge: 0 },
  },
  /** An inset-grouped card: 16 from the screen's edges, ≈ 26 pt corners (measured 26.4 and 26.2). */
  card: { margin: 16, radius: 26 },
  /** A card's row: 52 pt with one line of Body, its words 16 in from the card's edge. */
  row: { height: 52, inset: 16 },
  /** The line between two rows: 1 pt, inset 16 inside the card at both ends. */
  separator: { inset: 16, thickness: 1 },
  /** Between one card and the next: measured 35. */
  sectionGap: 35,
  /** From a card to the footer text under it, as the settings pages have it (`controls.tsx`). */
  footerGap: 8,
  /** Below the last thing in a drawer, above the home indicator's safe area. */
  bottom: 16,
  /**
   * Per theme: the sheet (`page`), its cards, the line between two rows, the
   * marked row (Contents' current one), the round buttons' rim, and the
   * reading amber the phone's own controls are tinted with where it would use
   * its blue (design 0042).
   *
   * The light column is the settings pages' (`SETTINGS_SURFACE`, the
   * separator `INK.separator` draws there, `PALETTE.light.line`). The dark one
   * is the drawer's own (Q44): the sheet is the settings card's #1c1c21, one
   * step above the reader's #111114, and the cards #2c2c32, one step above
   * that. The settings pages' dark separator (#38383b) and line (#33333c)
   * all but vanish on #2c2c32, so the separator and the mark are lifted with
   * the card (notes, 2026-10-01 13:53).
   */
  colours: {
    light: {
      page: SETTINGS_SURFACE.light.page, card: SETTINGS_SURFACE.light.card, separator: '#e8e8e8',
      mark: PALETTE.light.line, rim: PALETTE.light.line, accent: PALETTE.light.reading,
    },
    dark: {
      page: SETTINGS_SURFACE.dark.card, card: '#2c2c32', separator: '#44444b',
      mark: '#3e3e47', rim: '#3e3e47', accent: PALETTE.dark.reading,
    },
  },
} as const;

/** `DRAWER.colours` for the theme on screen, as `useBorders()` reads it: plain strings, for a SwiftUI modifier, a card and a border alike. */
export function useDrawerColours(): (typeof DRAWER.colours)[keyof typeof DRAWER.colours] & { scheme: keyof typeof DRAWER.colours } {
  const scheme = useContext(SchemeContext);
  if (!scheme) throw new Error('A drawer was drawn outside the shell, which is what says whether the theme on screen is light or dark.');
  return { ...DRAWER.colours[scheme], scheme };
}

/** The app's one queue of drawers (`drawer-turns.ts`). */
const DRAWER_TURNS = createDrawerTurns();

/**
 * A drawer's turn: whether it may be presented now, and what to call when its
 * dismissal has finished (#117, Q43).
 *
 * `visible` is what its owner wants; `presented` is that, once every other
 * drawer is down. `close` is the owner's `onClose`, which is how another
 * drawer asking for its turn takes this one down. `dismissed` is the native
 * dismissal's end (`BottomSheet`'s and `Modal`'s `onDismiss`); a drawer with
 * no animation of its own (`animated: false`, the lookup drawer) is gone as
 * soon as it is closed. A drawer swiped away reports its dismissal before its
 * owner closes it, so it is gone at whichever of the two comes second.
 */
export function useDrawerTurn(visible: boolean, close: () => void, { animated = true }: { animated?: boolean } = {}): {
  presented: boolean;
  dismissed(): void;
} {
  const id = useId();
  const closing = useRef(close);
  const wanted = useRef(visible);
  const down = useRef(false);
  const up = useSyncExternalStore(DRAWER_TURNS.subscribe, () => DRAWER_TURNS.isUp(id));
  useEffect(() => { closing.current = close; });
  useEffect(() => { if (up) down.current = false; }, [up]);
  useEffect(() => {
    wanted.current = visible;
    if (visible) DRAWER_TURNS.ask(id, () => closing.current());
    else {
      DRAWER_TURNS.leave(id);
      if (!animated || down.current) DRAWER_TURNS.gone(id);
    }
  }, [visible, id, animated]);
  useEffect(() => () => { DRAWER_TURNS.leave(id); DRAWER_TURNS.gone(id); }, [id]);
  const dismissed = useCallback(() => {
    down.current = true;
    if (!wanted.current) DRAWER_TURNS.gone(id);
  }, [id]);
  return { presented: visible && up, dismissed };
}

/** The one button at the right end of a title on the left: a Document's Share (batch 2 of #117). */
export interface DrawerAction {
  icon: IconName;
  /** What VoiceOver says. The button shows no words. */
  label: string;
  onPress(): void;
  disabled?: boolean;
}

/**
 * The header's two forms. Centred, with a back button on its left when the
 * page was reached from another page of the same drawer; or the title on the
 * left and one action on its right, which is a Document's actions menu.
 */
type DrawerHeader = { onBack?(): void; action?: never } | { action: DrawerAction; onBack?: never };

export function Drawer({ visible, title, onClose, onBack, action, children }: {
  visible: boolean;
  title: string;
  /** Called when the drawer is swiped away, and by VoiceOver's escape. Not by a tap outside: there is none. */
  onClose(): void;
  children: ReactNode;
} & DrawerHeader) {
  const { settings } = useShell();
  const colours = useDrawerColours();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const opening = { height: drawerDetentHeight(settings.drawerHeight, { width: window.width, height: window.height, bottomInset: insets.bottom }) };
  const turn = useDrawerTurn(visible, onClose);
  return (
    <Host style={styles.host} colorScheme={colours.scheme}>
      <BottomSheet isPresented={turn.presented} onDismiss={turn.dismissed}
        onIsPresentedChange={(presented) => { if (!presented) onClose(); }}>
        <Group modifiers={[
          presentationDetents([opening, DRAWER.expanded]),
          presentationDragIndicator('visible'),
          presentationBackgroundInteraction({ type: 'enabledUpThrough', detent: opening }),
          presentationBackground(colours.page),
          environment('colorScheme', colours.scheme),
          tint(colours.accent),
        ]}>
          <RNHostView>
            <View style={styles.body} onAccessibilityEscape={onClose}>
              <DrawerTitle title={title} onBack={onBack} action={action} />
              {children}
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function DrawerTitle({ title, onBack, action }: { title: string; onBack?(): void; action?: DrawerAction }) {
  if (action) {
    return (
      <View style={styles.header}>
        <Text style={[styles.title, styles.titleLeading]} accessibilityRole="header" numberOfLines={2}>{title}</Text>
        <RoundButton icon={action.icon} label={action.label} onPress={action.onPress} disabled={action.disabled} drawn={DRAWER.button.action} />
      </View>
    );
  }
  return (
    <View style={styles.header}>
      {/* Absolute and inset by a button on both sides, so the title is centred on the drawer rather than on what the back button leaves of it. */}
      <View style={styles.titleCentred}>
        <Text style={[styles.title, styles.titleCentredText]} accessibilityRole="header" numberOfLines={1}>{title}</Text>
      </View>
      {onBack ? <RoundButton icon="previous" label={`Back from ${title}`} onPress={onBack} drawn={DRAWER.button.back} /> : null}
    </View>
  );
}

/** The system's round header button: a 44-pt circle on the card colour, with a hairline rim. */
function RoundButton({ icon, label, onPress, disabled, drawn }: {
  icon: IconName; label: string; onPress(): void; disabled?: boolean;
  /** The icon's size, stroke and sideways nudge in the circle: `DRAWER.button.back` or `.action`. */
  drawn: { glyph: number; stroke: number; nudge: number };
}) {
  const colours = useDrawerColours();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: colours.card, borderColor: colours.rim },
        (pressed || disabled) && styles.dimmed]}>
      <View style={{ transform: [{ translateX: drawn.nudge }] }}>
        <Icon name={icon} color={INK.text} size={drawn.glyph} strokeWidth={drawn.stroke} />
      </View>
    </Pressable>
  );
}

/**
 * An inset-grouped card on the drawer, in the card colour. Its rows are the
 * caller's: drawn to `DRAWER.row`, with `DrawerSeparator` between them.
 */
export function DrawerCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colours = useDrawerColours();
  return <View style={[styles.card, { backgroundColor: colours.card }, style]}>{children}</View>;
}

/** The line under a card's row, inset as the phone's are. Drawn as a filled view, not a border (ADR 0046). */
export function DrawerSeparator() {
  const colours = useDrawerColours();
  return <View style={[styles.separator, { backgroundColor: colours.separator }]} />;
}

/** The words under a card: the phone's footer text, set in from the card as far as its rows' words are. */
export function DrawerFooter({ children, attention }: { children: ReactNode; attention?: boolean }) {
  return <View style={styles.footer}><Footnote attention={attention}>{children}</Footnote></View>;
}

const styles = StyleSheet.create({
  // The sheet is presented from the window, not from here; the host only has to exist.
  host: { position: 'absolute', bottom: 0, right: 0, width: 1, height: 1 },
  body: { flex: 1, paddingBottom: DRAWER.bottom },
  header: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12,
    marginBottom: DRAWER.header.gap, marginTop: DRAWER.header.top, minHeight: DRAWER.header.height,
    paddingHorizontal: DRAWER.button.side,
  },
  title: { ...TEXT.headline, color: INK.text },
  titleCentred: {
    bottom: 0, justifyContent: 'center', left: DRAWER.button.side + DRAWER.button.size, position: 'absolute',
    right: DRAWER.button.side + DRAWER.button.size, top: 0,
  },
  titleCentredText: { textAlign: 'center' },
  titleLeading: { flex: 1 },
  button: {
    alignItems: 'center', borderRadius: DRAWER.button.size / 2, borderWidth: StyleSheet.hairlineWidth,
    height: DRAWER.button.size, justifyContent: 'center', width: DRAWER.button.size,
  },
  dimmed: { opacity: 0.5 },
  card: { borderCurve: 'continuous', borderRadius: DRAWER.card.radius, marginHorizontal: DRAWER.card.margin, overflow: 'hidden' },
  separator: {
    bottom: 0, height: DRAWER.separator.thickness, left: DRAWER.separator.inset,
    position: 'absolute', right: DRAWER.separator.inset,
  },
  footer: { marginTop: DRAWER.footerGap, paddingHorizontal: DRAWER.card.margin + DRAWER.row.inset },
});
