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

import { APP_NAME } from '../../app-name';

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
        <Note>
          Dark reaches the book as well as {APP_NAME} around it. A book that ships its own colours is repainted for it —
          reading in the dark is something the room asks for, not an opinion about how the book was designed.
        </Note>
        <Note>
          Light does the opposite and leaves the book exactly as its publisher set it, including a cream page or a
          design that was already dark. Two things dark cannot reach: a picture keeps its own colours, so an
          illustration on a white background still glares; and a book that uses colour to mean something loses that
          meaning, because every colour it chose becomes one.
        </Note>
      </Section>

      <Section title="What is not here yet">
        <Note>
          How big the text is has a control of its own, over the book, under Appearance — it is judged by watching the
          book change size rather than by reading about it. The reading speed is in the player for the same reason: it
          is judged by listening.
        </Note>
        <Note>
          None of this is remembered when the app stops. Settings are shared between the owner&apos;s devices through
          their own Sync Folder, and that is not built yet; inventing a private store now would only be something for it
          to argue with later.
        </Note>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { gap: 28, paddingBottom: 64, paddingHorizontal: 20, paddingTop: 16 },
  screen: { backgroundColor: INK.page, flex: 1 },
});
