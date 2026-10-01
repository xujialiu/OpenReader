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
 * ## Every title in full, so rows are not one height
 *
 * A row is the drawer's plain-list row (`DrawerRow`, #117): straight on the
 * drawer, as Apple Books draws its contents, and as tall as its title, which
 * wraps in full rather than ending in an ellipsis. Shadow Slave's Chapter 139
 * takes five lines. So no row's height is known before it is laid out.
 *
 * ## Why a FlatList, opened at its row without `getItemLayout`
 *
 * The phone's own SwiftUI `List`, through `@expo/ui` 57, was tried first and
 * cannot do it (notes, 2026-10-01): `scrollPosition` moves a `ScrollView`'s
 * `LazyVStack` and not a `List`, which stayed at its first row whether the
 * row's id was given at the start or written later. The `LazyVStack` did open
 * at the row, but `@expo/ui` creates every row up front (its documentation
 * says so), and in 仙逆's 2,076 rows the drawer stood empty for 1.4 s before
 * its rows came. A FlatList draws only the rows in view.
 *
 * Given `initialScrollIndex` and no `getItemLayout`, the list draws the
 * current row and those after it first, measures them, and scrolls to the
 * current row (`VirtualizedList`'s `_maybeScrollToInitialScrollIndex`). The
 * rows before it are drawn later, as the owner scrolls up, at a height
 * estimated from the ones measured; `maintainVisibleContentPosition` keeps the
 * rows in view still when those estimates are corrected. A scroll asked for
 * before the row has been measured is reported to `onScrollToIndexFailed`,
 * which waits a frame and asks again.
 *
 * A sectioned list with sticky headers would have given the volumes a
 * different behaviour from the chapters for no gain; volumes are rows here,
 * like chapters, set in less far.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';

import { currentRow, type Contents, type ContentsRow } from '../core/document/contents';

import { INK } from './controls';
import { Drawer, DrawerFooter, DrawerRow, DrawerRowText } from './drawer';

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
 * On the phone's own sheet since #117 (ADR 0066): the rows are the drawer's
 * plain list, and what is said about them is the list's footer, under it,
 * where it stays in view however far the list is scrolled. A footer at the end
 * of 2,076 rows would never be read.
 */
export function ContentsSheet({ visible, onClose, contents, spineKnown, section, onGo }: ContentsSheetProps) {
  const here = useMemo(
    () => (section === null ? null : currentRow(contents, { sectionIndex: section })),
    [contents, section],
  );

  return (
    <Drawer visible={visible} title="Contents" onClose={onClose}>

        {contents.rows.length === 0 ? (
          <DrawerFooter>
            This book has no contents of its own. That is ordinary rather than a fault — some EPUBs carry none — and
            nothing else stops working: tapping a sentence still reads from there.
          </DrawerFooter>
        ) : (
          <ContentsList rows={contents.rows} current={here?.row ?? null} onGo={(target) => { onGo(target); onClose(); }} />
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

/**
 * The rows, opened at the current one. Its own component because the drawer
 * mounts it afresh at every opening, which is when it starts again from the
 * current row.
 */
function ContentsList({ rows, current, onGo }: { rows: readonly ContentsRow[]; current: number | null; onGo(target: number): void }) {
  // The first row drawn: the current one at first, then, once that has been
  // laid out at the top, the book's first.
  const [from, setFrom] = useState(() => current ?? 0);
  const shown = useMemo(() => rows.slice(from), [rows, from]);
  const list = useRef<FlatList<ContentsRow>>(null);
  const scrolled = useRef(false);
  const frame = useRef<number | null>(null);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  // Until the owner scrolls, the current row is put back at the top whenever
  // the rows drawn above it, or the drawer moving, may have shifted it: a
  // frame later, once the list has measured what changed.
  const anchor = () => {
    if (scrolled.current || from > 0 || current === null) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => list.current?.scrollToIndex({ index: current, animated: false }));
  };
  return (
    <FlatList
      ref={list}
      data={shown}
      style={styles.list}
      // The row's place in the whole list, so a row keeps its key when the rows above it arrive.
      keyExtractor={(_, index) => String(from + index)}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      onContentSizeChange={() => { if (from > 0) setFrom(0); else anchor(); }}
      onLayout={anchor}
      onScrollBeginDrag={() => { scrolled.current = true; }}
      // The current row is drawn by the time it is asked for; a row that is not yet is left where it is.
      onScrollToIndexFailed={() => {}}
      initialNumToRender={16}
      windowSize={7}
      renderItem={({ item, index }) => (
        <Row row={item} current={current === from + index} onPress={() => { if (item.target !== null) onGo(item.target); }} />
      )}
    />
  );
}

function Row({ row, current, onPress }: { row: ContentsRow; current: boolean; onPress(): void }) {
  const unreachable = row.target === null;
  return (
    // One level in per level of nesting. A book with volumes inside volumes sets
    // the inner ones in further, which is why this is arithmetic and not two styles.
    <DrawerRow onPress={onPress} disabled={unreachable} marked={current} level={row.depth}
      accessibilityState={{ selected: current, disabled: unreachable }}>
      <DrawerRowText emphasized={current || row.heading}
        style={[current && styles.current, unreachable && styles.unreachable]}>
        {row.label || '—'}
      </DrawerRowText>
    </DrawerRow>
  );
}

const styles = StyleSheet.create({
  // As tall as its rows, and no taller than the drawer leaves it, so the
  // footer sits under the last row of a short list.
  list: { flexGrow: 0, flexShrink: 1 },
  current: { color: INK.reading },
  unreachable: { color: INK.quiet },
});
