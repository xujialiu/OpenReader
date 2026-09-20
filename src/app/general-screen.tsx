/**
 * **General**: what is true of the whole app (ADR 0019).
 *
 * One thing is, and it is the **theme** (ADR 0022): light, dark, or whatever the
 * phone is doing. It belongs here rather than in the Appearance sheet because
 * those are two different questions. Appearance is how *this book's* text is set,
 * and it defaults to following the document; the theme is what the whole app
 * looks like in the room the owner is sitting in, and it reaches the Library and
 * these Settings screens as much as it reaches the page.
 *
 * What is still not here is the text size. That is in Appearance, over the book,
 * because it is judged by looking at the book while it changes.
 *
 * What it is not is the reading speed. That is app-wide and it is already a
 * control in the player, where the effect of changing it can be heard as it is
 * changed — moving it here would mean leaving the book to adjust the voice
 * reading it.
 */

import { ScrollView, StyleSheet } from 'react-native';


import { Choice, INK, Note, Section } from './controls';
import { useShell } from './routes';
import { THEME_LABELS, THEME_SETTINGS } from './settings';

export function GeneralScreen() {
  const { settings, setSettings } = useShell();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Section title="Theme">
        <Choice
          options={THEME_SETTINGS}
          value={settings.theme}
          onChange={(theme) => setSettings({ ...settings, theme })}
          labelOf={(theme) => THEME_LABELS[theme]}
        />
        <Note>Resets when the app closes.</Note>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { gap: 28, paddingBottom: 64, paddingHorizontal: 20, paddingTop: 16 },
  screen: { backgroundColor: INK.page, flex: 1 },
});
