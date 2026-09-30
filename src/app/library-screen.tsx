/**
 * The **Library**: the front door (ADR 0019).
 *
 * The documents the owner has already opened, most recent first, each with what
 * it is called and how far the reading got. Tapping one opens it where it was
 * left. Two buttons in the navigation bar: one adds a book, one opens Settings.
 *
 * ## What "how far the reading got" is allowed to say
 *
 * The **quotation** of the last Utterance spoken, and no percentage. A
 * percentage would need epub.js to index the whole book — the step that is
 * already the slow part of opening the 2,077-section novel — and a number
 * arrived at any other way is an estimate, which philosophy rule 1 forbids for
 * exactly the reason it forbids an estimated Word Timing. A sentence the owner
 * recognises answers the question they are actually asking, which is "which of
 * these am I in the middle of".
 *
 * ## An entry that cannot be opened says so, and stays
 *
 * The design file: "An entry that no longer points at a file says so when it is
 * tapped rather than pretending; it is not silently removed, because a file that
 * is temporarily unreachable is not the same as one the owner threw away." Here
 * it says so *before* it is tapped as well, because the file is a local one and
 * looking is free — but it is still there to tap, and tapping it still gives the
 * sentence rather than an empty reader.
 */

import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import type { LibraryEntry } from '../core/document';

import { DocumentRow, HeaderButton, INK, Note } from './controls';
import { pickDocument } from './document';
import { useDocumentCover } from './document-cover';
import { documentFile } from './library';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { NO_PROVIDER_SENTENCE } from './settings';
import { ReaderActions } from './reader-actions';
import { READING_BUTTON_PLACE, ReadingButton } from './reading-button';
import { useHeldReading } from './reading-host';
import { TEXT, TEXT_EMPHASIZED } from './text-styles';
import { formatBytes, occupied, removeDownloads, requestInventory } from '../offline/runtime';

/** How much of the last Utterance a row shows. Two lines of it at this size; more would push the next Document off the screen. */
const QUOTATION = 90;

function progressOf(entry: LibraryEntry, present: boolean): string {
  if (!present) return 'The file for this book is not on this device any more. The place it was left is kept; add the book again to read it.';
  if (!entry.position) return 'Not started.';
  const quoted = entry.position.anchor.exact.trim().replace(/\s+/g, ' ');
  return `Last read: “${quoted.length > QUOTATION ? `${quoted.slice(0, QUOTATION)}…` : quoted}”`;
}

