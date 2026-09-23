/**
 * **General**: what is true of the whole app (ADR 0019).
 *
 * Two things are. The **theme** (ADR 0022) — light, dark, or whatever the phone
 * is doing — which belongs here rather than in the Appearance sheet because
 * those are two different questions: Appearance is how the text on the page is
 * set — the owner's size and alignment, and a font that starts on the book's
 * own — while the theme is what the whole app looks like in the room the owner
 * is sitting in, and it reaches the Library and these Settings screens as much
 * as it reaches the page.
 *
 * And whether an Utterance's brackets are spoken with it (ADR 0028, and #25
 * for wherever they stand), which is app-wide for the same reason: it is true
 * of every Voice and every Document, so it is not a property of the book being
 * read.
 *
 * What is still not here is the text size. That is in Appearance, over the book,
 * because it is judged by looking at the book while it changes.
 *
 * What it is not is the reading speed. That is app-wide and it is already a
 * control in the player, where the effect of changing it can be heard as it is
 * changed — moving it here would mean leaving the book to adjust the voice
 * reading it.
 *
 * ## Why the theme's card has no header
 *
 * Its one row is called `Theme`, and a header saying `Theme` over it said the
 * same word twice (#48). It was never going to say `Appearance`: CONTEXT.md
 * gives that word to how a *document's* text is set, and a header using it for
 * the app's own light and dark would put two meanings on one term in the one
 * file whose job is to stop exactly that.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { DEFAULT_BRACKET_PAIRS, validateBracketPairs } from '../core/speech-text';
import { Footnote, INK, SettingsGroup, SettingsPage, SwitchRow, TextRow, ValueRow, type Choice } from './controls';
import { useShell } from './routes';
import { THEME_LABELS, THEME_SETTINGS, type ThemeSetting } from './settings';

/**
 * The Theme menu (#33), in `THEME_SETTINGS`' order, each with the system's own
 * symbol: the half-filled circle is what iOS itself draws for "whatever the
 * device is doing".
 */
const THEME_CHOICES: readonly Choice<ThemeSetting>[] = THEME_SETTINGS.map((value) => ({
  value,
  label: THEME_LABELS[value],
  icon: ({ light: 'sun.max', dark: 'moon', system: 'circle.lefthalf.filled' } as const)[value],
}));

/**
 * What a refused list of bracket pairs is called, in the owner's words.
 *
 * `validateBracketPairs` reports which entry is wrong and why; this turns that
 * into the sentence, and names the entry, because "invalid" without saying
 * which one leaves the owner to re-read their own typing looking for it.
 */
function bracketProblem(value: string): string | null {
  const checked = validateBracketPairs(value);
  if (checked.ok) return null;
  if (checked.reason === 'empty') return 'Enter at least one pair, separated by spaces.';
  if (checked.reason === 'duplicate') return `“${checked.entry}” is entered twice. Each pair goes in once.`;
  return `“${checked.entry}” is not a pair. Each one is two different punctuation marks, like <> or 【】.`;
}

export function GeneralScreen() {
  const { settings, setSettings } = useShell();
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Switching it **on** is what checks the list, which is the whole of the
   * interlock: the field is frozen while it is on, so the only way to a new list
   * is off, edit, on — and that last step is the one place a check can happen
   * once rather than on every keystroke. A refusal leaves the setting off with
   * the owner's typing still in the field, because replacing it would discard an
   * edit in the middle of being made.
   */
  const strip = (on: boolean) => {
    if (!on) { setProblem(null); setSettings((was) => ({ ...was, stripBrackets: false })); return; }
    const refused = bracketProblem(settings.bracketPairs);
    setProblem(refused);
    if (!refused) setSettings((was) => ({ ...was, stripBrackets: true }));
  };

  return (
    <SettingsPage>
      <SettingsGroup>
        <ValueRow label="Theme" choices={THEME_CHOICES} chosen={settings.theme}
          onChoose={(theme) => setSettings((was) => ({ ...was, theme }))} />
      </SettingsGroup>

      {/* A refused list is said under the card, in place rather than in a box
          that interrupts: a mistyped bracket is a small mistake and does not
          deserve a bigger interruption than the mistake itself. The way out is
          offered next to it, because an owner who cannot see what is wrong with
          their list needs somewhere to go. The sentence about downloaded
          chapters stays under the card whatever the switch says: nothing else on
          any screen shows it (design 0041). */}
      <SettingsGroup
        title="Reading aloud"
        footer={<>
          {problem ? <Footnote attention>{problem}</Footnote> : null}
          {problem ? <Pressable accessibilityRole="button" onPress={() => {
            setProblem(null);
            setSettings((was) => ({ ...was, bracketPairs: DEFAULT_BRACKET_PAIRS, stripBrackets: true }));
          }}><Text style={styles.link}>Use {DEFAULT_BRACKET_PAIRS} instead</Text></Pressable> : null}
          <Footnote>Chapters already downloaded keep the audio they were saved with until they are downloaded again.</Footnote>
        </>}
      >
        <SwitchRow label="Remove enclosing brackets when reading" value={settings.stripBrackets} onChange={strip}
          note={settings.stripBrackets ? 'Turn off to edit.' : undefined} />
        {/* Set in the interface font rather than the document's: these are
            characters being listed, not text being read. */}
        <TextRow
          label="Bracket pairs"
          value={settings.bracketPairs}
          editable={!settings.stripBrackets}
          onChangeText={(bracketPairs) => { setProblem(null); setSettings((was) => ({ ...was, bracketPairs })); }}
          placeholder={DEFAULT_BRACKET_PAIRS}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  link: { color: INK.reading, fontSize: 13, lineHeight: 16, paddingVertical: 6 },
});
