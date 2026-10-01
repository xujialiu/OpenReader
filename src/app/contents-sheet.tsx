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
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';

import { currentRow, type Contents, type ContentsRow } from '../core/document/contents';

import { INK } from './controls';
import { Drawer, DRAWER, DrawerCard, DrawerFooter, DrawerSeparator } from './drawer';
import { TEXT, TEXT_EMPHASIZED } from './text-styles';

/** One line per row, and the same height for every one of them: what makes the list open where it should. The drawer's row (#117). */
const ROW_HEIGHT = DRAWER.row.height;

export interface ContentsSheetProps {
  visible: boolean;
  onClose(): void;
  /**
   * The document's contents, flattened.
   *
   * Built by the screen rather than here, because the lock screen's second line
   * is the same answer (`src/now-playing/`'s `chapterOf`) and two flattenings of
   * one navigation would be two numberings to keep in step.
   */
  contents: Contents;
  /**
   * Whether the spine's hrefs have arrived from the document message.
   *
   * Its own flag rather than the hrefs themselves, because that is all this sheet
   * ever asked them: with no spine every row is unreachable, and "it has not
   * arrived yet" and "it does not match" are two different sentences to show.
   */
  spineKnown: boolean;
  /** The spine item the reading is in, or the one on the page when nothing is being read. Null when neither is known. */
  section: number | null;
  /** Go here: a spine index. The caller does the two steps (`use-reading.ts`'s `goToSection`). */
  onGo(section: number): void;
}

/**
 * On the phone's own sheet since #117 (ADR 0066): the rows are one
 * inset-grouped card that scrolls inside itself, and what is said about them is
 * the card's footer, under it, where it stays in view however far the list is
 * scrolled. A footer at the end of 2,076 rows would never be read.
 */
export function ContentsSheet({ visible, onClose, contents, spineKnown, section, onGo }: ContentsSheetProps) {
  const here = useMemo(
    () => (section === null ? null : currentRow(contents, { sectionIndex: section })),
    [contents, section],
  );
  const last = contents.rows.length - 1;

  return (
    <Drawer visible={visible} title="Contents" onClose={onClose}>

        {contents.rows.length === 0 ? (
          <DrawerFooter>
            This book has no contents of its own. That is ordinary rather than a fault — some EPUBs carry none — and
            nothing else stops working: tapping a sentence still reads from there.
          </DrawerFooter>
        ) : (
          <DrawerCard style={styles.card}>
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
                  separated={index < last}
                  onPress={() => {
                    if (item.target === null) return;
                    onGo(item.target);
                    onClose();
                  }}
                />
              )}
            />
          </DrawerCard>
        )}

        {contents.rows.length > 0 && contents.unreachable === contents.rows.length ? (
          <DrawerFooter attention>
            {!spineKnown
              ? 'The list of this book’s own files has not arrived yet, so no row can be opened. It arrives as the document installs.'
              : 'None of these rows names a file in this book. The contents live in a different folder from the pages, which this app matches by name — so the list can be read but not followed.'}
          </DrawerFooter>
        ) : null}

        {here && here.precision !== 'exact' ? <DrawerFooter>{precisionLine(here.precision)}</DrawerFooter> : null}
    </Drawer>
  );
}

/**
 * How exactly the marked row was pinned down, in the owner's words.
 *
 * Said out loud because ADR 0020 chose the coarse answer over the confident one:
 * where the contents cannot resolve finer than a file, the list marks the part
 * rather than guessing at the chapter, and a reader who is told nothing would read
 * the mark as exact.
 *
 * Which is why the exact case says nothing at all: there the mark *is* exact, so
 * a sentence saying so repeats what the owner is already looking at. Only the two
 * approximate cases carry something the mark cannot show, and the caller renders
 * no `Note` frame when there is no sentence to put in it.
 */
function precisionLine(precision: 'shared' | 'before'): string {
  if (precision === 'shared') {
    return 'Several rows share this file, so the marked one is the part being read rather than the chapter within it.';
  }
  return 'This page is not in the contents, so the nearest row before it is marked.';
}

function Row({ row, current, separated, onPress }: { row: ContentsRow; current: boolean; separated: boolean; onPress(): void }) {
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
          row.depth > 0 ? { paddingLeft: DRAWER.row.inset + row.depth * 16 } : null,
        ]}
        numberOfLines={1}
      >
        {row.label || '—'}
      </Text>
      {separated ? <DrawerSeparator /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The card is as tall as its rows, and no taller than the drawer leaves it;
  // the list inside shrinks with it and scrolls.
  card: { flexShrink: 1 },
  list: { flexGrow: 0, flexShrink: 1 },
  pressed: { opacity: 0.65 },
  row: { height: ROW_HEIGHT, justifyContent: 'center' },
  // The line colour, where the old drawer took the page's: on a card, the
  // drawer's own grey read as a hole in it.
  rowCurrent: { backgroundColor: INK.line },
  rowHeading: TEXT.headline,
  rowLabel: { ...TEXT.body, color: INK.text, paddingHorizontal: DRAWER.row.inset },
  rowLabelCurrent: { color: INK.reading, fontWeight: TEXT_EMPHASIZED.body.fontWeight },
  rowUnreachable: { color: INK.quiet },
});
