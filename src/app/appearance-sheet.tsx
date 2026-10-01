import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { READING_FONTS, stepFontSize, stepMargins, TEXT_ALIGNMENTS, type Appearance, type TextAlignment } from '../renderer/highlighter';
import { ChoiceMenu, INK, type Choice } from './controls';
import { DRAWER, Drawer, DrawerChevron, DrawerRow, DrawerRowText, DrawerRowValue, DrawerScroll, useDrawerColours } from './drawer';
import { drawerRowText } from './drawer-list';
import { Icon } from './icon';

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

/**
 * The phone's own stepper, copied: a 94 × 32 capsule of two 47-pt halves
 * (notes, 2026-10-01 11:45, the `Form`'s Stepper row). Ours has the number
 * between the halves (design 0030, #17), so it is as much wider as the number.
 */
const STEPPER = { height: 32, half: 47 } as const;

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
  const colours = useDrawerColours();
  const button = (direction: 1 | -1) => {
    const next = step(value, direction);
    const disabled = next === null;
    return <Pressable accessibilityRole="button" accessibilityLabel={`${direction < 0 ? 'Decrease' : 'Increase'} ${name}`}
      accessibilityState={{ disabled }} disabled={disabled} hitSlop={{ top: 6, bottom: 6 }} style={[styles.step, disabled && styles.ended]}
      onPress={() => { if (next !== null) onStep(next); }}>
      <Icon name={direction < 0 ? 'minus' : 'plus'} color={INK.text} size={22} />
    </Pressable>;
  };
  return <DrawerRow accessory={<View style={[styles.stepper, { backgroundColor: colours.button }]}>
    {button(-1)}<Text style={styles.number}>{value}</Text>{button(1)}
  </View>}>
    <DrawerRowText>{label}</DrawerRowText>
  </DrawerRow>;
}

/**
 * Appearance's rows, as the drawer's plain list (#117). Each change goes to
 * the page behind as it is made, which the drawer leaves in view.
 *
 * A row is one entry of this list, so another kind of row, such as the
 * highlight colours (#118), goes in as one more entry.
 */
export function AppearanceControls({ appearance, onChange, onFonts }: {
  appearance: Appearance; onChange(next: Appearance): void; onFonts(): void;
}) {
  const chosen = READING_FONTS.find((font) => font.id === appearance.font)?.label ?? ORIGINAL_FONT;
  const alignment = ALIGNMENT_CHOICES.find((choice) => choice.value === appearance.textAlignment)?.label;
  return <DrawerScroll>
    <DrawerRow onPress={onFonts} accessibilityLabel={`Font, ${chosen}`}
      accessory={<><DrawerRowValue>{chosen}</DrawerRowValue><DrawerChevron /></>}>
      <DrawerRowText>Font</DrawerRowText>
    </DrawerRow>
    <StepperRow label="Font Size" name="font size" value={appearance.size} step={stepFontSize}
      onStep={(size) => onChange({ ...appearance, size })} />
    {/* Above Alignment, where the owner put it (#84). */}
    <StepperRow label="Margins" name="margins" value={appearance.margins} step={stepMargins}
      onStep={(margins) => onChange({ ...appearance, margins })} />
    {/* The system's own menu over a row it only draws (ADR 0035). */}
    <ChoiceMenu label="Alignment" choices={ALIGNMENT_CHOICES} chosen={appearance.textAlignment} height={DRAWER.row.rowHeight}
      onChoose={(textAlignment) => onChange({ ...appearance, textAlignment })}>
      <DrawerRow accessory={<><DrawerRowValue>{alignment}</DrawerRowValue><Icon name="menu" color={INK.secondary} size={18} /></>}>
        <DrawerRowText>Alignment</DrawerRowText>
      </DrawerRow>
    </ChoiceMenu>
  </DrawerScroll>;
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
  return <DrawerScroll>
    {rows.map((id) => {
      const font = READING_FONTS.find((one) => one.id === id);
      const chosen = appearance.font === id;
      return <DrawerRow key={id ?? 'document'} accessibilityState={{ selected: chosen }} accessibilityLabel={font?.label ?? ORIGINAL_FONT}
        onPress={() => onChange({ ...appearance, font: id })}
        accessory={chosen ? <Icon name="check" color={INK.reading} size={20} strokeWidth={2.2} /> : null}>
        <DrawerRowText style={font?.preview ? { fontFamily: font.preview } : null}>{font?.label ?? ORIGINAL_FONT}</DrawerRowText>
      </DrawerRow>;
    })}
  </DrawerScroll>;
}

/** Appearance on its own, opened by the walkthrough harness (`appearsheet`); the owner reaches it through a Document's actions. */
export function AppearanceSheet(props: { visible: boolean; onClose(): void; document: string; appearance: Appearance; onChange(next: Appearance): void }) {
  const [fonts, setFonts] = useState(false);
  return <Drawer visible={props.visible} title={fonts ? 'Fonts' : 'Appearance'}
    onClose={() => { setFonts(false); props.onClose(); }} onBack={fonts ? () => setFonts(false) : undefined}>
    {fonts ? <FontList appearance={props.appearance} onChange={props.onChange} />
      : <AppearanceControls {...props} onFonts={() => setFonts(true)} />}
  </Drawer>;
}

const styles = StyleSheet.create({
  // Over the row's padding, so the row stays 52 pt, as the phone's Stepper row is.
  stepper: { alignItems: 'center', borderRadius: STEPPER.height / 2, flexDirection: 'row', height: STEPPER.height },
  step: { alignItems: 'center', height: STEPPER.height, justifyContent: 'center', width: STEPPER.half },
  ended: { opacity: 0.3 },
  number: { ...drawerRowText(false), color: INK.text, fontVariant: ['tabular-nums'], minWidth: 24, textAlign: 'center' },
});
