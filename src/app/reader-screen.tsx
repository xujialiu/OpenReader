/**
 * The **Reader**: a screen you arrive at and leave (ADR 0019).
 *
 * It takes a **Document Id** and nothing else. The Library entry it belongs to
 * is looked up here and its bytes are read here, which is what makes the route
 * survivable: a route param is serialised, a content hash still names the same
 * book tomorrow, and a path does not (ADR 0004).
 *
 * The navigation bar is the platform's: a back arrow that is also the edge
 * swipe, the Document's own name, and Appearance on the right. Back goes to the
 * Library; the reading stops when this screen unmounts — `use-reading.ts`'s one
 * cleanup disposes the engine and gives the audio session back — and the place
 * is kept, which is the last thing this screen does before it goes.
 *
 * It never shows nothing. A blank screen and a crashed app look identical, which
 * is the reason the screen this replaces existed (ADR 0018's launch crash
 * reports itself as nothing at all), and it is worth the few lines at every
 * stage: while the file is read, while the WebView lays it out, and when the
 * file turns out not to be there at all.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ReadingPosition } from '../core/document';
import type { ProviderId } from '../core/providers/types';

import { AppearanceSheet } from './appearance-sheet';
import { HeaderButton, INK, Note } from './controls';
import { openDocument, type OpenDocument } from './document';
import { ReadingView } from './reading-view';
import { useShell, type ScreenProps } from './routes';
import { useProviderKey } from './use-provider-secrets';

export function ReaderScreen({ route, navigation }: ScreenProps<'Reader'>) {
  const { id } = route.params;
  const { settings, setSettings, library, secretsWritten } = useShell();
  const entry = useMemo(() => library.entries.find((one) => one.id === id) ?? null, [library.entries, id]);

  /**
   * The bytes, and where to open them, decided together.
   *
   * One state and not two, because the Reading Position has to be the one the
   * entry held **when the Document was opened** — it is rewritten every ten
   * seconds while the reading runs, and both the things it is used for happen
   * once, at the open: the renderer reads its CFI inside its own `onReady`, and
   * `use-reading.ts` resolves its anchor against the first Blocks to arrive. A
   * value that kept changing would either do nothing or move the reading under
   * the owner.
   */
  const [opened, setOpened] = useState<{ document: OpenDocument; position: ReadingPosition | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [appearance, setAppearance] = useState(false);
  const key = useProviderKey(settings.provider);

  /**
   * The title the header shows, held here rather than read from `entry`.
   *
   * `entry` changes every time a Reading Position is written, and
   * `navigation.setOptions` with a new title on every Clip would repaint the
   * navigation bar once per sentence.
   */
  const title = entry?.title ?? 'Reading';

  /**
   * Read the bytes. Once per Document Id; the effect is what makes the route a
   * screen.
   *
   * A route that names no entry is not handled here but below, in what is
   * rendered. It is not a failure that happened — it is a fact about the route,
   * true on the first render, and an effect that set a state to say so would
   * show the owner one frame of "Reading…" for a book that is not there.
   */
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    library.opened(entry.id);
    // A `LibraryEntry` *is* a `DocumentIdentity` plus what the Library
    // remembers, so there is nothing to pick out of it.
    openDocument(entry, entry.title)
      .then((document) => {
        if (alive) setOpened({ document, position: entry.position });
      })
      .catch((problem: unknown) => {
        if (alive) setNote(problem instanceof Error ? problem.message : String(problem));
      });
    return () => {
      alive = false;
    };
    // `entry` is re-created whenever the Library changes — a Reading Position
    // being written is enough — and re-reading 34 MB for that would be absurd.
    // The Document Id is what this effect is actually about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerBackTitle: 'Library',
      headerRight: () => <HeaderButton label="Appearance" onPress={() => setAppearance(true)} />,
    });
  }, [navigation, title]);

  const setRate = useCallback((rate: number) => setSettings({ ...settings, rate }), [settings, setSettings]);
  /**
   * A Provider and a Voice at once, because a Voice belongs to exactly one Provider
   * (CONTEXT.md, ADR 0010) — so choosing one from another Provider's list is
   * choosing that Provider too. `use-reading.ts` throws the engine away and builds
   * another, which is what `engineIdentity` is for.
   */
  const setVoice = useCallback(
    (provider: ProviderId, voice: string) => setSettings({ ...settings, provider, voice }),
    [settings, setSettings],
  );
  const reached = useCallback((position: ReadingPosition) => library.reached(id, position), [library, id]);
  /** What the EPUB calls itself, once epub.js has read its metadata. A file name is not a title. */
  const titled = useCallback((said: string) => library.retitled(id, said), [library, id]);

  return (
    <View style={styles.screen}>
      {opened ? (
        /**
         * Keyed by the Document, so that another one arrives with a new bridge,
         * a new engine and none of the last book's Blocks — the renderer keeps
         * its section index outside React on purpose (`blocks.ts`), and a
         * remount is the honest way to be rid of it.
         *
         * The Document Id and not the bytes: two different books cannot share
         * one, and the same book re-read must not.
         */
        <ReadingView
          key={opened.document.identity.id}
          document={opened.document}
          settings={settings}
          keyPresence={key.presence}
          credentialsWrittenAt={secretsWritten}
          position={opened.position}
          onRate={setRate}
          onVoice={setVoice}
          onReached={reached}
          onTitle={titled}
        />
      ) : (
        <View style={styles.waiting}>
          <Text style={styles.waitingWords}>{entry && !note ? `Reading ${title}…` : `${title} would not open.`}</Text>
          {entry ? null : (
            <Note attention>
              That book is not in the Library. It may have been opened by a version of the app that has since been
              replaced, or the Library file may be one this build will not rewrite — the Library screen says which.
            </Note>
          )}
          {note ? <Note attention>{note}</Note> : null}
        </View>
      )}

      {/*
        * The Appearance is the app's and not this book's (`settings.ts`), so it is
        * written back into the same settings every other screen edits — and it
        * reaches the page through the bridge rather than by remounting anything,
        * which is what keeps the text behind the sheet visible while it changes.
        */}
      <AppearanceSheet
        visible={appearance}
        onClose={() => setAppearance(false)}
        document={title}
        appearance={settings.appearance}
        onChange={(next) => setSettings({ ...settings, appearance: next })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: INK.page, flex: 1 },
  waiting: { alignItems: 'flex-start', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  waitingWords: { color: INK.quiet, fontSize: 15 },
});
