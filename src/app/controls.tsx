/**
 * The handful of controls the four screens are built from.
 *
 * Here so that the Library, the reader and the settings look like one app
 * without repeating a `StyleSheet` in each, and so that there is one place to
 * see what the app is capable of showing. That is worth more than it sounds:
 * **no control in this file can open a URL**, and with every control in one file
 * that is checkable by eye. ADR 0017 forbids a tappable route to any Provider's
 * signup, pricing or key console; a file of controls that cannot open a URL is
 * how that decision survives someone later "improving onboarding".
 *
 * The property used to be stated as "nothing in `src/app/` imports `Linking`",
 * and it stopped being true when ADR 0019 let another app hand this one a
 * Document: `opened-document.ts` reads the URL the app was **opened with**.
 * Nothing opens one. `test/app/no-outgoing-links.test.ts` is where that is now
 * checked, because it is no longer something an eye can check.
 */

import { Host, Menu, RNHostView, Toggle, type ToggleProps } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, accessibilityElement, accessibilityLabel, menuOrder } from '@expo/ui/swift-ui/modifiers';
import { Children, createContext, isValidElement, useContext, useMemo, useState, type ReactNode } from 'react';
import { DynamicColorIOS, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { type ReadingAccent } from './accent';
import { Icon, type IconName } from './icon';
import { NameText } from './name-text';
import { TEXT, TEXT_EMPHASIZED } from './text-styles';

/**
 * One colour that is two, resolved by iOS rather than by React (ADR 0022).
 *
 * This is what lets the **theme** reach every screen without a line changing in
 * any of them. `DynamicColorIOS` hands back a `UIColor` with both values in it,
 * and UIKit picks one per view from that view's own trait collection — so the
 * `StyleSheet.create` calls below stay where they are, at module scope, and still
 * answer differently in the two themes. The alternative was a palette in a
 * context and every `StyleSheet.create` in `src/app/` moved inside its component,
 * which is nine files rewritten to change a colour.
 *
 * It also means a theme change repaints with no React render at all: iOS
 * re-resolves the colours when the window's `overrideUserInterfaceStyle` changes,
 * which is what `shell.tsx` sets. **Not for a border**, which React Native
 * resolves against the phone rather than the view (#29): borders take `BORDER`.
 *
 * **It throws off iOS**, in the house style and for the same reason as
 * `src/now-playing/`: `DynamicColorIOS` has no Android counterpart, and the
 * alternative — quietly handing back the light value — is a theme setting that
 * appears in General, is tapped, and does nothing.
 */
/**
 * The two columns, as plain strings.
 *
 * Exported because two readers need the values themselves rather than a dynamic
 * colour: the navigation library types its header colours as `string` and will
 * not take a `UIColor`, and the status bar is told which of the two it is over.
 * One table, so the header and the screen under it cannot end up different
 * greys.
 *
 * The dark column is not the light one inverted. The page is near-black rather
 * than black and the text is not pure white, because an unrelieved #000/#fff pair
 * is what makes a long reading tiring — `#111114` and `#e6e6ea` are the same pair
 * `themeCss` paints the document with, so the page and the app around it are one
 * surface. The accent is not here: it follows the owner's Highlight Colours
 * (`useAccent()`, #118), and is held to 4.5:1 on `page` and `panel`, whose
 * values `accent.ts` repeats (`ACCENT_SURFACES`, checked by its test).
 */
export const PALETTE = {
  light: {
    page: '#ffffff',
    panel: '#f4f4f6',
    line: '#dcdce2',
    text: '#16161a',
  },
  dark: {
    page: '#111114',
    panel: '#1c1c21',
    line: '#33333c',
    text: '#e6e6ea',
  },
} as const;

function ink(light: string, dark: string): ColorValue {
  if (Platform.OS !== 'ios') {
    throw new Error(
      `OpenReader's theme has no implementation on ${Platform.OS}. The app's own colours are iOS dynamic colours ` +
        '(ADR 0022), which is what lets one stylesheet serve light and dark without every screen being rewritten. ' +
        'Android needs its own answer — a palette in a context, or the platform\u2019s own attributes — and it is not ' +
        'written. It is not stubbed to the light value on purpose: that would be a setting the owner can choose and ' +
        'that does nothing.',
    );
  }
  return DynamicColorIOS({ light, dark });
}

/**
 * The settings pages' two surfaces, the page and the cards on it, as plain
 * strings for the navigation header that sits over the page (`shell.tsx`).
 *
 * No new colours: the two columns of `PALETTE` swap places in the light theme.
 * The phone lays its own Settings out as white cards on a light grey page, the
 * card above its page in both themes, and General used to have it the other
 * way round in the light theme only — a faint grey card sunk into a white page
 * (#48, design 0041). In the dark the cards were already the lighter of the two,
 * and the page stays the near-black the document is read on (ADR 0022).
 */
export const SETTINGS_SURFACE = {
  light: { page: PALETTE.light.panel, card: PALETTE.light.page },
  dark: { page: PALETTE.dark.page, card: PALETTE.dark.panel },
} as const;

/** The quiet grey, in both themes; a table of its own because a border takes it too (`BORDER`). */
const QUIET = { light: '#5d5d68', dark: '#9d9daa' } as const;

/**
 * The colours a border is drawn in, as plain strings for each theme (#29, ADR 0046).
 *
 * **A border never takes an `INK` colour.** React Native's view resolves a
 * dynamic colour against the view's own traits for its background and not for
 * its border: the border answers for whatever the process's traits are when it
 * is repainted, and those follow the phone rather than the theme the owner
 * chose. So a drawer's edge laid out again on a light phone came out in the
 * light theme's grey on a dark drawer, and the same drawer could come out
 * either way. `test/app/border-colours.test.ts` holds every `border*Color` in
 * `src/app/` to this table, read through `useBorders()`.
 */
export const BORDER = {
  light: { line: PALETTE.light.line, text: PALETTE.light.text, quiet: QUIET.light },
  dark: { line: PALETTE.dark.line, text: PALETTE.dark.text, quiet: QUIET.dark },
} as const;

/** The theme on screen, resolved once by the shell (`resolveTheme`, ADR 0022) and read by `useBorders()`. */
export const SchemeContext = createContext<keyof typeof PALETTE | null>(null);

/**
 * `BORDER` for the theme on screen.
 *
 * A theme change re-renders what reads it, which is the price of a plain
 * string: the rest of `INK` repaints with no render at all. Throws outside the
 * shell rather than guessing a theme, because a guess is exactly the wrong line
 * this exists to stop.
 */
export function useBorders(): (typeof BORDER)[keyof typeof BORDER] {
  const scheme = useContext(SchemeContext);
  if (!scheme) throw new Error('useBorders() was called outside the shell, which is what says whether the theme on screen is light or dark.');
  return BORDER[scheme];
}

/** The reading accent for the theme on screen, worked out once by the shell from the owner's Highlight Colours, and read by `useAccent()`. */
export const AccentContext = createContext<ReadingAccent | null>(null);

/**
 * The reading accent (`accent.ts`, #118): the word's Highlight Colour, its hue
 * kept and darkened or lightened just enough to read at 4.5:1 on the surface
 * under it, for a check, the current row, a link, the download ring and a
 * drawer's action; and the wash under the player's A.
 *
 * Plain strings for the theme on screen, as `useBorders()` gives them, and not
 * an `INK` colour: an `INK` colour is made once, when this file loads, and the
 * accent changes whenever the owner changes the word's colour. They serve a
 * border as well as text (ADR 0046). Throws outside the shell, as
 * `useBorders()` does.
 */
export function useAccent(): ReadingAccent {
  const accent = useContext(AccentContext);
  if (!accent) throw new Error('useAccent() was called outside the shell, which is what knows the Highlight Colours and the theme on screen.');
  return accent;
}

/** The app's colours, each one both of `PALETTE`'s. */
export const INK = {
  page: ink(PALETTE.light.page, PALETTE.dark.page),
  panel: ink(PALETTE.light.panel, PALETTE.dark.panel),
  line: ink(PALETTE.light.line, PALETTE.dark.line),
  text: ink(PALETTE.light.text, PALETTE.dark.text),
  quiet: ink(QUIET.light, QUIET.dark),
  /** Something the owner has to act on: a missing key, a server that did not answer. Not an alarm. */
  attention: ink('#8a2f18', '#f08c6e'),
  /** A settings page, behind its cards (`SETTINGS_SURFACE`). */
  settingsPage: ink(SETTINGS_SURFACE.light.page, SETTINGS_SURFACE.dark.page),
  /** A settings card, above its page (`SETTINGS_SURFACE`). */
  card: ink(SETTINGS_SURFACE.light.card, SETTINGS_SURFACE.dark.card),
  /**
   * The phone's own greys for the text of a settings page (design 0042): a
   * row's value, a group's header and footer, and the second line of a row.
   * Translucent, as the phone's are, so one colour reads right on the card and
   * on the page: measured on iOS 27.0 as #8a8a8e on a white card and #85858b on
   * the grey page, #98989f and #8d8d93 in the dark (notes, 2026-09-23).
   */
  secondary: ink('rgba(60,60,67,0.6)', 'rgba(235,235,245,0.6)'),
  /** Fainter still: a row's chevron and an empty field's placeholder (measured #c5c5c7 and #5a5a5e on a card). */
  tertiary: ink('rgba(60,60,67,0.3)', 'rgba(235,235,245,0.3)'),
  /** The line between a card's rows, as the phone draws it: 1 point, measured #e8e8e8 and #38383b. */
  separator: ink('#e8e8e8', '#38383b'),
};

/**
 * The measurements the settings pages are drawn to (#48).
 *
 * The phone's own, not the app's: taken from the phone's Settings on an iPhone
 * 17 simulator running iOS 27.0 (`test/manual-test/settings/native-reference.sh`, notes
 * 2026-09-23), and checked against the phone rather than against each other
 * (design 0042). When the phone's look changes, measure again and change them
 * here.
 */
const SETTINGS = {
  /** From the screen's edge to a card's. */
  margin: 20,
  /** A row's height, with one line of 17-point text. */
  rowHeight: 53,
  /** From a card's edge to its rows' text, at both ends, and so where each separator starts and stops. */
  inset: 16,
  /** A card's corners, drawn as the phone's continuous curve rather than a circle's arc. */
  cardRadius: 26,
  /** Between one group and the next. The phone's varies from 30 to 40 with what is on either side; this is one number between. */
  groupGap: 32,
} as const;

/**
 * A settings page: the grey page every settings screen scrolls on (#48).
 *
 * One component rather than five `ScrollView`s with the same props, for the
 * reason the rows below exist: five copies of a page's padding is how five
 * pages end up a few points apart.
 *
 * `automaticallyAdjustKeyboardInsets`, because the fields are rows of cards now,
 * and the lowest of them (Fish Audio's own voices) sits where the keyboard rises.
 */
export function SettingsPage({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.settingsPage} contentContainerStyle={styles.settingsBody}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
      {children}
    </ScrollView>
  );
}

