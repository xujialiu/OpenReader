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

import { useState, type ReactNode } from 'react';
import { Alert, DynamicColorIOS, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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

/** One choice out of a few, all of them visible. A picker would hide the list, and every list here is short and worth reading. */
export function Choice<T extends string | number>({
  options,
  value,
  onChange,
  labelOf,
}: {
  options: readonly T[];
  value: T;
  onChange(option: T): void;
  labelOf?(option: T): string;
}) {
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const chosen = option === value;
        return (
          <Pressable
            key={String(option)}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen }}
            onPress={() => onChange(option)}
            style={({ pressed }) => [styles.chip, chosen && styles.chipChosen, pressed && styles.pressed]}
          >
            <Text style={[styles.chipLabel, chosen && styles.chipLabelChosen]}>
              {labelOf ? labelOf(option) : String(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
      <TextInput
        style={[styles.input, lines ? { height: 22 * lines + 20, textAlignVertical: 'top' } : null]}
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
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
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
export function DocumentRow({ title, progress, cover, onPress }: {
  title: string; progress: string; cover?: string | null; onPress(): void;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
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
  chip: {
    backgroundColor: INK.panel,
    borderColor: INK.line,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipChosen: { backgroundColor: INK.text, borderColor: INK.text },
  chipLabel: { color: INK.text, fontSize: 14 },
  chipLabelChosen: { color: INK.page, fontWeight: '600' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disabled: { opacity: 0.4 },
  field: { gap: 6 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: INK.text, fontSize: 14, fontWeight: '600' },
  hint: { color: INK.quiet, fontSize: 12, lineHeight: 17 },
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
  section: { gap: 12 },
  sectionTitle: { color: INK.text, fontSize: 17, fontWeight: '700' },
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
});
