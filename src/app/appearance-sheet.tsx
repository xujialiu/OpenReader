import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { READING_FONTS, stepFontSize, stepMargins, TEXT_ALIGNMENTS, type Appearance, type TextAlignment } from '../renderer/highlighter';
import { ChoiceMenu, INK, useBorders, type Choice } from './controls';
import { Icon } from './icon';
import { Sheet } from './sheet';
import { TEXT } from './text-styles';

/** What "follow the document" is called where the owner reads it: the book's own, not "the document font". */
export const ORIGINAL_FONT = 'Original Book Font';

/**
 * The Alignment menu, in `TEXT_ALIGNMENTS`' order: each word, and the system's
 * picture of it, which shows the one thing the word does not — a ragged right
 * edge against a flush one.
 */
const ALIGNMENT_CHOICES: readonly Choice<TextAlignment>[] = TEXT_ALIGNMENTS.map((value) => ({
  value,
  ...({ left: { label: 'Left', icon: 'text.alignleft' }, justify: { label: 'Justify', icon: 'text.justify' } } as const)[value],
}));

/** The row's height, which the menu is laid out at (`ChoiceMenu`). */
const ROW_HEIGHT = 56;

/**
 * A row that steps a number along a ladder: its name, then minus, the number
 * and plus. The number is the one thing about it the page behind cannot show —
 * how far a tap moved it (#17) — and a button goes grey where the ladder ends.
 */
function StepperRow<T extends number>({ label, name, value, step, onStep }: {
  /** The row's name, as the owner reads it. */
  label: string;
  /** The same, in the words VoiceOver puts after Decrease and Increase. */
  name: string;
  value: T;
  step(value: T, direction: 1 | -1): T | null;
  onStep(next: T): void;
}) {
  const button = (direction: 1 | -1) => {
    const next = step(value, direction);
    const disabled = next === null;
    return <Pressable accessibilityRole="button" accessibilityLabel={`${direction < 0 ? 'Decrease' : 'Increase'} ${name}`}
      accessibilityState={{ disabled }} disabled={disabled} style={[styles.step, disabled && { opacity: 0.3 }]}
      onPress={() => { if (next !== null) onStep(next); }}>
      <Icon name={direction < 0 ? 'minus' : 'plus'} color={INK.text} size={26} />
    </Pressable>;
  };
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><View style={styles.stepper}>
    {button(-1)}<Text style={styles.size}>{value}</Text>{button(1)}
  </View></View>;
}

export function AppearanceControls({ appearance, onChange, onFonts }: {
  appearance: Appearance; onChange(next: Appearance): void; onFonts(): void;
}) {
  const chosen = READING_FONTS.find((font) => font.id === appearance.font)?.label ?? ORIGINAL_FONT;
  return <View style={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Font, ${chosen}`} onPress={onFonts} style={styles.row}>
      <Text style={styles.label}>Font</Text>
      <View style={styles.value}><Text style={styles.detail} numberOfLines={1}>{chosen}</Text><Icon name="next" color={INK.quiet} size={18} /></View>
    </Pressable>
    <StepperRow label="Font Size" name="font size" value={appearance.size} step={stepFontSize}
      onStep={(size) => onChange({ ...appearance, size })} />
    {/* Above Alignment, where the owner put it (#84). */}
    <StepperRow label="Margins" name="margins" value={appearance.margins} step={stepMargins}
      onStep={(margins) => onChange({ ...appearance, margins })} />
    <ChoiceMenu label="Alignment" choices={ALIGNMENT_CHOICES} chosen={appearance.textAlignment} height={ROW_HEIGHT}
      onChoose={(textAlignment) => onChange({ ...appearance, textAlignment })}>
      <View style={styles.row}>
        <Text style={styles.label}>Alignment</Text>
        <View style={styles.value}>
          <Text style={styles.detail} numberOfLines={1}>{ALIGNMENT_CHOICES.find((choice) => choice.value === appearance.textAlignment)?.label}</Text>
          <Icon name="menu" color={INK.quiet} size={18} />
        </View>
      </View>
    </ChoiceMenu>
  </View>;
}

/**
 * The font list, as its own page rather than an accordion under the row.
 *
 * **Every name is set in the font it offers.** A list that names fonts in one
 * typeface asks the owner to know what Georgia looks like; a list that shows
 * them answers the question it is asking. `ORIGINAL_FONT` is the exception and
 * is set in the interface font, because the book's own face is not known here —
 * it is whatever that book ships, and it differs per book.
 */
export function FontList({ appearance, onChange }: { appearance: Appearance; onChange(next: Appearance): void }) {
  const rows = [null, ...READING_FONTS.map((font) => font.id)] as const;
  const borders = useBorders();
  return <ScrollView style={styles.fonts}>
    {rows.map((id) => {
      const font = READING_FONTS.find((one) => one.id === id);
      const chosen = appearance.font === id;
      return <Pressable key={id ?? 'document'} accessibilityRole="button" accessibilityState={{ selected: chosen }}
        accessibilityLabel={font?.label ?? ORIGINAL_FONT} onPress={() => onChange({ ...appearance, font: id })}
        style={({ pressed }) => [styles.fontRow, { borderBottomColor: borders.line }, pressed && { opacity: 0.5 }]}>
        <Text style={[styles.fontChoice, font?.preview ? { fontFamily: font.preview } : null]} numberOfLines={1}>
          {font?.label ?? ORIGINAL_FONT}
        </Text>
        {chosen ? <Icon name="check" color={INK.reading} size={20} /> : null}
      </Pressable>;
    })}
  </ScrollView>;
}

export function AppearanceSheet(props: { visible: boolean; onClose(): void; document: string; appearance: Appearance; onChange(next: Appearance): void }) {
  const [fonts, setFonts] = useState(false);
  return <Sheet visible={props.visible} title={fonts ? 'Fonts' : 'Appearance'}
    onClose={() => { setFonts(false); props.onClose(); }} onBack={fonts ? () => setFonts(false) : undefined}>
    {fonts ? <FontList appearance={props.appearance} onChange={props.onChange} />
      : <AppearanceControls {...props} onFonts={() => setFonts(true)} />}
  </Sheet>;
}

const styles = StyleSheet.create({
  // The phone's Body for a row's label and for what it says, in the quiet ink,
  // as on the settings pages (#99).
  content: { paddingHorizontal: 20 },
  row: { minHeight: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: { ...TEXT.body, color: INK.text },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  detail: { ...TEXT.body, color: INK.quiet, flexShrink: 1 },
  fonts: { flexGrow: 0, maxHeight: 420 },
  fontRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  fontChoice: { ...TEXT.body, color: INK.text, flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: INK.line, borderRadius: 30 },
  step: { width: 62, height: 44, alignItems: 'center', justifyContent: 'center' },
  size: { ...TEXT.body, color: INK.text, fontVariant: ['tabular-nums'], minWidth: 24, textAlign: 'center' },
});
