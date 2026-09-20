/**
 * **Appearance**: a sheet over the reader, and not a route (ADR 0019).
 *
 * The reason is the whole of the decision and it is one sentence: the page
 * behind it must stay visible while a font size is being changed, because the
 * change is judged by looking at the text, and covering the text defeats it. A
 * route covers the text. So this rises from the bottom, over the page, and the
 * page is still there.
 *
 * ## Two rows, and both of them default to the document's own
 *
 * A book that ships its own typography keeps it until the owner overrides it.
 * That is why "The document's own" is a **choice in each row** rather than a
 * "reset" button somewhere: it is the state both rows start in, so it has to be
 * visible as the thing that is currently chosen, not hidden behind a verb.
 *
 * There is no 100% in the size row, deliberately. "The size this book chose" is
 * already the first chip, and a second spelling of it would be a chip that looks
 * like a choice and changes nothing — which is philosophy rule 6 from the other
 * side.
 *
 * The change applies **as it is made**, with no Done to press for it: the sheet's
 * whole reason for existing is that the owner judges it by looking at the text
 * behind, and a change that waited for a button would make them close the sheet
 * to see what they had chosen. Done is there to get out, and the page behind is
 * tappable for the same job.
 *
 * `transparent` with `animationType="slide"` rather than a form sheet: a form
 * sheet on iOS dims and shrinks what is behind it, which is the same defeat as a
 * route in a gentler form.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { READING_FONTS, READING_SCALES, type Appearance, type ReadingFont } from '../renderer/highlighter';

import { Choice, INK, Note } from './controls';

/** What each row shows for "leave this book's own typography alone". A string, because `Choice` compares by value and null is not one. */
const FOLLOW = 'The document’s own';

export function AppearanceSheet({
  visible,
  onClose,
  appearance,
  onChange,
}: {
  visible: boolean;
  onClose(): void;
  document: string;
  appearance: Appearance;
  onChange(next: Appearance): void;
}) {
  const fonts = [FOLLOW, ...READING_FONTS.map((one) => one.label)];
  const chosenFont = READING_FONTS.find((one) => one.id === appearance.font)?.label ?? FOLLOW;
  const scales = [FOLLOW, ...READING_SCALES.map((one) => `${one}%`)];
  const chosenScale = appearance.scale === null ? FOLLOW : `${appearance.scale}%`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the page behind the sheet closes it. The page is visible, which is the point, so it is also tappable. */}
      <Pressable style={styles.behind} onPress={onClose} accessibilityLabel="Close Appearance" />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        <Text style={styles.title}>Appearance</Text>

        <Text style={styles.label}>Font</Text>
        <Choice
          options={fonts}
          value={chosenFont}
          onChange={(label) => {
            const found = READING_FONTS.find((one) => one.label === label);
            onChange({ ...appearance, font: (found?.id ?? null) as ReadingFont | null });
          }}
        />

        <Text style={styles.label}>Size</Text>
        <Choice
          options={scales}
          value={chosenScale}
          onChange={(label) => {
            const found = READING_SCALES.find((one) => `${one}%` === label);
            onChange({ ...appearance, scale: found ?? null });
          }}
        />

        <Note>
          Applies to all documents. Resets when the app closes.
        </Note>

        <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  behind: { flex: 1 },
  done: { alignItems: 'center', backgroundColor: INK.text, borderRadius: 10, paddingVertical: 12 },
  doneLabel: { color: INK.page, fontSize: 15, fontWeight: '600' },
  grip: { alignSelf: 'center', backgroundColor: INK.line, borderRadius: 3, height: 5, marginBottom: 6, width: 40 },
  label: { color: INK.text, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.65 },
  sheet: {
    backgroundColor: INK.panel,
    borderTopColor: INK.line,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
    paddingBottom: 36,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  title: { color: INK.text, fontSize: 18, fontWeight: '700' },
});
