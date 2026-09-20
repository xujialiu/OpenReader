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

import { Children, useState, type ReactNode } from 'react';
import { Alert, DynamicColorIOS, Image, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { Icon, type IconName } from './icon';

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
 * which is what `shell.tsx` sets.
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
 * surface. The amber is lightened for dark, where the light one reads as brown.
 */
export const PALETTE = {
  light: {
    page: '#ffffff',
    panel: '#f4f4f6',
    line: '#dcdce2',
    text: '#16161a',
    reading: '#b26a00',
  },
  dark: {
    page: '#111114',
    panel: '#1c1c21',
    line: '#33333c',
    text: '#e6e6ea',
    reading: '#f0a828',
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

/** The app's colours, each one both of `PALETTE`'s. */
export const INK = {
  page: ink(PALETTE.light.page, PALETTE.dark.page),
  panel: ink(PALETTE.light.panel, PALETTE.dark.panel),
  line: ink(PALETTE.light.line, PALETTE.dark.line),
  text: ink(PALETTE.light.text, PALETTE.dark.text),
  quiet: ink('#5d5d68', '#9d9daa'),
  /** The reading colour, the same amber the highlighter paints with (`highlighter.ts`). */
  reading: ink(PALETTE.light.reading, PALETTE.dark.reading),
  /** Something the owner has to act on: a missing key, a server that did not answer. Not an alarm. */
  attention: ink('#8a2f18', '#f08c6e'),
};

export function Action({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionLabel, primary && styles.actionLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

/** A labelled line of text the owner types, with room underneath for the sentence that says what it is for. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  help,
  editable = true,
  secure,
  keyboard,
  lines,
  accessory,
}: {
  label: string;
  value: string;
  onChangeText(next: string): void;
  placeholder?: string;
  hint?: ReactNode;
  help?: string;
  editable?: boolean;
  secure?: boolean;
  keyboard?: 'url';
  accessory?: ReactNode;
  /**
   * More than one line, for a field whose content has line breaks in it — the
   * gateway headers are `Name: value` pairs and the owner may paste them one to
   * a line.
   *
   * It is not combined with `secure`, and cannot be: iOS ignores
   * `secureTextEntry` on a multiline input and React Native warns that the pair
   * is unsupported. The field that needs several lines is the one whose content
   * has to be readable to be checked at all, so nothing is lost here — see
   * `provider-screen.tsx`.
   */
  lines?: number;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {help ? <HeaderButton title="?" label={`${label} help`} onPress={() => Alert.alert(label, help)} /> : null}
      </View>
      <View style={accessory ? styles.inputWithAccessory : undefined}>
      <TextInput
        style={[styles.input, accessory ? styles.accessoryInput : null, lines ? { height: 22 * lines + 20, textAlignVertical: 'top' } : null]}
        accessibilityLabel={label}
        editable={editable}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={INK.quiet}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={secure}
        multiline={lines !== undefined}
        numberOfLines={lines}
        keyboardType={keyboard === 'url' ? 'url' : 'default'}
      />
      {accessory}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * A group of settings, drawn the way iOS draws one: a small grey header, an
 * inset card of rows separated by hairlines, and a sentence underneath.
 *
 * The **footer** is the part worth having. It is where the explanation of a
 * setting belongs, which is what stops each setting carrying its own paragraph
 * inside the row — and a screen of rows with paragraphs between them is what
 * General used to be one setting away from becoming.
 *
 * The separator is drawn by the rows rather than between them, and the last one
 * turns its own off (`groupRowLast`), because a card whose final row still has a
 * hairline reads as a list that was cut off.
 */
export function SettingsGroup({ title, footer, children }: {
  title: string; footer?: string; children: ReactNode;
}) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title.toUpperCase()}</Text>
      <View style={styles.groupCard}>
        {rows.map((row, at) => (
          <View key={at} style={[styles.groupRow, at === rows.length - 1 && styles.groupRowLast]}>{row}</View>
        ))}
      </View>
      {footer ? <Text style={styles.groupFooter}>{footer}</Text> : null}
    </View>
  );
}

/**
 * A row inside a `SettingsGroup` whose value is chosen from a short list: the
 * label, what it says now, and the two chevrons iOS puts on a row that opens a
 * menu rather than pushing a screen.
 */
export function ValueRow({ label, value, onPress }: { label: string; value: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${value}`}
      onPress={onPress} style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.settingValue}>
        <Text style={styles.settingDetail} numberOfLines={1}>{value}</Text>
        <Icon name="menu" color={INK.quiet} size={18} />
      </View>
    </Pressable>
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
 */
export function SwitchRow({ label, value, onChange, disabled }: {
  label: string; value: boolean; onChange(next: boolean): void; disabled?: boolean;
}) {
  return (
    <View style={styles.settingRow}>
      <Text style={[styles.settingLabel, disabled && styles.locked]}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

/** One of a few, with the one in force checked: what a `ValueRow` opens. */
export function ChoiceRow({ label, icon, chosen, onPress }: {
  label: string; icon?: IconName; chosen: boolean; onPress(): void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: chosen }} accessibilityLabel={label}
      onPress={onPress} style={({ pressed }) => [styles.choiceRow, pressed && styles.pressed]}>
      {icon ? <Icon name={icon} color={INK.text} size={22} /> : null}
      <Text style={[styles.settingLabel, { flex: 1 }]}>{label}</Text>
      {chosen ? <Icon name="check" color={INK.reading} size={20} /> : null}
    </Pressable>
  );
}

/** Something the owner should read: what is missing, or what a server said. Never an alert — the reading carries on around it. */
export function Note({ children, attention }: { children: ReactNode; attention?: boolean }) {
  return <Text style={[styles.note, attention && styles.noteAttention]}>{children}</Text>;
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

/** One Document in the Library: what it is called, and how far the reading got. */
export function DocumentRow({ title, progress, cover, onPress, onLongPress }: {
  title: string; progress: string; cover?: string | null; onPress(): void; onLongPress?(): void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} onLongPress={onLongPress}
      style={({ pressed }) => [styles.documentRow, pressed && styles.pressed]}>
      <View style={styles.cover} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {cover && failed !== cover ? <Image source={{ uri: cover }} style={styles.coverImage}
          resizeMode="contain" onError={() => setFailed(cover)} /> : <Icon name="book" color={INK.quiet} size={28} />}
      </View>
      <View style={styles.documentWords}>
        <Text style={styles.documentTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.rowProgress} numberOfLines={1}>{progress}</Text>
      </View>
    </Pressable>
  );
}

/**
 * A row that opens another screen: what is behind it, and one line saying what
 * is there.
 *
 * The same shape as a Document's row on purpose — Settings is now a list of the
 * same kind as the Library (ADR 0019), and two list idioms in one app would be
 * two things to learn. The chevron is a character in the system font and not an
 * icon, for the reason `HeaderButton` gives: there is no icon set in this
 * binary.
 */
export function SettingRow({ title, detail, onPress }: { title: string; detail: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowHead}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Icon name="next" color={INK.quiet} size={18} />
      </View>
      <Text style={styles.rowProgress}>{detail}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: INK.panel,
    borderColor: INK.line,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minWidth: 76,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actionLabel: { color: INK.text, fontSize: 15, fontWeight: '600' },
  actionLabelPrimary: { color: INK.page },
  actionPrimary: { backgroundColor: INK.text, borderColor: INK.text },
  disabled: { opacity: 0.4 },
  field: { gap: 6 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: INK.text, fontSize: 14, fontWeight: '600' },
  hint: { color: INK.quiet, fontSize: 12, lineHeight: 17 },
  inputWithAccessory: { flexDirection: 'row', alignItems: 'center', borderColor: INK.line,
    borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  accessoryInput: { flex: 1, minWidth: 0, borderWidth: 0 },
  input: {
    backgroundColor: INK.page,
    borderColor: INK.line,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: INK.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  note: { color: INK.quiet, fontSize: 13, lineHeight: 19 },
  noteAttention: { color: INK.attention },
  pressed: { opacity: 0.65 },
  headerTap: { alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
  documentRow: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 22, paddingVertical: 14 },
  cover: { width: 56, height: 80, borderRadius: 5, backgroundColor: INK.panel, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverImage: { width: '100%', height: '100%' },
  documentWords: { flex: 1, gap: 7 },
  documentTitle: { color: INK.text, fontSize: 17, fontWeight: '500', lineHeight: 23 },
  headerButton: { color: INK.text, fontSize: 16, fontWeight: '600' },
  row: {
    borderBottomColor: INK.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowProgress: { color: INK.quiet, fontSize: 13, lineHeight: 18 },
  rowTitle: { color: INK.text, fontSize: 16, fontWeight: '600' },
  rowHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  chevron: { color: INK.quiet, fontSize: 20, lineHeight: 22 },
  group: { gap: 7 },
  groupTitle: { color: INK.quiet, fontSize: 13, fontWeight: '600', letterSpacing: 0.6, paddingHorizontal: 16 },
  groupCard: { backgroundColor: INK.panel, borderRadius: 10, overflow: 'hidden' },
  groupRow: { borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth, marginLeft: 16 },
  groupRowLast: { borderBottomWidth: 0 },
  groupFooter: { color: INK.quiet, fontSize: 13, lineHeight: 18, paddingHorizontal: 16 },
  // One type scale with Settings: a row's label is 16 and what it says is 16 in
  // the quiet ink, never larger than the label naming it.
  settingRow: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', minHeight: 48, paddingRight: 16, paddingVertical: 10 },
  settingLabel: { color: INK.text, fontSize: 16, flexShrink: 1 },
  settingDetail: { color: INK.quiet, fontSize: 16, flexShrink: 1 },
  settingValue: { alignItems: 'center', flexDirection: 'row', gap: 6, flexShrink: 1 },
  choiceRow: { alignItems: 'center', flexDirection: 'row', gap: 14, minHeight: 52, paddingHorizontal: 20 },
  locked: { opacity: 0.5 },
});