/** The width of the widest field name in one card, and how a field reports its own (`SettingsGroup`). */
const LabelColumn = createContext<{ width: number; measure(width: number): void } | null>(null);

/**
 * A group of settings, drawn the way iOS draws one: a small grey header, a card
 * of rows separated by hairlines, and a sentence underneath (design 0041).
 *
 * The **footer** is where anything said about the card goes: an explanation, a
 * result, a refusal. It takes a node as well as a string because a result is a
 * `Footnote` that may be in the attention colour, and General's refusal carries
 * its way out beside it. The title is optional because a card whose page already
 * names it (a provider's switch, the front page of Settings) has nothing to add.
 * It is set as written, not in capitals: the phone's own headers stopped being
 * small capitals, and are now its 17-point semibold in the secondary grey.
 *
 * The separators are laid **over** the rows, inset to where their text starts,
 * rather than drawn as the border of a row pulled in from the card's edge. So a
 * row is as wide as its card, pads itself, and highlights edge to edge when it
 * is pressed, as the phone's own rows do. The last row has none, because a card
 * whose final row still has a hairline reads as a list that was cut off.
 *
 * Every `FieldRow` in the card starts its value where the widest field name
 * ends (`LabelColumn`), as on the phone's own account pages. The column is
 * measured rather than fixed because the app's text follows the phone's text
 * size, and a width that fits at the default clips at a larger one. It only
 * grows: a field a switch reveals can widen the column, and one that goes away
 * does not make the others jump.
 */
