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
 * not the phone's. In the light the sheet is the settings pages' grey. In the
 * dark the settings page is the reader's own near-black, and a drawer that
 * colour had no edge against the page it rises over, so the dark drawer is a
 * step lighter, the settings card's grey (the owner's Q44). Plain strings per
 * theme, because a SwiftUI modifier cannot take an `INK` colour (a
 * `DynamicColorIOS`) and a border must not (ADR 0046).
 *
 * ## A plain list, not cards
 *
 * Every drawer's rows sit straight on the drawer, inset as Apple Books inset
 * its contents (`drawer-list.ts`), with a separator under each one: the owner
 * turned down inset-grouped cards after batch 1 (#117, Q46). `DrawerRow`,
 * `DrawerRowText`, `DrawerSeparator` and `DrawerFooter` draw it in React
 * Native. A row the phone draws in a SwiftUI `List` takes the same numbers
 * through `listRowInsets`: `DRAWER.row.padding` above and below,
 * `DRAWER.row.textInset` before and `DRAWER.row.inset` after, so the two
 * kinds of row line up.
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
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type AccessibilityState, type StyleProp, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChoiceMenu, Footnote, INK, PALETTE, SchemeContext, SETTINGS_SURFACE, type Choice } from './controls';
import { drawerDetentHeight } from './drawer-height';
import { DRAWER_LIST, drawerRowText } from './drawer-list';
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
  /** A row of the drawer's plain list, as Books draws its contents: `drawer-list.ts`. The words' size is `row.text`. */
  row: DRAWER_LIST,
  /** From a list to the footer text under it, as the settings pages have it (`controls.tsx`). */
  footerGap: 8,
  /** Below the last thing in a drawer, above the home indicator's safe area. */
  bottom: 16,
  /**
   * Per theme: the sheet (`page`), the line under a row, the marked row
   * (Contents' current one), the round buttons' fill and rim, and the reading
   * amber the phone's own controls are tinted with where it would use its
   * blue (design 0042).
   *
   * The light column is the settings pages' (`SETTINGS_SURFACE`, the
   * separator `INK.separator` draws there, `PALETTE.light.line`). The dark one
   * is the drawer's own (Q44): the sheet is the settings card's #1c1c21, one
   * step above the reader's #111114. Its separator (#44444b) and mark
   * (#3e3e47) were lifted for the #2c2c32 cards batch 1 had (notes,
   * 2026-10-01 13:53); straight on #1c1c21 they stand further out, about as
   * far as Books' separators do on its own dark grey.
   */
  colours: {
    light: {
      page: SETTINGS_SURFACE.light.page, separator: '#e8e8e8', mark: PALETTE.light.line,
      button: SETTINGS_SURFACE.light.card, rim: PALETTE.light.line, accent: PALETTE.light.reading,
    },
    dark: {
      page: SETTINGS_SURFACE.dark.card, separator: '#44444b', mark: '#3e3e47',
      button: '#2c2c32', rim: '#3e3e47', accent: PALETTE.dark.reading,
    },
  },
} as const;

/** `DRAWER.colours` for the theme on screen, as `useBorders()` reads it: plain strings, for a SwiftUI modifier, a row and a border alike. */
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

/** The system's round header button: a 44-pt circle a step off the drawer's colour, with a hairline rim. */
function RoundButton({ icon, label, onPress, disabled, drawn }: {
  icon: IconName; label: string; onPress(): void; disabled?: boolean;
  /** The icon's size, stroke and sideways nudge in the circle: `DRAWER.button.back` or `.action`. */
  drawn: { glyph: number; stroke: number; nudge: number };
}) {
  const colours = useDrawerColours();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: colours.button, borderColor: colours.rim },
        (pressed || disabled) && styles.dimmed]}>
      <View style={{ transform: [{ translateX: drawn.nudge }] }}>
        <Icon name={icon} color={INK.text} size={drawn.glyph} strokeWidth={drawn.stroke} />
      </View>
    </Pressable>
  );
}

