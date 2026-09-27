/**
 * The **Reading** (CONTEXT.md, #68, ADR 0049): at most one, held here, above the
 * navigator, so that it outlives the Reader screen.
 *
 * The Reader used to own it, so going back to the Library ended it: the screen
 * unmounted and took the engine and the page with it. The page cannot be left
 * behind, because it supplies the Blocks being read, lays out the next section
 * (ADR 0023) and paints the highlight. So the whole `<ReadingView>`, WebView and
 * engine, is rendered here, once, and moved rather than remounted: into the
 * Reader's slot while the Reader is on screen, and back into a place of its own
 * behind the navigator when it is not. The move is a native reparent
 * (`react-native-teleport`), so the WebView keeps its document, its JavaScript
 * and its size, and the voice does not stop.
 *
 * A Reading ends in three ways and no others, each through the same unmount the
 * Reader's back arrow used to cause. The unmount writes the Reading Position and
 * pokes sync on the way out, as leaving always has:
 *
 * - the Reader goes while the reading is **not** playing (`left`);
 * - another document is opened (`show` with another id);
 * - this document is deleted (`end`).
 *
 * Everything the Reader screen used to work out for its `<ReadingView>` is
 * worked out here instead, from the entry of the document that is held: the
 * bytes, the Voice it inherits, a place adopted from another device, and the
 * callbacks that write back to the Library.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Portal } from 'react-native-teleport';

import type { DocumentId, ReadingPlace, ReadingPosition } from '../core/document';
import type { ProviderId } from '../core/providers/types';
import { setReadingPlays } from '../offline/runtime';

import { openDocument, type OpenDocument } from './document';
import { ReadingView } from './reading-view';
import { useShell } from './routes';
import { recentEnabledVoice, selectVoice, settingsForDocument, unusableVoiceSentence } from './settings';
import { useProviderKey } from './use-provider-secrets';

/** What the screens are told about the Reading. */
export interface HeldReading {
  id: DocumentId;
  /** Whether its page has been read and handed to the view yet. */
  opened: boolean;
  /** Why it would not open, or null. */
  note: string | null;
  playing: boolean;
  buffering: boolean;
  /** Whether the player is shown in full, and the navigation bar with it (#67). */
  chrome: boolean;
}

export interface ReadingHandle {
  current: HeldReading | null;
  /** The Reader for `id` is on screen: keep the Reading if it is this one, or end it and open this one. */
  show(id: DocumentId): void;
  /** The Reader for `id` has gone: keep the Reading if it is playing, end it if it is not. */
  left(id: DocumentId): void;
  /** End the Reading of `id`, whatever it is doing: the document is being deleted. */
  end(id: DocumentId): void;
  /** The navigation bar's height, which the Reader measures and the page keeps room for (#67). */
  setBarHeight(points: number): void;
}

const ReadingContext = createContext<ReadingHandle | null>(null);

export function useHeldReading(): ReadingHandle {
  const handle = useContext(ReadingContext);
  if (!handle) throw new Error('useHeldReading() was called outside the shell, which is what holds the Reading.');
  return handle;
}

/** The Reader's slot for one document. Named by the document so two Readers could never claim one slot. */
export function readerSlot(id: DocumentId): string {
  return `reader:${id}`;
}

interface Opened {
  document: OpenDocument;
  /** The entry's place when it was opened: both things that read it happen once, at the open. */
  position: ReadingPosition | null;
  /** The adoption that place already carries, so it is not news later (#55). */
  adoptedAt: number | null;
}

