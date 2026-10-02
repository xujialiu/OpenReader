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
 * It opens at the current row in the two steps every long list in a drawer
 * takes (`DrawerList`), because its rows' heights are not known before they
 * are laid out.
 *
 * A sectioned list with sticky headers would have given the volumes a
 * different behaviour from the chapters for no gain; volumes are rows here,
 * like chapters, set in less far.
 */

import { useMemo } from 'react';
import { StyleSheet } from 'react-native';

import { currentRow, type Contents, type ContentsRow } from '../core/document/contents';

import { INK, useAccent } from './controls';
import { Drawer, DrawerFooter, DrawerList, DrawerRow, DrawerRowText } from './drawer';

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

  const unfollowable = contents.rows.length > 0 && contents.unreachable === contents.rows.length;
  const approximate = !!here && here.precision !== 'exact';
  // Something said under the list, which then stops above it rather than running on to the drawer's edge.
  const footer = unfollowable || approximate;

  return (
    <Drawer visible={visible} title="Contents" onClose={onClose}>

        {contents.rows.length === 0 ? (
          <DrawerFooter>
            This book has no contents of its own. That is ordinary rather than a fault — some EPUBs carry none — and
            nothing else stops working: tapping a sentence still reads from there.
          </DrawerFooter>
        ) : (
          // Mounted afresh at every opening of the drawer, which is when it opens again at the current row.
          <DrawerList data={contents.rows} openAt={here?.row ?? null} ends={!footer}
            // The row's place in the whole list.
            keyExtractor={(_, index) => String(index)}
            renderItem={({ item, index }) => (
              <Row row={item} current={index === here?.row} onPress={() => { if (item.target !== null) { onGo(item.target); onClose(); } }} />
            )} />
        )}

        {unfollowable ? (
          <DrawerFooter attention>
            {!spineKnown
              ? 'The list of this book’s own files has not arrived yet, so no row can be opened. It arrives as the document installs.'
              : 'None of these rows could be matched to a page in this book. The list can be read but not followed.'}
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

function Row({ row, current, onPress }: { row: ContentsRow; current: boolean; onPress(): void }) {
  const unreachable = row.target === null;
  const accent = useAccent();
  return (
    // One level in per level of nesting. A book with volumes inside volumes sets
    // the inner ones in further, which is why this is arithmetic and not two styles.
    <DrawerRow onPress={onPress} disabled={unreachable} marked={current} level={row.depth}
      accessibilityState={{ selected: current, disabled: unreachable }}>
      <DrawerRowText emphasized={current || row.heading}
        style={[current && { color: accent.onMark }, unreachable && styles.unreachable]}>
        {row.label || '—'}
      </DrawerRowText>
    </DrawerRow>
  );
}

const styles = StyleSheet.create({
  unreachable: { color: INK.quiet },
});
