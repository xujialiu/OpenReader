/**
 * **Appearance**: a sheet over the reader, and not a route (ADR 0019).
 *
 * The reason is the whole of the decision and it is one sentence: the page
 * behind it must stay visible while a font size is being changed, because the
 * change is judged by looking at the text, and covering the text defeats it. A
 * route covers the text. So this rises from the bottom, over the page, and the
 * page is still there.
 *
 * ## It holds nothing yet, and says so
 *
 * The one control it will hold — how big the text is — belongs to the next piece
 * of work, and half-building it here would be a stub that has to be believed and
 * then found out (`src/README.md`). What is built is the sheet itself, which is
 * the part ADR 0019 actually decided: that Appearance is presented *over* the
 * reader rather than pushed on top of it, and that the reader keeps rendering
 * behind it. Filling this in is adding rows to the one `View` below.
 *
 * `transparent` with `animationType="slide"` rather than a form sheet: a form
 * sheet on iOS dims and shrinks what is behind it, which is the same defeat as a
 * route in a gentler form.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { INK, Note } from './controls';

export function AppearanceSheet({ visible, onClose, document }: { visible: boolean; onClose(): void; document: string }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Tapping the page behind the sheet closes it. The page is visible, which is the point, so it is also tappable. */}
      <Pressable style={styles.behind} onPress={onClose} accessibilityLabel="Close Appearance" />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        <Text style={styles.title}>Appearance</Text>
        <Note>
          Nothing to change yet. How big the text is will be here, and it is changed with {document} still on the screen
          behind this — which is why this is a sheet and not a screen of its own.
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
