import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { READING_FONTS, stepFontSize, TEXT_ALIGNMENTS, type Appearance, type TextAlignment } from '../renderer/highlighter';
import { ChoiceMenu, INK, useBorders, type Choice } from './controls';
import { Icon } from './icon';
import { Sheet } from './sheet';

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

export function AppearanceControls({ appearance, onChange, onFonts }: {
  appearance: Appearance; onChange(next: Appearance): void; onFonts(): void;
}) {
  const chosen = READING_FONTS.find((font) => font.id === appearance.font)?.label ?? ORIGINAL_FONT;
  const step = (direction: 1 | -1) => {
    const size = stepFontSize(appearance.size, direction);
    const disabled = size === null;
    return <Pressable accessibilityRole="button" accessibilityLabel={direction < 0 ? 'Decrease font size' : 'Increase font size'}
      accessibilityState={{ disabled }} disabled={disabled} style={[styles.step, disabled && { opacity: 0.3 }]}
      onPress={() => { if (size !== null) onChange({ ...appearance, size }); }}>
      <Icon name={direction < 0 ? 'minus' : 'plus'} color={INK.text} size={26} />
    </Pressable>;
  };
  return <View style={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Font, ${chosen}`} onPress={onFonts} style={styles.row}>
      <Text style={styles.label}>Font</Text>
      <View style={styles.value}><Text style={styles.detail} numberOfLines={1}>{chosen}</Text><Icon name="next" color={INK.quiet} size={18} /></View>
    </Pressable>
    {/* The size itself between the two buttons: a number, which is the one thing
        about it the page behind cannot show — how far a tap moved it (#17). */}
    <View style={styles.row}><Text style={styles.label}>Font Size</Text><View style={styles.stepper}>
      {step(-1)}<Text style={styles.size}>{appearance.size}</Text>{step(1)}
    </View></View>
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
  // One type scale with Settings: a row's label is 16 and what it says is 16 in
  // the quiet ink, never larger than the label naming it.
  content: { paddingHorizontal: 20 },
  row: { minHeight: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: { color: INK.text, fontSize: 16 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  detail: { color: INK.quiet, fontSize: 16, flexShrink: 1 },
  fonts: { flexGrow: 0, maxHeight: 420 },
  fontRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  fontChoice: { color: INK.text, fontSize: 17, flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: INK.line, borderRadius: 30 },
  step: { width: 62, height: 44, alignItems: 'center', justifyContent: 'center' },
  size: { color: INK.text, fontSize: 16, fontVariant: ['tabular-nums'], minWidth: 24, textAlign: 'center' },
});
