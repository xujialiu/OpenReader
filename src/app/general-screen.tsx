/**
 * **General**: what is true of the whole app (ADR 0019).
 *
 * It holds nothing yet, and says so in as many words. That is the same choice
 * the Appearance sheet already made and for the same reason: half-building the
 * one thing it will hold would be a stub that has to be believed and then found
 * out (`src/README.md`), while an entry that is honestly empty is something the
 * owner can check against the promise.
 *
 * What it is not is the reading speed. That is app-wide and it is already a
 * control in the player, where the effect of changing it can be heard as it is
 * changed — moving it here would mean leaving the book to adjust the voice
 * reading it.
 */

import { ScrollView, StyleSheet } from 'react-native';

import { APP_NAME } from '../../app-name';

import { INK, Note, Section } from './controls';

export function GeneralScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Section title="Nothing here yet">
        <Note>
          How {APP_NAME} looks — light or dark, and how big the text is — will be here. Neither is built, and this says
          so rather than showing a switch that does nothing: a setting that turns out to have no effect is one this app
          removes rather than ships.
        </Note>
        <Note>
          The reading speed is not here on purpose. It is in the player, with the book on the screen, because it is
          judged by listening to the change rather than by reading about it.
        </Note>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { gap: 28, paddingBottom: 64, paddingHorizontal: 20, paddingTop: 16 },
  screen: { backgroundColor: INK.page, flex: 1 },
});
