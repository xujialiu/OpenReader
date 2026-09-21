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

import type { ReadingPlace, ReadingPosition } from '../core/document';
import type { ProviderId } from '../core/providers/types';

// WALKTHROUGH-HARNESS
import { useHarnessCommands, type HarnessCommand } from './walkthrough-harness';

import { AppearanceSheet } from './appearance-sheet';
import { ReaderActions } from './reader-actions';
import { HeaderButton, INK, Note } from './controls';
import { openDocument, type OpenDocument } from './document';
import { ReadingView } from './reading-view';
import { useShell, type ScreenProps } from './routes';
import { settingsForDocument, unusableVoiceSentence, recentEnabledVoice, selectVoice } from './settings';
import { useProviderKey } from './use-provider-secrets';

export function ReaderScreen({ route, navigation }: ScreenProps<'Reader'>) {
  const { id } = route.params;
  const { settings, setSettings, library, secretRevisions, sync } = useShell();
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
  const [actions, setActions] = useState(false);

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
    // Opening a book is a sync moment (issue #20). It runs beside the open, and a
    // newer place that arrives before the owner acts takes over the resume
    // through `adopted` below.
    sync.poke('open');
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
      headerBackButtonDisplayMode: 'minimal',
      headerRight: () => <HeaderButton label="More actions" icon="more" onPress={() => setActions(true)} />,
    });
  }, [navigation, title]);

  const setRate = useCallback((rate: number) => setSettings({ ...settings, rate }), [settings, setSettings]);
  /**
   * The Document everything below writes about is **the one that is open**, not the
   * one the route now names. They are never the same during a hand-over.
   *
   * `navigate('Reader', { id })` with a different id re-renders this screen with
   * the new route param while `opened` still holds the previous Document — the
   * bytes of the next one are still being read, which for the 34 MB novel is not
   * a short window. The `<ReadingView>` for the previous Document re-renders in
   * that window and takes these callbacks with it; when `setOpened` finally lands
   * and its key changes, its unmount cleanup writes the Reading Position it has
   * been holding. Bound to `id`, that write lands on the **new** Document.
   *
   * Seen on the device: adding a second book while the first was being read gave
   * the new book the first one's Reading Position, quoted on its Library row, for
   * a sentence that is not in it. Losing a place is the failure this app exists to
   * prevent; inventing one is the same failure wearing a different coat, and ADR
   * 0008's rule is that a place which might be wrong is worse than no place.
   */
  const openedId = opened?.document.identity.id ?? null;

  /**
   * **This Document's own Voice** (ADR 0010), from the entry of the Document that
   * is *open* — never the one the route now names, for the reason the block above
   * gives about a hand-over.
   *
   * Read live rather than captured at the open, and that is what makes choosing a
   * Voice work: the choice is written to the Library, the entry changes, these two
   * strings change, `settingsForDocument` hands `<ReadingView>` a different Provider
   * and Voice, and `engineIdentity` rebuilds the engine around them. One path, and
   * the Library is the thing that remembers.
   *
   * Two strings and not the object, because the object is rebuilt every time a
   * Reading Position is written — every ten seconds while the reading runs — and a
   * memo keyed on it would hand down a new settings object that often.
   */
  const openedEntry = useMemo(
    () => (openedId ? library.entries.find((one) => one.id === openedId) ?? null : null),
    [library.entries, openedId],
  );
  const voiceProvider = openedEntry?.voice?.provider ?? '';
  const voiceId = openedEntry?.voice?.voice ?? '';
  /**
   * A place taken from another device while this book is open (issue #20):
   * when it was taken, and where it points. `adoptedAt` moves once per
   * adoption and the position is read live from the entry, so the effect in
   * `<ReadingView>` runs once per arrival and never for this screen's own
   * `reached` writes — those do not move `adoptedAt`.
   */
  const adoptedAt = openedId ? library.adoptedAt[openedId] ?? null : null;
  const adoptedPosition = openedEntry?.position ?? null;
  const adopted = useMemo(
    () => (adoptedAt !== null && adoptedPosition ? { at: adoptedAt, position: adoptedPosition } : null),
    // The position object is rebuilt on every Library write; `adoptedAt` is the
    // event, and the position that goes with it is whatever the entry holds then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adoptedAt],
  );
  const documentVoice = useMemo(
    () => (voiceId ? { provider: voiceProvider, voice: voiceId } : null),
    [voiceProvider, voiceId],
  );
  /**
   * The settings this Document is read with: the owner's, with its own Voice in
   * place of the global default. Everything below takes this one and nothing takes
   * `settings` — including the Keychain lookup, because the key that matters is the
   * one belonging to the Provider **this book** is read by.
   */
  const forDocument = useMemo(() => settingsForDocument(settings, documentVoice), [settings, documentVoice]);
  const key = useProviderKey(forDocument.provider);

  /**
   * A Document opened for the first time inherits whatever the default is **at that
   * moment**, and from then on it keeps it (ADR 0010, design 0010).
   *
   * Written down rather than left implied, which is the whole difference between
   * this and one global Voice: the default can change ten times afterwards and this
   * book is still read by the narrator it was started with. A Document opened before
   * any Voice has been chosen inherits nothing and waits — the first choice made
   * while it is open is written straight to it by `chooseVoice`.
   *
   * On `openedId` and the Document's own Voice only. The default is read at the
   * moment this runs and is deliberately not a dependency: this is the inheritance,
   * and a later change to the default is exactly what it must not follow.
   */
  useEffect(() => {
    if (!openedId || voiceId) return;
    const recent = recentEnabledVoice(settings);
    if (recent) library.voiced(openedId, recent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedId, voiceId]);

  /**
   * A Provider and a Voice at once, because a Voice belongs to exactly one Provider
   * (CONTEXT.md, ADR 0010) — so choosing one from another Provider's list is
   * choosing that Provider too.
   *
   * **Both halves are written, and they are two different things.** The Library
   * remembers it for *this* Document, which is what the reading then follows; the
   * global default becomes it as well, which is what the next Document opened for
   * the first time will inherit. That is design 0010's pair — "changing the default
   * steers the next new document and leaves everything already underway exactly as
   * it was" — and a book already underway is untouched because its own entry holds
   * its own Voice.
   */
  const setVoice = useCallback(
    (provider: ProviderId, voice: string) => {
      if (!settings.enabledProviders.includes(provider)) return;
      if (openedId) library.voiced(openedId, { provider, voice });
      setSettings((previous) => selectVoice(previous, provider, voice));
    },
    [openedId, library, settings, setSettings],
  );

  // WALKTHROUGH-HARNESS
  useHarnessCommands((command: HarnessCommand) => {
    if (String(command.do) === 'appearsheet') setAppearance(Boolean(command.on));
  });

  const reached = useCallback(
    (place: ReadingPlace) => {
      if (openedId) library.reached(openedId, place);
    },
    [library, openedId],
  );
  /** What the EPUB calls itself, once epub.js has read its metadata. A file name is not a title. */
  const titled = useCallback(
    (said: string) => {
      if (openedId) library.retitled(openedId, said);
    },
    [library, openedId],
  );

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
          document={{ ...opened.document, title: openedEntry?.title ?? opened.document.title }}
          settings={forDocument}
          voiceNote={unusableVoiceSentence(documentVoice)}
          keyPresence={key.presence}
          credentialsWrittenAt={secretRevisions[forDocument.provider] ?? 0}
          position={opened.position}
          adopted={adopted}
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
      {actions ? <ReaderActions document={id} appearance onClose={() => setActions(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: INK.page, flex: 1 },
  waiting: { alignItems: 'flex-start', flex: 1, gap: 12, justifyContent: 'center', padding: 24 },
  waitingWords: { color: INK.quiet, fontSize: 15 },
});
