import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { READING_FONTS, READING_SCALES, type Appearance } from '../renderer/highlighter';
import { INK } from './controls';
import { Icon } from './icon';
import { Sheet } from './sheet';

export function AppearanceControls({ appearance, onChange }: { appearance: Appearance; onChange(next: Appearance): void }) {
  const [fonts, setFonts] = useState(false);
  const chosen = READING_FONTS.find((font) => font.id === appearance.font)?.label ?? 'Document font';
  const scales = [...READING_SCALES, 100].sort((a, b) => a - b);
  const at = scales.indexOf(appearance.scale ?? 100);
  return <View style={styles.content}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Font, ${chosen}`} onPress={() => setFonts(!fonts)} style={styles.row}>
      <Text style={styles.label}>Font</Text><View style={styles.value}><Text style={styles.font}>{chosen}</Text><Icon name={fonts ? 'down' : 'next'} color={INK.quiet} size={20} /></View>
    </Pressable>
    {fonts ? [null, ...READING_FONTS.map((font) => font.id)].map((id) => <Pressable key={id ?? 'document'}
      accessibilityRole="button" accessibilityState={{ selected: appearance.font === id }} style={styles.fontRow}
      onPress={() => { onChange({ ...appearance, font: id }); setFonts(false); }}>
      <Text style={styles.fontChoice}>{READING_FONTS.find((font) => font.id === id)?.label ?? 'Document font'}</Text>
      {appearance.font === id ? <Icon name="check" color={INK.text} size={20} /> : null}
    </Pressable>) : null}
    <View style={styles.row}><Text style={styles.label}>Font Size</Text><View style={styles.stepper}>
      {[-1, 1].map((direction) => { const disabled = at + direction < 0 || at + direction >= scales.length;
        return <Pressable key={direction} accessibilityRole="button" accessibilityLabel={direction < 0 ? 'Decrease font size' : 'Increase font size'}
          accessibilityState={{ disabled }} disabled={disabled} style={[styles.step, disabled && { opacity: 0.3 }]}
          onPress={() => { const size = scales[at + direction]; onChange({ ...appearance, scale: size === 100 ? null : size as Appearance['scale'] }); }}>
          <Icon name={direction < 0 ? 'minus' : 'plus'} color={INK.text} size={28} />
        </Pressable>; })}
    </View></View>
    <Pressable accessibilityRole="button" onPress={() => onChange({ font: null, scale: null })} style={styles.reset}>
      <Text style={styles.secondary}>Use document appearance</Text>
    </Pressable>
  </View>;
}
export function AppearanceSheet(props: { visible: boolean; onClose(): void; document: string; appearance: Appearance; onChange(next: Appearance): void }) {
  return <Sheet visible={props.visible} title="Appearance" onClose={props.onClose}><AppearanceControls {...props} /></Sheet>;
}
const styles = StyleSheet.create({
  content: { paddingHorizontal: 22 }, row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: { color: INK.text, fontSize: 19 }, value: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  font: { color: INK.quiet, fontSize: 20, flexShrink: 1 }, fontRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fontChoice: { color: INK.text, fontSize: 17 }, stepper: { flexDirection: 'row', backgroundColor: INK.line, borderRadius: 30 },
  step: { width: 66, height: 46, alignItems: 'center', justifyContent: 'center' }, reset: { paddingVertical: 14 }, secondary: { color: INK.quiet, fontSize: 14 },
});
