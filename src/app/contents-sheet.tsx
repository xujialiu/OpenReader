/**
 * **Contents**: the Document's own list of its parts, open at the chapter the
 * reading is in (ADR 0020).
 *
 * This is half of what replaced the progress bar, and the half that answers "where
 * am I". So the thing to get right is not the list, it is the **opening**: it
 * mounts already scrolled to the current row with that row marked, because a list
 * that opened at the top of the book would answer neither of the two questions a
 * reader has.
 *
 * ## One list, not a drill-down
 *
 * The owner's novel has thirteen volumes and 2,076 entries, so the contents cannot
 * be one flat run of two thousand unheaded lines — but it is not two screens
 * either. Volumes are headings *in* the list and chapters are indented under them:
 * one flick of a thumb, rather than pick a volume, go back, pick a chapter.
 *
 * A heading is **also somewhere to go**, not only a label. The book puts a title
 * page at the start of each volume, and a heading that could not be tapped would
 * make those thirteen pages the only ones the contents could not reach.
 *
 * ## Why a FlatList and a fixed row height
 *
 * `initialScrollIndex` into 2,076 rows needs `getItemLayout`, and `getItemLayout`
 * needs every row to be the same height — which they are, because a label is one
 * line: measured on the owner's book, the longest of its 2,076 is 22 characters.
 * A sectioned list with sticky headers would have given the headers a different
 * height and taken the one thing this sheet exists for.
 */

import { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { contentsOf, currentRow, type ContentsRow, type NavigationEntry } from '../core/document/contents';

import { INK, Note } from './controls';

/** One line per row, and the same height for every one of them: what makes the list open where it should. */
const ROW_HEIGHT = 46;

export interface ContentsSheetProps {
  visible: boolean;
  onClose(): void;
  /** The document's navigation, as the EPUB library reports it. */
  navigation: readonly NavigationEntry[];
  /** Every spine item's href, in spine order, from the document message. Empty until it arrives, and then every row is unreachable. */
  spineHrefs: readonly string[];
  /** The spine item the reading is in, or the one on the page when nothing is being read. Null when neither is known. */
  section: number | null;
  /** Go here: a spine index. The caller does the two steps (`use-reading.ts`'s `goToSection`). */
  onGo(section: number): void;
}

export function ContentsSheet({ visible, onClose, navigation, spineHrefs, section, onGo }: ContentsSheetProps) {
  /**
   * Flattened once per document rather than per open. Measured on the owner's book:
   * 0.772 ms for all 2,076 entries, two thirds of which is building the spine table
   * — so this is cheap, and it is memoised because the alternative is doing it again
   * every time the sheet's parent re-renders, which is once per Utterance.
   */
  const contents = useMemo(() => contentsOf(navigation, spineHrefs), [navigation, spineHrefs]);
  const here = useMemo(
    () => (section === null ? null : currentRow(contents, { sectionIndex: section })),
    [contents, section],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* The page stays visible behind the sheet and is what closes it, the same as the Appearance sheet. */}
      <Pressable style={styles.behind} onPress={onClose} accessibilityLabel="Close the contents" />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        <Text style={styles.title}>Contents</Text>

        {contents.rows.length === 0 ? (
          <Note>
            This book has no contents of its own. That is ordinary rather than a fault — some EPUBs carry none — and
            nothing else stops working: tapping a sentence still reads from there.
          </Note>
        ) : null}

        {contents.rows.length > 0 && contents.unreachable === contents.rows.length ? (
          <Note attention>
            {spineHrefs.length === 0
              ? 'The list of this book’s own files has not arrived yet, so no row can be opened. It arrives as the document installs.'
              : 'None of these rows names a file in this book. The contents live in a different folder from the pages, which this app matches by name — so the list can be read but not followed.'}
          </Note>
        ) : null}

        <FlatList
          data={contents.rows}
          style={styles.list}
          keyExtractor={(_, index) => String(index)}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          // Where the reading is, which is the whole point of the sheet. `undefined`
          // rather than 0 when it is not known: 0 would be a claim that the reading is
          // at the beginning of the book.
          initialScrollIndex={here?.row}
          initialNumToRender={24}
          windowSize={7}
          renderItem={({ item, index }) => (
            <Row
              row={item}
              current={here?.row === index}
              onPress={() => {
                if (item.target === null) return;
                onGo(item.target);
                onClose();
              }}
            />
          )}
        />

        {here ? <Note>{precisionLine(here.precision)}</Note> : null}
      </View>
    </Modal>
  );
}

/**
 * How exactly the marked row was pinned down, in the owner's words.
 *
 * Said out loud because ADR 0020 chose the coarse answer over the confident one:
 * where the contents cannot resolve finer than a file, the list marks the part
 * rather than guessing at the chapter, and a reader who is told nothing would read
 * the mark as exact.
 */
function precisionLine(precision: 'exact' | 'shared' | 'before'): string {
  if (precision === 'exact') return 'The marked row is the one being read.';
  if (precision === 'shared') {
    return 'Several rows share this file, so the marked one is the part being read rather than the chapter within it.';
  }
  return 'This page is not in the contents, so the nearest row before it is marked.';
}

function Row({ row, current, onPress }: { row: ContentsRow; current: boolean; onPress(): void }) {
  const unreachable = row.target === null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: current, disabled: unreachable }}
      onPress={onPress}
      disabled={unreachable}
      style={({ pressed }) => [styles.row, current && styles.rowCurrent, pressed && styles.pressed]}
    >
      <Text
        style={[
          styles.rowLabel,
          row.heading && styles.rowHeading,
          current && styles.rowLabelCurrent,
          unreachable && styles.rowUnreachable,
          // One indent per level. A book with volumes inside volumes indents the
          // inner ones, which is why this is arithmetic and not two styles.
          row.depth > 0 ? { paddingLeft: 16 + row.depth * 16 } : null,
        ]}
        numberOfLines={1}
      >
        {row.label || '—'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  behind: { flex: 1 },
  grip: { alignSelf: 'center', backgroundColor: INK.line, borderRadius: 3, height: 5, marginBottom: 6, width: 40 },
  list: { flexGrow: 0, height: ROW_HEIGHT * 9 },
  pressed: { opacity: 0.65 },
  row: {
    borderBottomColor: INK.line,
    borderBottomWidth: StyleSheet.hairlineWidth,
    height: ROW_HEIGHT,
    justifyContent: 'center',
  },
  rowCurrent: { backgroundColor: INK.page },
  rowHeading: { fontSize: 16, fontWeight: '700' },
  rowLabel: { color: INK.text, fontSize: 15, paddingHorizontal: 16 },
  rowLabelCurrent: { color: INK.reading, fontWeight: '700' },
  rowUnreachable: { color: INK.quiet },
  sheet: {
    backgroundColor: INK.panel,
    borderTopColor: INK.line,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
    paddingBottom: 32,
    paddingTop: 10,
  },
  title: { color: INK.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 16 },
});