export function LibraryScreen({ navigation }: ScreenProps<'Library'>) {
  const { settings, library, sync } = useShell();
  /**
   * The Reading, while one is held out of sight (#68): the owner left its book
   * while it was playing. The Reading Button takes them back to it, and so does
   * the book's own row, which navigates to the Reader it already has.
   */
  const reading = useHeldReading();
  const held = reading.current;
  const [picking, setPicking] = useState(false);
  const [actions, setActions] = useState<LibraryEntry | null>(null);
  /**
   * The confirmation stays a system alert while the actions around it became a
   * drawer, because this is the one question here with two answers and a
   * destructive one: iOS draws that in red and puts it where the thumb expects,
   * and a drawer would have to imitate both. The sentence says how much space
   * comes back, which is why the inventory is asked for first.
   */
  const remove = (entry: LibraryEntry) => { void requestInventory(entry.id).then(() => Alert.alert('Delete this book?',
    `Local downloaded audio will also be deleted, freeing ${formatBytes(occupied(entry.id))}. The original file is kept.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
        // The Reading of this book ends first, and writes its place as it goes;
        // its saved audio is what is deleted next (#68).
        reading.end(entry.id);
        void removeDownloads(entry.id).then(() => { library.remove(entry.id); setActions(null); }, (error) => library.report(String(error)));
      } },
    ]), (error) => library.report(String(error))); };

  const add = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (!picked) return;
      try {
        // Moved, not copied: iOS already made this copy in the app's temporary
        // directory before JavaScript saw it (`document.ts`).
        const entry = await library.add(picked, { move: true });
        // A book the desktop has read opens at the desktop's place (issue #20).
        sync.poke('add');
        navigation.navigate('Reader', { id: entry.id });
      } catch (refused) {
        /**
         * Naming a Document can now **refuse** (ADR 0004's amendment): a file
         * that is not a ZIP, or one this build cannot read the directory of, is
         * turned away rather than given an id, because a fallback would mean one
         * book with two possible ids depending on which path named it.
         *
         * So the file's own name goes in the sentence. The reason arrives from
         * `zip.ts` already in the owner's words — it says what is wrong with the
         * file — but it says nothing about *which* file, and a banner over a
         * shelf of books that does not name one is a sentence about nothing.
         * Nothing is added and the shelf is unchanged, which is also said,
         * because the alternative reading is that something half-happened.
         */
        library.report(
          `“${picked.name}” was not added: ${refused instanceof Error ? refused.message : String(refused)}`,
        );
      }
    } catch (problem) {
      library.report(problem instanceof Error ? problem.message : String(problem));
    } finally {
      setPicking(false);
    }
  }, [library, navigation, sync]);

  /**
   * The two buttons ADR 0019 puts at the top.
   *
   * `useLayoutEffect` rather than `useEffect`, because these are set on the
   * native header: an effect that runs after paint shows the owner one frame of
   * a navigation bar with no buttons in it.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderButton icon="settings" label="Settings" onPress={() => navigation.navigate('Settings')} />,
      headerRight: () => <HeaderButton icon="plus" label={picking ? 'Adding…' : 'Add book'} onPress={() => void add()} disabled={picking} />,
    });
  }, [navigation, add, picking]);

  /**
   * Which entries still have their file, worked out once per change of the list
   * rather than once per render.
   *
   * It is a `stat` per entry, and a `FlatList` re-renders its rows for reasons
   * that have nothing to do with the Library — a scroll, a keyboard, the
   * settings changing two screens up.
   */
  const present = useMemo(() => {
    const found = new Set<string>();
    for (const entry of library.entries) {
      try {
        if (documentFile(entry.id, entry.format).exists) found.add(entry.id);
      } catch {
        // Unreadable counts as not present, and the row says so. There is no
        // third thing to tell the owner here.
      }
    }
    return found;
  }, [library.entries]);

  return (
    <View style={styles.screen}>
      <FlatList
        // Room below the last row for the Reading Button, so the last book can
        // be scrolled clear of it and its actions reached.
        contentContainerStyle={{ paddingTop: 12, paddingBottom: held ? READING_BUTTON_ROOM : 12 }}
        data={library.entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => (
          <LibraryDocument
            entry={item}
            present={present.has(item.id)}
            onPress={() => navigation.navigate('Reader', { id: item.id })}
            onActions={() => setActions(item)}
          />
        )}
        ListHeaderComponent={library.note ? <View style={styles.banner}><Note attention>{library.note}</Note></View> : null}
        ListEmptyComponent={
          library.loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No books yet</Text>
              <Text style={styles.emptyWords}>
                Add an EPUB to start reading and listening.
              </Text>
              {/*
               * Only whether any Provider is enabled: there is no default Voice
               * (design 0026), so before a book is opened nothing else about
               * listening is true yet (#103).
               */}
              {settings.enabledProviders.length === 0 ? <Note attention>{NO_PROVIDER_SENTENCE}</Note> : null}
            </View>
          )
        }
      />
      {held ? (
        <View style={styles.reading} pointerEvents="box-none">
          <ReadingButton playing={held.playing} buffering={held.buffering} label="Return to the reading"
            onPress={() => navigation.navigate('Reader', { id: held.id })} />
        </View>
      ) : null}
      {actions ? <ReaderActions document={actions.id} onClose={() => setActions(null)} onDelete={() => remove(actions)} /> : null}
    </View>
  );
}

/** A long press on the row opens the same drawer as its `…`. */
function LibraryDocument({ entry, present, onPress, onActions }: { entry: LibraryEntry; present: boolean; onPress(): void; onActions(): void }) {
  const cover = useDocumentCover(entry);
  return <DocumentRow title={entry.title} progress={progressOf(entry, present)} cover={cover} onPress={onPress} onLongPress={onActions} onActions={onActions} />;
}

/** The Reading Button's own height and its distance from the bottom, and the list's usual 12 above it. */
const READING_BUTTON_ROOM = READING_BUTTON_PLACE.bottom + 52 + 12;

const styles = StyleSheet.create({
  reading: { alignItems: 'flex-end', ...READING_BUTTON_PLACE },
  banner: { paddingHorizontal: 16, paddingTop: 12 },
  empty: { alignItems: 'flex-start', gap: 12, padding: 24 },
  emptyTitle: { ...TEXT_EMPHASIZED.title3, color: INK.text },
  emptyWords: { ...TEXT.subhead, color: INK.quiet },
  screen: { backgroundColor: INK.page, flex: 1 },
});