export function SettingsGroup({ title, footer, children }: {
  title?: string; footer?: ReactNode; children: ReactNode;
}) {
  const rows = Children.toArray(children).filter(Boolean);
  const [labelWidth, setLabelWidth] = useState(0);
  const column = useMemo(() => ({
    width: labelWidth,
    measure: (width: number) => setLabelWidth((widest) => Math.max(widest, Math.ceil(width))),
  }), [labelWidth]);
  return (
    <View>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <LabelColumn.Provider value={column}>
        <View style={styles.groupCard}>
          {rows.map((row, at) => (
            <View key={isValidElement(row) && row.key !== null ? row.key : at}>
              {row}
              {at < rows.length - 1 ? <View style={styles.separator} /> : null}
            </View>
          ))}
        </View>
      </LabelColumn.Provider>
      {footer ? <View style={styles.groupFooter}>{typeof footer === 'string' ? <Footnote>{footer}</Footnote> : footer}</View> : null}
    </View>
  );
}

/**
 * A row inside a `SettingsGroup` whose value is chosen from a short list: the
 * label, what it says now, and the two chevrons iOS puts on a row that opens a
 * menu — which is what it opens (`ChoiceMenu`, #33).
 */
export function ValueRow<T extends string | number>({ label, choices, chosen, onChoose }: {
  label: string; choices: readonly Choice<T>[]; chosen: T; onChoose(next: T): void;
}) {
  return (
    <ChoiceMenu label={label} choices={choices} chosen={chosen} onChoose={onChoose} height={SETTINGS.rowHeight}>
      <View style={styles.settingRow}>
        <Text style={styles.settingLabel}>{label}</Text>
        <View style={styles.settingValue}>
          <Text style={styles.settingDetail} numberOfLines={1}>{choices.find((choice) => choice.value === chosen)?.label}</Text>
          <Icon name="menu" color={INK.secondary} size={18} />
        </View>
      </View>
    </ChoiceMenu>
  );
}

