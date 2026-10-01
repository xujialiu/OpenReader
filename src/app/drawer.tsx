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
  environment, ignoreSafeArea, presentationBackground, presentationBackgroundInteraction, presentationDetents,
  presentationDragIndicator, tint,
} from '@expo/ui/swift-ui/modifiers';
import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type ReactElement, type ReactNode,
} from 'react';
import {
  FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions,
  type AccessibilityRole, type AccessibilityState, type ColorValue, type FlatListProps, type StyleProp, type TextStyle,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Footnote, INK, PALETTE, SchemeContext, SETTINGS_SURFACE } from './controls';
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
  /**
   * Below the last thing in a drawer, above the home indicator's safe area.
   * A list that ends the drawer runs on under both, to the sheet's bottom
   * edge, as Books' contents do, and only its last row stops here
   * (`DrawerList`, `DrawerScroll`).
   */
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

/**
 * How far above the sheet's bottom edge a drawer's content ends: the home
 * indicator's safe area and `DRAWER.bottom`. The sheet's content reaches the
 * edge (`ignoreSafeArea`), and the drawer's body is padded by this, so words
 * under a list stand clear of the home indicator. A list that ends the drawer
 * runs on through the padding and pads its own content instead, so its rows
 * reach the edge and its last row still scrolls clear.
 *
 * The first drawer stopped every list this far above the edge, and a drawer
 * grown to full height showed a blank strip of 60 pt under its last row, where
 * Books runs its rows on to the bottom of the screen (notes, 2026-10-01).
 */
const DrawerBottom = createContext<number>(DRAWER.bottom);

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

/**
 * The one button at the right end of the header. With an `icon` it is a round
 * button showing only the icon, `label` being what VoiceOver says: a
 * Document's Share. Without one it is a capsule with `label` in it: Download's
 * Select all, as the phone puts a word in a toolbar.
 */
export interface DrawerAction {
  icon?: IconName;
  label: string;
  onPress(): void;
  disabled?: boolean;
}

/**
 * The header's two forms. Centred, with a back button on its left when the
 * page was reached from another page of the same drawer, and an action on its
 * right when the page has one; or, `titleLeft`, the title on the left in up to
 * two lines and one action on its right, which is a Document's actions menu
 * (design 0057).
 */
type DrawerHeader =
  | { titleLeft?: false; onBack?(): void; action?: DrawerAction }
  | { titleLeft: true; action: DrawerAction; onBack?: never };

export function Drawer({ visible, title, onClose, onBack, action, titleLeft, children }: {
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
  const bottom = insets.bottom + DRAWER.bottom;
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
          // Down to the sheet's bottom edge, under the home indicator, so a list can run on to it (`DrawerBottom`).
          ignoreSafeArea({ regions: 'container', edges: 'bottom' }),
        ]}>
          <RNHostView>
            {/*
              * Gesture handler's root again, inside the sheet: the sheet is presented
              * in a view controller of its own, out of reach of the app's root, as
              * a `Modal` was. Download's two-finger sweep needs it (ADR 0045).
              */}
            <GestureHandlerRootView style={[styles.body, { paddingBottom: bottom }]} onAccessibilityEscape={onClose}>
              <DrawerBottom value={bottom}>
                <DrawerTitle title={title} onBack={onBack} action={action} titleLeft={!!titleLeft} />
                {children}
              </DrawerBottom>
            </GestureHandlerRootView>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

function DrawerTitle({ title, onBack, action, titleLeft }: { title: string; onBack?(): void; action?: DrawerAction; titleLeft: boolean }) {
  // How far in the centred title is kept on both sides: past the wider of the two ends, so it is centred on the drawer.
  const [actionWidth, setActionWidth] = useState(0);
  if (titleLeft && action) {
    return (
      <View style={styles.header}>
        <Text style={[styles.title, styles.titleLeading]} accessibilityRole="header" numberOfLines={2}>{title}</Text>
        <HeaderAction action={action} />
      </View>
    );
  }
  const clear = DRAWER.button.side + Math.max(onBack ? DRAWER.button.size : 0, action ? actionWidth : 0, DRAWER.button.size);
  return (
    <View style={styles.header}>
      {/* Absolute, so the title is centred on the drawer rather than on what the buttons leave of it. */}
      <View style={[styles.titleCentred, { left: clear, right: clear }]}>
        <Text style={[styles.title, styles.titleCentredText]} accessibilityRole="header" numberOfLines={1}>{title}</Text>
      </View>
      {onBack ? <RoundButton icon="previous" label={`Back from ${title}`} onPress={onBack} drawn={DRAWER.button.back} /> : <View />}
      {action ? <View onLayout={(event) => setActionWidth(event.nativeEvent.layout.width)}><HeaderAction action={action} /></View> : null}
    </View>
  );
}

