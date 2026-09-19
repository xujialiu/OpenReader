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

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export const INK = {
  page: '#ffffff',
  panel: '#f4f4f6',
  line: '#dcdce2',
  text: '#16161a',
  quiet: '#5d5d68',
  /** The reading colour, the same amber the highlighter paints with (`highlighter.ts`). */
  reading: '#b26a00',
  /** Something the owner has to act on: a missing key, a server that did not answer. Not an alarm. */
  attention: '#8a2f18',
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
  secure,
  keyboard,
}: {
  label: string;
  value: string;
  onChangeText(next: string): void;
  placeholder?: string;
  hint?: ReactNode;
  secure?: boolean;
  keyboard?: 'url';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={INK.quiet}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        secureTextEntry={secure}
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

/**
 * A word in a navigation bar.
 *
 * Text and not an icon, because there is no icon set in this binary and adding
 * one to say "add" and "settings" would be a font shipped for two glyphs. The
 * native header draws everything around it; this is only the label and the tap.
 */
export function HeaderButton({ label, onPress, disabled }: { label: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={({ pressed }) => [pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.headerButton}>{label}</Text>
    </Pressable>
  );
}

/** One Document in the Library: what it is called, and how far the reading got. */
export function DocumentRow({ title, progress, onPress }: { title: string; progress: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Text style={styles.rowTitle} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.rowProgress} numberOfLines={2}>
        {progress}
      </Text>
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
});
