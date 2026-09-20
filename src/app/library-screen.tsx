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
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { LibraryEntry } from '../core/document';

import { DocumentRow, HeaderButton, INK, Note } from './controls';
import { pickDocument } from './document';
import { useDocumentCover } from './document-cover';
import { documentFile } from './library';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { PROVIDER_LABELS, readiness, readinessSentence } from './settings';
import { useProviderKey } from './use-provider-secrets';
import { ReaderActions } from './reader-actions';
import { Icon } from './icon';
import { formatBytes, occupied, removeDownloads } from '../offline/runtime';

/** How much of the last Utterance a row shows. Two lines of it at this size; more would push the next Document off the screen. */
const QUOTATION = 90;

function progressOf(entry: LibraryEntry, present: boolean): string {
  if (!present) return 'The file for this book is not on this device any more. The place it was left is kept; add the book again to read it.';
  if (!entry.position) return 'Not started.';
  const quoted = entry.position.anchor.exact.trim().replace(/\s+/g, ' ');
  return `Last read: “${quoted.length > QUOTATION ? `${quoted.slice(0, QUOTATION)}…` : quoted}”`;
}

export function LibraryScreen({ navigation }: ScreenProps<'Library'>) {
  const { settings, library } = useShell();
  const [picking, setPicking] = useState(false);
  const [actions, setActions] = useState<LibraryEntry | null>(null);
  const menu = (entry: LibraryEntry) => Alert.alert(entry.title, undefined, [
    { text: 'Download', onPress: () => setActions(entry) },
    { text: 'Remove from Library', style: 'destructive', onPress: () => Alert.alert('Remove from Library?',
      `Local downloaded audio will also be deleted, freeing ${formatBytes(occupied(entry.id))}. The original file is kept.`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => {
          try { removeDownloads(entry.id); library.remove(entry.id); } catch (error) { library.report(String(error)); }
        } },
      ]) },
    { text: 'Cancel', style: 'cancel' },
  ]);
  const key = useProviderKey(settings.provider);

  const add = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (!picked) return;
      try {
        // Moved, not copied: iOS already made this copy in the app's temporary
        // directory before JavaScript saw it (`document.ts`).
        const entry = await library.add(picked, { move: true });
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
  }, [library, navigation]);

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

  const ready = readiness(settings, key.presence.state === 'held');

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={{ paddingVertical: 12 }}
        data={library.entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => (
          <View><LibraryDocument
            entry={item}
            present={present.has(item.id)}
            onPress={() => navigation.navigate('Reader', { id: item.id })}
          /><Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${item.title}`} onPress={() => menu(item)}
            style={{ position: 'absolute', right: 12, top: 8, padding: 10 }}><Icon name="more" color={INK.quiet} size={22} /></Pressable></View>
        )}
        ListHeaderComponent={library.note ? <View style={styles.banner}><Note attention>{library.note}</Note></View> : null}
        ListEmptyComponent={
          library.loading ? null : (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No books yet</Text>
              <Text style={styles.emptyWords}>
                Add an EPUB to start reading and listening.
              </Text>
              {ready.ready ? (
                <Note>
                  {PROVIDER_LABELS[settings.provider]} is ready to read aloud.
                </Note>
              ) : (
                <Note attention>
                  {readinessSentence(settings.provider, ready.missing)} Set up a voice in Settings to listen.
                </Note>
              )}
            </View>
          )
        }
      />
      {actions ? <ReaderActions document={actions.id} initial="download" onClose={() => setActions(null)} /> : null}
    </View>
  );
}

function LibraryDocument({ entry, present, onPress }: { entry: LibraryEntry; present: boolean; onPress(): void }) {
  const cover = useDocumentCover(entry);
  return <DocumentRow title={entry.title} progress={progressOf(entry, present)} cover={cover} onPress={onPress} />;
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingTop: 12 },
  empty: { alignItems: 'flex-start', gap: 12, padding: 24 },
  emptyTitle: { color: INK.text, fontSize: 20, fontWeight: '700' },
  emptyWords: { color: INK.quiet, fontSize: 15, lineHeight: 22 },
  screen: { backgroundColor: INK.page, flex: 1 },
});