/**
 * One row of a drawer's list, straight on the drawer: at least 52 pt, as tall
 * as its words when they wrap, with its separator under it. `level` sets it in
 * by `DRAWER.row.indent` per level of a nested list; `marked` gives it the
 * mark's colour (Contents' current row). Without `onPress` it is not a button.
 */
export function DrawerRow({ children, onPress, marked, level = 0, disabled, accessibilityState }: {
  children: ReactNode;
  onPress?(): void;
  marked?: boolean;
  level?: number;
  disabled?: boolean;
  accessibilityState?: AccessibilityState;
}) {
  const colours = useDrawerColours();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        styles.row, { paddingLeft: DRAWER.row.textInset + level * DRAWER.row.indent },
        marked && { backgroundColor: colours.mark }, pressed && styles.pressed,
      ]}
    >
      {children}
      <DrawerSeparator />
    </Pressable>
  );
}

/**
 * The words of a `DrawerRow`, in full however many lines they take. Emphasized
 * is the row's emphasized weight, for the chapter being read and a heading.
 */
export function DrawerRowText({ children, emphasized = false, style }: { children: ReactNode; emphasized?: boolean; style?: StyleProp<TextStyle> }) {
  return <Text style={[emphasized ? styles.rowTextEmphasized : styles.rowText, style]}>{children}</Text>;
}

/** The line under a row, inset as Books' are, the same at both ends. Drawn as a filled view, not a border (ADR 0046). */
export function DrawerSeparator() {
  const colours = useDrawerColours();
  return <View style={[styles.separator, { backgroundColor: colours.separator }]} />;
}

/**
 * A row of the list that opens the system's short menu (`ChoiceMenu`, ADR
 * 0035): its name, what it is set to, and the two chevrons iOS puts on such a
 * row. One line, 52 pt, because the menu is laid out at the height it is given.
 */
export function DrawerMenuRow<T extends string | number>({ label, choices, chosen, onChoose }: {
  label: string; choices: readonly Choice<T>[]; chosen: T; onChoose(next: T): void;
}) {
  return (
    <View style={styles.menuRow}>
      <ChoiceMenu label={label} choices={choices} chosen={chosen} onChoose={onChoose} height={DRAWER.row.rowHeight}>
        <View style={styles.menuWords}>
          <Text style={[styles.rowText, styles.menuLabel]}>{label}</Text>
          <View style={styles.menuValue}>
            <Text style={[styles.rowText, styles.menuValueText]} numberOfLines={1}>
              {choices.find((choice) => choice.value === chosen)?.label}
            </Text>
            <Icon name="menu" color={INK.secondary} size={18} />
          </View>
        </View>
      </ChoiceMenu>
      <DrawerSeparator />
    </View>
  );
}

/** The words under a list: the phone's footer text, set in as far as the rows' words are. */
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
  row: {
    justifyContent: 'center', minHeight: DRAWER.row.rowHeight, paddingRight: DRAWER.row.inset,
    paddingVertical: DRAWER.row.padding,
  },
  pressed: { opacity: 0.65 },
  rowText: { ...drawerRowText(false), color: INK.text },
  rowTextEmphasized: { ...drawerRowText(true), color: INK.text },
  separator: {
    bottom: 0, height: DRAWER.row.separator, left: DRAWER.row.inset,
    position: 'absolute', right: DRAWER.row.inset,
  },
  footer: { marginTop: DRAWER.footerGap, paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset },
  // The menu's label spans the words, not the drawer: a label as wide as the
  // drawer took the whole drawer off the screen while its menu was open.
  menuRow: { height: DRAWER.row.rowHeight, paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset },
  menuWords: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 12, justifyContent: 'space-between' },
  menuLabel: { flexShrink: 0 },
  menuValue: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: 4 },
  menuValueText: { color: INK.secondary, flexShrink: 1 },
});