function HeaderAction({ action }: { action: DrawerAction }) {
  return action.icon
    ? <RoundButton icon={action.icon} label={action.label} onPress={action.onPress} disabled={action.disabled} drawn={DRAWER.button.action} />
    : <CapsuleButton label={action.label} onPress={action.onPress} disabled={action.disabled} />;
}

/** A word in the header's right end, in the round button's capsule: the phone's toolbar draws a word as it draws an icon. */
function CapsuleButton({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) {
  const colours = useDrawerColours();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, styles.capsule, { backgroundColor: colours.button, borderColor: colours.rim },
        (pressed || disabled) && styles.dimmed]}>
      <Text style={styles.capsuleText} numberOfLines={1}>{label}</Text>
    </Pressable>
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
 * mark's colour (Contents' current row). `icon` stands before the words, and
 * `accessory` after them at the right: a value, a chevron, a check, a control.
 * An accessory taller than a line is drawn over the row's padding rather than
 * growing it, so a one-line row stays 52 pt.
 *
 * Without `onPress` it is a plain view, not a button, so it can be what a
 * system menu draws (`ChoiceMenu`) or hold buttons of its own.
 */
export function DrawerRow({ children, onPress, marked, level = 0, disabled, icon, iconColour, accessory, accessibilityRole, accessibilityLabel, accessibilityState }: {
  children: ReactNode;
  onPress?(): void;
  marked?: boolean;
  level?: number;
  disabled?: boolean;
  icon?: IconName;
  /** The icon's colour, when it is not the words': Delete's red. */
  iconColour?: ColorValue;
  accessory?: ReactNode;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
}) {
  const colours = useDrawerColours();
  const line = (
    <>
      <View style={styles.rowLine}>
        {icon ? <View style={styles.rowIcon}><Icon name={icon} color={iconColour ?? INK.text} size={DRAWER.row.icon} /></View> : null}
        <View style={styles.rowWords}>{children}</View>
        {accessory ? <View style={styles.rowAccessory}>{accessory}</View> : null}
      </View>
      <DrawerSeparator />
    </>
  );
  const inset = { paddingLeft: DRAWER.row.textInset + level * DRAWER.row.indent };
  if (!onPress) {
    return (
      <View accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState}
        style={[styles.row, inset, marked && { backgroundColor: colours.mark }]}>
        {line}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, inset, marked && { backgroundColor: colours.mark }, pressed && styles.pressed]}
    >
      {line}
    </Pressable>
  );
}

/** At a row's right: the row opens a page. The settings pages' chevron, in the phone's tertiary grey. */
export function DrawerChevron() {
  return <View style={styles.chevron}><Icon name="next" color={INK.tertiary} size={22} strokeWidth={2} /></View>;
}

/** At a row's right: what the row is set to now, as the phone writes a row's value, in its secondary grey. */
export function DrawerRowValue({ children }: { children: ReactNode }) {
  return <Text style={styles.rowValue} numberOfLines={1}>{children}</Text>;
}

/**
 * What a short page of a drawer scrolls in: as tall as its rows, and no
 * taller than the drawer leaves it, so a page of seven fonts still reaches its
 * last at a Drawer Height of 40 %.
 */
export function DrawerScroll({ children }: { children: ReactNode }) {
  const bottom = useContext(DrawerBottom);
  return <ScrollView style={[styles.scroll, { marginBottom: -bottom }]} contentContainerStyle={{ paddingBottom: bottom }}>{children}</ScrollView>;
}

/**
 * A long list in a drawer: Contents' chapters, Download's. A `FlatList`, so
 * that only the rows in view are drawn, with what both lists need of it.
 *
 * **It opens at a row** (`openAt`, #88), whose height, like every row's, is
 * not known before it is laid out: titles wrap in full. So it opens in two
 * steps. First its rows start at that one, so it is laid out at the top with
 * nothing to estimate. Then the rows before it are put back in front, under
 * `maintainVisibleContentPosition`, which holds the row where it was while the
 * list grows above it; those rows are drawn as the owner scrolls up, at a
 * height estimated from the ones measured, and corrected the same way.
 * `initialScrollIndex` without `getItemLayout` was tried first: it scrolled to
 * the row against rows above it estimated at nothing, and a drag up later left
 * the list blank (notes, 2026-10-01 16:35).
 *
 * The phone undoes that hold while the drawer moves: with Shadow Slave's long
 * Chapter 139 among the rows measured, the row ended 14 to 27 pt too high
 * after a swipe up, or after opening. So until the owner touches the list, or
 * its rows change in number under it, the row is scrolled back to the top
 * whenever the list is laid out again.
 *
 * `renderItem` and `keyExtractor` are given each row's index in the whole of
 * `data`, so a row keeps its key when the rows above it arrive.
 *
 * **It ends the drawer** (`ends`) when nothing is under it: then it runs on to
 * the sheet's bottom edge, under the home indicator (`DrawerBottom`).
 */