export function ReadingHost({ children }: { children: ReactNode }) {
  const { settings, setSettings, library, secretRevisions, sync } = useShell();
  const insets = useSafeAreaInsets();
  const [held, setHeld] = useState<{ id: DocumentId; shown: boolean; opened: Opened | null; note: string | null } | null>(null);
  /**
   * What the view last said about itself, and which Document said it: a Reading
   * just started has said nothing yet, and the one before it was unmounted with
   * its last word still here.
   */
  const [live, setLive] = useState<{ id: DocumentId | null; playing: boolean; buffering: boolean; chrome: boolean }>(
    { id: null, playing: false, buffering: false, chrome: true },
  );
  const [barHeight, setBarHeight] = useState(0);
  /** Read by `left`, which runs in a cleanup and must see the state of now, not of the render it closed over. */
  const playingRef = useRef(false);

  const show = useCallback(
    (id: DocumentId) => {
      setHeld((was) => {
        if (was?.id === id) return was.shown ? was : { ...was, shown: true };
        return { id, shown: true, opened: null, note: null };
      });
    },
    [],
  );
  const left = useCallback((id: DocumentId) => {
    setHeld((was) => {
      if (!was || was.id !== id) return was;
      return playingRef.current ? { ...was, shown: false } : null;
    });
  }, []);
  const end = useCallback((id: DocumentId) => {
    setHeld((was) => (was?.id === id ? null : was));
  }, []);

  const heldId = held?.id ?? null;
  const mine = live.id !== null && live.id === heldId;
  useEffect(() => {
    playingRef.current = mine && live.playing;
  }, [mine, live.playing]);
  const plays = mine && live.playing;
  /** Told here, which outlives every screen: a playing Reading's audio keeps the app running away from the screen, and a download with it (#75). */
  useEffect(() => {
    if (!plays) return;
    setReadingPlays(true);
    return () => setReadingPlays(false);
  }, [plays]);

  /**
   * Read the bytes, once per Reading. Opening a book is a sync moment (issue
   * #20), and it moves the book to the top of the Library.
   */
  useEffect(() => {
    if (!heldId) return;
    // The Reader asks only for a Document the Library has (`reader-screen.tsx`).
    const entry = library.current(heldId);
    if (!entry) return;
    let alive = true;
    library.opened(heldId);
    sync.poke('open');
    const adoptedAt = library.adoptedAt[heldId] ?? null;
    openDocument(entry, entry.title)
      .then((document) => {
        if (alive) setHeld((was) => (was?.id === heldId ? { ...was, opened: { document, position: entry.position, adoptedAt } } : was));
      })
      .catch((problem: unknown) => {
        const said = problem instanceof Error ? problem.message : String(problem);
        if (alive) setHeld((was) => (was?.id === heldId ? { ...was, note: said } : was));
      });
    return () => {
      alive = false;
    };
    // Once per Reading: the entry is rebuilt on every Library write, and
    // re-reading a 34 MB book for that would be absurd.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldId]);

  const opened = held?.opened ?? null;
  const openedId = opened?.document.identity.id ?? null;
  /** This Document's own entry, read live: its Voice is chosen here and its title can change (ADR 0010). */
  const openedEntry = useMemo(
    () => (openedId ? library.entries.find((one) => one.id === openedId) ?? null : null),
    [library.entries, openedId],
  );
  const voiceProvider = openedEntry?.voice?.provider ?? '';
  const voiceId = openedEntry?.voice?.voice ?? '';
  /** A place taken from another device since the open, and only since (#20, #55). */
  const adoptedAt = openedId ? library.adoptedAt[openedId] ?? null : null;
  const adoptedPosition = openedEntry?.position ?? null;
  const adopted = useMemo(
    () =>
      opened && adoptedAt !== null && adoptedAt !== opened.adoptedAt && adoptedPosition
        ? { at: adoptedAt, position: adoptedPosition }
        : null,
    // The position object is rebuilt on every Library write; `adoptedAt` is the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adoptedAt, opened],
  );
  const documentVoice = useMemo(() => (voiceId ? { provider: voiceProvider, voice: voiceId } : null), [voiceProvider, voiceId]);
  const forDocument = useMemo(() => settingsForDocument(settings, documentVoice), [settings, documentVoice]);
  const key = useProviderKey(forDocument.provider);

  /** A Document opened for the first time inherits the default Voice of that moment, and keeps it (ADR 0010). */
  useEffect(() => {
    if (!openedId || voiceId) return;
    const recent = recentEnabledVoice(settings);
    if (recent) library.voiced(openedId, recent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedId, voiceId]);

  /** A Voice for this Document, which is also the default for the next new one (design 0010). */
  const setVoice = useCallback(
    (provider: ProviderId, voice: string) => {
      if (!settings.enabledProviders.includes(provider)) return;
      if (openedId) library.voiced(openedId, { provider, voice });
      setSettings((previous) => selectVoice(previous, provider, voice));
    },
    [openedId, library, settings, setSettings],
  );
  const setRate = useCallback((rate: number) => setSettings((previous) => ({ ...previous, rate })), [setSettings]);
  /** Bound to the Document that is open, never to whatever is held next: a view on its way out writes its own place. */
  const reached = useCallback((place: ReadingPlace) => { if (openedId) library.reached(openedId, place); }, [library, openedId]);
  const titled = useCallback((said: string) => { if (openedId) library.retitled(openedId, said); }, [library, openedId]);
  const onChrome = useCallback(
    (chrome: boolean) => setLive((was) => (was.id === openedId ? (was.chrome === chrome ? was : { ...was, chrome }) : { id: openedId, playing: false, buffering: false, chrome })),
    [openedId],
  );
  const onState = useCallback(
    (playing: boolean, buffering: boolean) =>
      setLive((was) =>
        was.id === openedId
          ? (was.playing === playing && was.buffering === buffering ? was : { ...was, playing, buffering })
          : { id: openedId, playing, buffering, chrome: true },
      ),
    [openedId],
  );

  const handle = useMemo<ReadingHandle>(
    () => ({
      current: held
        ? {
            id: held.id,
            opened: held.opened !== null,
            note: held.note,
            playing: mine && live.playing,
            buffering: mine && live.buffering,
            chrome: mine ? live.chrome : true,
          }
        : null,
      show,
      left,
      end,
      setBarHeight,
    }),
    [held, live, mine, show, left, end],
  );

  return (
    <ReadingContext.Provider value={handle}>
      {/*
        * Behind the navigator, and the size of the Reader's slot: the page's
        * place while the Reader is not on screen. Nothing is ever seen or
        * touched here, because every screen above it is opaque. The size is
        * what matters: the view keeps the one it had in the slot, so no resize
        * reaches epub.js.
        */}
      <Portal hostName={held?.shown ? readerSlot(held.id) : undefined} style={[styles.parked, { top: insets.top }]}>
        {opened && held ? (
          /*
           * Hidden from VoiceOver while parked. The page is behind the navigator,
           * out of sight and out of reach of a finger, but still in the window,
           * and its buttons would otherwise be read out over the Library's
           * (measured: an XCTest query for a Library row matched the parked
           * player's `Playback speed, 1.50 times`).
           */
          <View style={styles.page} accessibilityElementsHidden={!held.shown}
            importantForAccessibility={held.shown ? 'auto' : 'no-hide-descendants'}>
          <ReadingView
            shown={held.shown}
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
            barHeight={barHeight}
            onChrome={onChrome}
            onState={onState}
          />
          </View>
        ) : null}
      </Portal>
      {children}
    </ReadingContext.Provider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  parked: { bottom: 0, left: 0, position: 'absolute', right: 0 },
});