/**
 * A row inside a `SettingsGroup` that is on or off.
 *
 * Lifted out of `provider-screen.tsx`, which had exactly this and called it
 * `Source`. Two copies of a switch row is how the two end up different heights
 * in two places a tap apart, and `disabled` is here for the same reason it was
 * there: a setting that guards something is frozen while it is on, and the way
 * to edit it is to turn it off.
 *
 * `note` is the line under the label that says what is happening now (design
 * 0041): `Turn off to edit.` while a setting that freezes its fields is on, and
 * `Testing…` or `Checking the folder…` while turning one on is being checked. It
 * sits in the switch's own row because decision 0026 found that, set apart from
 * its switch, it read as an instruction for the field beside it.
 *
 * `accessibilityLabel` is the switch's, for a switch whose visible label is not
 * enough on its own: a provider's always reads `Enabled`, and is announced as
 * `Enable Fish Audio`.
 */
export function SwitchRow({ label, value, onChange, disabled, note, accessibilityLabel }: {
  label: string; value: boolean; onChange(next: boolean): void; disabled?: boolean; note?: string; accessibilityLabel?: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.switchWords}>
        <Text style={[styles.settingLabel, disabled && styles.locked]}>{label}</Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
      <Switch accessibilityLabel={accessibilityLabel ?? label} value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

/**
 * A row that opens another screen: its name, what is true there now, and the
 * chevron (design 0041).
 *
 * `value` is a fact, in the quiet ink where the phone puts a row's current value
 * (`2 enabled`, `On`), and is left out rather than filled with a description of
 * what is behind the row. `checked` is the Providers list's mark for an enabled
 * Provider (design 0026), in the reading accent where the phone would use its
 * own blue (design 0042, `useAccent()`).
 *
 * The same row as every other settings row on purpose. The Providers list and
 * the front page of Settings used to be two different full-width rows a tap
 * apart, which is the first thing #48 found.
 */
export function NavigationRow({ label, value, checked, onPress, accessibilityLabel }: {
  label: string; value?: string; checked?: boolean; onPress(): void; accessibilityLabel?: string;
}) {
  const accent = useAccent();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={({ pressed }) => [styles.settingRow, pressed && styles.rowPressed]}>
      <Text style={styles.settingLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.settingValue}>
        {value ? <Text style={styles.settingDetail} numberOfLines={1}>{value}</Text> : null}
        {checked ? <Icon name="check" color={accent.reading} size={20} strokeWidth={2.2} /> : null}
        <View style={styles.chevron}><Icon name="next" color={INK.tertiary} size={22} strokeWidth={2} /></View>
      </View>
    </Pressable>
  );
}