export function DrawerList<T>({ data, openAt = null, ends = false, listRef, keyExtractor, renderItem, style, contentContainerStyle,
  onContentSizeChange, onLayout, onScrollBeginDrag, onTouchStart, ...list }:
  Omit<FlatListProps<T>, 'data' | 'keyExtractor' | 'renderItem'> & {
    data: readonly T[];
    /** The row to open at, as an index into `data`, or null for the top. Read once, when the list is mounted. */
    openAt?: number | null;
    ends?: boolean;
    listRef?(list: FlatList<T> | null): void;
    keyExtractor(item: T, index: number): string;
    renderItem(row: { item: T; index: number }): ReactElement | null;
  }) {
  const bottom = useContext(DrawerBottom);
  // The first row drawn: the one opened at, then, once that has been laid out at the top, the first.
  const [from, setFrom] = useState(() => openAt ?? 0);
  const shown = useMemo(() => (from > 0 ? data.slice(from) : data), [data, from]);
  const flat = useRef<FlatList<T> | null>(null);
  const holding = useRef(openAt !== null && openAt > 0);
  // How many rows there were when the rows above came back; another number means they are other rows.
  const rows = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => { if (rows.current !== null && rows.current !== data.length) holding.current = false; }, [data.length]);
  const anchor = () => {
    if (!holding.current || from > 0 || openAt === null) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    // A frame later, once the list has measured what changed.
    frame.current = requestAnimationFrame(() => flat.current?.scrollToIndex({ index: openAt, animated: false }));
  };
  return (
    <FlatList
      initialNumToRender={16}
      windowSize={7}
      // The row is drawn by the time it is asked for; a row that is not yet is left where it is.
      onScrollToIndexFailed={() => {}}
      {...list}
      ref={(next) => { flat.current = next; listRef?.(next); }}
      data={shown}
      style={[styles.list, style, ends && { marginBottom: -bottom }]}
      contentContainerStyle={[contentContainerStyle, ends && { paddingBottom: bottom }]}
      keyExtractor={(item, index) => keyExtractor(item, from + index)}
      renderItem={({ item, index }) => renderItem({ item, index: from + index })}
      maintainVisibleContentPosition={openAt !== null && openAt > 0 ? { minIndexForVisible: 0 } : undefined}
      onContentSizeChange={(width, height) => {
        onContentSizeChange?.(width, height);
        if (from > 0) { rows.current = data.length; setFrom(0); } else anchor();
      }}
      onLayout={(event) => { onLayout?.(event); anchor(); }}
      onScrollBeginDrag={(event) => { holding.current = false; onScrollBeginDrag?.(event); }}
      onTouchStart={(event) => { holding.current = false; onTouchStart?.(event); }}
    />
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

/** The words under a list: the phone's footer text, set in as far as the rows' words are. */
export function DrawerFooter({ children, attention }: { children: ReactNode; attention?: boolean }) {
  return <View style={styles.footer}><Footnote attention={attention}>{children}</Footnote></View>;
}

const styles = StyleSheet.create({
  // The sheet is presented from the window, not from here; the host only has to exist.
  host: { position: 'absolute', bottom: 0, right: 0, width: 1, height: 1 },
  body: { flex: 1 },
  header: {
    alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', gap: 12,
    marginBottom: DRAWER.header.gap, marginTop: DRAWER.header.top, minHeight: DRAWER.header.height,
    paddingHorizontal: DRAWER.button.side,
  },
  title: { ...TEXT.headline, color: INK.text },
  titleCentred: { bottom: 0, justifyContent: 'center', position: 'absolute', top: 0 },
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
  rowLine: { alignItems: 'center', flexDirection: 'row', gap: DRAWER.row.gap },
  rowIcon: { marginVertical: -DRAWER.row.padding },
  rowWords: { flex: 1 },
  // Over the row's padding, up to the row's edges, rather than growing it.
  rowAccessory: { alignItems: 'center', flexDirection: 'row', flexShrink: 1, gap: DRAWER.row.gap / 2, marginVertical: -DRAWER.row.padding },
  rowValue: { ...drawerRowText(false), color: INK.secondary, flexShrink: 1 },
  // The settings rows' chevron (`controls.tsx`): its ink ends at the words' right inset.
  chevron: { marginRight: -3 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  // As tall as its rows, and no taller than the drawer leaves it, so what is under a short list sits under its last row.
  list: { flexGrow: 0, flexShrink: 1 },
  capsule: { paddingHorizontal: 16, width: undefined },
  capsuleText: { ...TEXT.body, color: INK.reading },
  pressed: { opacity: 0.65 },
  rowText: { ...drawerRowText(false), color: INK.text },
  rowTextEmphasized: { ...drawerRowText(true), color: INK.text },
  separator: {
    bottom: 0, height: DRAWER.row.separator, left: DRAWER.row.inset,
    position: 'absolute', right: DRAWER.row.inset,
  },
  footer: { marginTop: DRAWER.footerGap, paddingLeft: DRAWER.row.textInset, paddingRight: DRAWER.row.inset },
});
