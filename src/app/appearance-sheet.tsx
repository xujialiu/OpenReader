import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { READING_FONTS, READING_SCALES, type Appearance } from '../renderer/highlighter';
import { INK } from './controls';
import { Icon } from './icon';
import { Sheet } from './sheet';

/** What "follow the document" is called where the owner reads it: the book's own, not "the document font". */
export const ORIGINAL_FONT = 'Original Book Font';

export function AppearanceControls({ appearance, onChange, onFonts }: {
  appearance: Appearance; onChange(next: Appearance): void; onFonts(): void;
}) {
  const chosen = READING_FONTS.find((font) => font.id === appearance.font)?.label ?? ORIGINAL_FONT;
  const scales = [...READING_SCALES, 100].sort((a, b) => a - b);
  const at = scales.indexOf(appearance.scale ?? 100);
  return <View style={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Font, ${chosen}`} onPress={onFonts} style={styles.row}>
      <Text style={styles.label}>Font</Text>
      <View style={styles.value}><Text style={styles.detail} numberOfLines={1}>{chosen}</Text><Icon name="next" color={INK.quiet} size={18} /></View>
    </Pressable>
    <View style={styles.row}><Text style={styles.label}>Font Size</Text><View style={styles.stepper}>
      {[-1, 1].map((direction) => { const disabled = at + direction < 0 || at + direction >= scales.length;
        return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction < 0 ? 'Decrease font size' : 'Increase font size'}
          accessibilityState={{ disabled }} disabled={disabled} style={[styles.step, disabled && { opacity: 0.3 }]}
          onPress={() => { const size = scales[at + direction]; onChange({ ...appearance, scale: size === 100 ? null : size as Appearance['scale'] }); }}>
          <Icon name={direction < 0 ? 'minus' : 'plus'} color={INK.text} size={26} />
        </Pressable>; })}
    </View></View>
    <Pressable accessibilityRole="button" onPress={() => onChange({ font: null, scale: null })} style={styles.reset}>
      <Text style={styles.secondary}>Use document appearance</Text>
    </Pressable>
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
  return <ScrollView style={styles.fonts}>
    {rows.map((id) => {
      const font = READING_FONTS.find((one) => one.id === id);
      const chosen = appearance.font === id;
      return <Pressable key={id ?? 'document'} accessibilityRole="button" accessibilityState={{ selected: chosen }}
        accessibilityLabel={font?.label ?? ORIGINAL_FONT} onPress={() => onChange({ ...appearance, font: id })}
        style={({ pressed }) => [styles.fontRow, pressed && { opacity: 0.5 }]}>
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
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: { color: INK.text, fontSize: 16 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  detail: { color: INK.quiet, fontSize: 16, flexShrink: 1 },
  fonts: { flexGrow: 0, maxHeight: 420 },
  fontRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, paddingHorizontal: 20, borderBottomColor: INK.line, borderBottomWidth: StyleSheet.hairlineWidth },
  fontChoice: { color: INK.text, fontSize: 17, flexShrink: 1 },
  stepper: { flexDirection: 'row', backgroundColor: INK.line, borderRadius: 30 },
  step: { width: 62, height: 44, alignItems: 'center', justifyContent: 'center' },
  reset: { paddingVertical: 14 },
  secondary: { color: INK.quiet, fontSize: 14 },
});