/**
 * A field as a row of its card: its name on the left and what was typed to the
 * right, as on the phone's own page for adding a mail account (design 0041).
 *
 * No box: the card is the box. A boxed field inside a card was the box inside a
 * box that made Sync the page the owner singled out (#48). The input is as tall
 * as the row, so a tap anywhere to the right of the name lands in it.
 *
 * `accessory` sits at the row's end (the API key's eye) and takes over most of
 * the row's right padding, because a 44-point target carries its own.
 *
 * A field that cannot be edited is drawn at half strength, as a frozen switch's
 * label is; the line under the switch that froze it says why (`SwitchRow`).
 *
 * While it is being edited it has the phone's own clear button, as the phone's
 * text fields do. A long address is otherwise emptied one backspace at a time
 * from wherever the caret landed, which only removes what is before it.
 */
export function FieldRow({ label, value, onChangeText, placeholder, editable = true, secure, keyboard, accessory }: {
  label: string;
  value: string;
  onChangeText(next: string): void;
  placeholder?: string;
  editable?: boolean;
  secure?: boolean;
  keyboard?: 'url';
  accessory?: ReactNode;
}) {
  const column = useContext(LabelColumn);
  return (
    <View style={[styles.fieldRow, accessory ? styles.fieldRowWithAccessory : null]}>
      <Text style={[styles.settingLabel, styles.fieldLabel, column ? { minWidth: column.width } : null]} numberOfLines={1}
        onLayout={column ? (event) => column.measure(event.nativeEvent.layout.width) : undefined}>
        {label}
      </Text>
      <TextInput
        style={[styles.fieldInput, !editable && styles.locked]}
        accessibilityLabel={label}
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={INK.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={secure}
        keyboardType={keyboard === 'url' ? 'url' : 'default'}
        clearButtonMode="while-editing"
      />
      {accessory}
    </View>
  );
}

/**
 * A field with no name of its own, the whole width of its card: a list that the
 * switch above it reveals, which already says what the list is for (the bracket
 * pairs, and Fish Audio's own voices; design 0041). What goes in it is said by
 * its placeholder, which shows exactly while the field is empty and a format is
 * worth knowing.
 */
export function TextRow({ label, value, onChangeText, placeholder, editable = true }: {
  label: string; value: string; onChangeText(next: string): void; placeholder?: string; editable?: boolean;
}) {
  return (
    <TextInput
      style={[styles.textRow, !editable && styles.locked]}
      accessibilityLabel={label}
      editable={editable}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={INK.tertiary}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      clearButtonMode="while-editing"
    />
  );
}

/**
 * An action as a row of its card (`Test connection`), in the reading accent
 * where the phone would use its own blue (design 0042, `useAccent()`).
 *
 * While it cannot be pressed it keeps its words and dims. What is happening is
 * said once, under the switch (`SwitchRow`'s `note`), and not again here.
 */
export function ActionRow({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) {
  const accent = useAccent();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.settingRow, pressed && styles.rowPressed]}>
      <Text style={[styles.actionLabel, { color: accent.reading }, disabled && styles.locked]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Text that is the card's content rather than a row of it: a licence (#111).
 * Set as the phone's own legal pages set theirs, small and in the text colour,
 * with a row's inset on every side, and selectable, so a notice can be copied.
 */
export function ProseRow({ children }: { children: string }) {
  return <Text selectable style={styles.prose}>{children}</Text>;
}

/**
 * A line under a settings card: an explanation, a result, a refusal, the
 * version. The phone's footer text, 13 on 16 in its secondary grey, or the
 * attention colour for something the owner has to act on.
 */
export function Footnote({ children, attention, accessibilityLabel }: {
  children: ReactNode; attention?: boolean; accessibilityLabel?: string;
}) {
  return <Text style={[styles.footnote, attention && styles.noteAttention]} accessibilityLabel={accessibilityLabel}>{children}</Text>;
}

/**
 * One entry of a `ChoiceMenu`: what it sets, what it is called, and the system
 * symbol drawn beside it. The symbol is left out where none would mean the
 * choice: a pause of `300 ms` is its number, and a picture beside it would be a
 * caption on a word that already says it.
 */
export interface Choice<T extends string | number> {
  value: T;
  label: string;
  icon?: NonNullable<ToggleProps['systemImage']>;
}

/**
 * A short list of choices, opened by a tap on the row it wraps as the system's
 * own menu, with the one in force checked (ADR 0035).
 *
 * `children` is the row as it is drawn, and it is only drawn: the menu owns the
 * tap, so nothing inside it may be a `Pressable`. `height` is the row's, because
 * the menu is laid out by SwiftUI and takes the size it is given rather than
 * one worked out from what is inside it.
 *
 * `menuOrder('fixed')`: a menu opened near the bottom of the screen opens
 * upward, and SwiftUI then lists its items in reverse unless told not to.
 *
 * One accessibility element, `Theme, Match Device`, and a button: the drawn
 * row's words would otherwise be read on their own, and the element that
 * replaces them starts with no traits at all — measured, XCTest saw it as an
 * `Other` until `isButton` was added back.
 */
export function ChoiceMenu<T extends string | number>({ label, choices, chosen, onChoose, height, children }: {
  label: string; choices: readonly Choice<T>[]; chosen: T; onChoose(next: T): void; height: number; children: ReactNode;
}) {
  const current = choices.find((choice) => choice.value === chosen)?.label ?? '';
  return (
    <Host style={{ height, alignSelf: 'stretch' }}>
      <Menu
        label={<RNHostView><View style={styles.menuRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</View></RNHostView>}
        modifiers={[menuOrder('fixed'), accessibilityElement('ignore'), accessibilityLabel(`${label}, ${current}`), accessibilityAddTraits(['isButton'])]}
      >
        {choices.map((choice) => (
          <Toggle key={choice.value} label={choice.label} systemImage={choice.icon} isOn={choice.value === chosen}
            onIsOnChange={() => onChoose(choice.value)} />
        ))}
      </Menu>
    </Host>
  );
}

/** Something the owner should read: what is missing, or what a server said. Never an alert — the reading carries on around it. */
export function Note({ children, attention, accessibilityLabel }: {
  children: ReactNode; attention?: boolean; accessibilityLabel?: string;
}) {
  return <Text style={[styles.note, attention && styles.noteAttention]} accessibilityLabel={accessibilityLabel}>{children}</Text>;
}

/** A labelled 44-point target, drawn as an icon or a short typographic mark. */
export function HeaderButton({ label, icon, title, onPress, disabled }: {
  label: string; icon?: IconName; title?: string; onPress(): void; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.headerTap, pressed && styles.pressed, disabled && styles.disabled]}>
      {icon ? <Icon name={icon} color={INK.text} /> : <Text style={styles.headerButton}>{title ?? label}</Text>}
    </Pressable>
  );
}

/**
 * One Document in the Library: what it is called, how far the reading got, and
 * its `…` for the actions drawer.
 *
 * The `…` is drawn over the row's right end, and the words end where its touch
 * area begins (#87), so neither a two-line name nor the progress line runs under
 * it. The row owns the button for that reason: it is the one place that knows
 * both the button's width and the words beside it. The button is the row's
 * sibling rather than its child, so VoiceOver finds `Actions for <name>` as a
 * button of its own instead of folding it into the row.
 *
 * The name is left-aligned, not justified: iOS fills a justified line by
 * spacing out its letters as well as its words, and a line of a name in this
 * column is only three or four words (notes, 2026-09-30 09:56).
 *
 * A name longer than two lines is cut after a whole word (`NameText`, design
 * 0060). The row's label is set rather than read off its words, so VoiceOver
 * says the whole name, and says it once.
 */
export function DocumentRow({ title, progress, cover, onPress, onLongPress, onActions }: {
  title: string; progress: string; cover?: string | null; onPress(): void; onLongPress?(): void; onActions(): void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${progress}`} onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [styles.documentRow, pressed && styles.pressed]}>
      <View style={styles.cover} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {cover && failed !== cover ? <Image source={{ uri: cover }} style={styles.coverImage}
          resizeMode="contain" onError={() => setFailed(cover)} /> : <Icon name="book" color={INK.quiet} size={28} />}
      </View>
      <View style={styles.documentWords}>
        <NameText name={title} lines={2} style={styles.documentTitle} />
        <Text style={styles.rowProgress} numberOfLines={1}>{progress}</Text>
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${title}`} onPress={onActions} style={styles.documentActions}>
      <Icon name="more" color={INK.quiet} size={DOCUMENT_ACTIONS.icon} />
    </Pressable>
  </View>;
}

/**
 * The row's `…`: its distance from the row's right edge, the padding either side
 * of its icon, and the icon. Its touch area ends 54 from the row's right edge,
 * against the row's own 22 of padding.
 */
const DOCUMENT_ACTIONS = { right: 12, padding: 10, icon: 22 };
const DOCUMENT_ROW_PADDING = 22;

const styles = StyleSheet.create({
  disabled: { opacity: 0.4 },
  note: { ...TEXT.footnote, color: INK.quiet },
  noteAttention: { color: INK.attention },
  pressed: { opacity: 0.65 },
  headerTap: { alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
  documentRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: DOCUMENT_ROW_PADDING, paddingVertical: 14 },
  documentActions: { position: 'absolute', right: DOCUMENT_ACTIONS.right, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: DOCUMENT_ACTIONS.padding },
  cover: { width: 56, height: 80, borderRadius: 5, backgroundColor: INK.panel, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  documentWords: { flex: 1, gap: 7, marginRight: DOCUMENT_ACTIONS.right + 2 * DOCUMENT_ACTIONS.padding + DOCUMENT_ACTIONS.icon - DOCUMENT_ROW_PADDING },
  // A size under Headline, which the drawer's title and the bar's keep: the
  // owner found the names large in a list of them (#99).
  documentTitle: { ...TEXT_EMPHASIZED.callout, color: INK.text },
  headerButton: { ...TEXT.body, color: INK.text },
  rowProgress: { ...TEXT.footnote, color: INK.quiet },
  settingsPage: { backgroundColor: INK.settingsPage, flex: 1 },
  settingsBody: { gap: SETTINGS.groupGap, paddingBottom: 64, paddingHorizontal: SETTINGS.margin, paddingTop: 16 },
  groupTitle: { ...TEXT.headline, color: INK.secondary, marginBottom: 6, paddingHorizontal: SETTINGS.inset },
  groupCard: { backgroundColor: INK.card, borderCurve: 'continuous', borderRadius: SETTINGS.cardRadius, overflow: 'hidden' },
  separator: { backgroundColor: INK.separator, bottom: 0, height: 1, left: SETTINGS.inset, position: 'absolute', right: SETTINGS.inset },
  groupFooter: { gap: 6, marginTop: 8, paddingHorizontal: SETTINGS.inset },
  footnote: { ...TEXT.footnote, color: INK.secondary },
  // One type scale with the phone's Settings: a row's label and what it says
  // are both 17, the value in the secondary grey.
  settingRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: SETTINGS.rowHeight, paddingHorizontal: SETTINGS.inset, paddingVertical: 10 },
  rowPressed: { backgroundColor: INK.line },
  settingLabel: { ...TEXT.body, color: INK.text, flexShrink: 1 },
  settingDetail: { ...TEXT.body, color: INK.secondary, flexShrink: 1 },
  settingValue: { alignItems: 'center', flexDirection: 'row', gap: 4, flexShrink: 1 },
  // The glyph's own box leaves room on its right; pulled in so the chevron's
  // stroke ends where the phone's does, about 21 points from the card's edge.
  chevron: { marginRight: -3 },
  switchWords: { flexShrink: 1, gap: 2 },
  rowNote: { ...TEXT.subhead, color: INK.secondary },
  fieldRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: SETTINGS.rowHeight, paddingHorizontal: SETTINGS.inset },
  fieldRowWithAccessory: { paddingRight: 4 },
  fieldLabel: { flexShrink: 0 },
  // As tall as the row, so the whole of the row right of the name is the input.
  fieldInput: { ...TEXT.body, alignSelf: 'stretch', color: INK.text, flex: 1, minWidth: 0, paddingVertical: 12 },
  textRow: { ...TEXT.body, color: INK.text, minHeight: SETTINGS.rowHeight, paddingHorizontal: SETTINGS.inset, paddingVertical: 12 },
  actionLabel: { ...TEXT.body },
  prose: { ...TEXT.footnote, color: INK.text, paddingHorizontal: SETTINGS.inset, paddingVertical: 12 },
  menuRow: { flex: 1 },
  locked: { opacity: 0.5 },
});
