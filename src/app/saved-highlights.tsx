import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { currentRow, type Contents } from '../core/document/contents';
import { HIGHLIGHT_PALETTE, type HighlightColour, type SavedHighlight } from '../core/document/saved-highlight';
import type { ReaderBridge } from '../renderer/reader-bridge';
import { INK, useBorders } from './controls';
import { Drawer, DrawerFooter, DrawerList } from './drawer';
import { Icon } from './icon';
import { SelectionButton } from './selection-button';
import { colourHighlight, moveHighlight, readHighlights, removeHighlights, restoreHighlight, saveHighlight } from './saved-highlight-store';
import { TEXT } from './text-styles';
import type { LookupHandle } from './use-lookup';
import { useRowSweep } from './use-sweep';

function Action({ label, onPress }: { label: string; onPress(): void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
    <Text style={styles.label}>{label}</Text>
  </Pressable>;
}

function HighlightColours({ selected, choose, inline = false }: {
  selected?: HighlightColour; choose(colour: HighlightColour): void; inline?: boolean;
}) {
  return <View style={styles.palette}>
    {(Object.keys(HIGHLIGHT_PALETTE) as HighlightColour[]).map((colour) => {
      const current = colour === selected;
      return <Pressable key={colour} accessibilityRole="button"
        accessibilityLabel={inline && current ? `Remove ${colour} highlight` : colour}
        accessibilityState={{ selected: current }} style={styles.colourTarget} onPress={() => choose(colour)}>
        <View style={[styles.swatch, inline && styles.inlineSwatch, { backgroundColor: HIGHLIGHT_PALETTE[colour] }]}>
          {current ? <Icon name={inline ? 'close' : 'check'} color="#191919" size={20} /> : null}
        </View>
      </Pressable>;
    })}
  </View>;
}

function HighlightsList({ marks, close, browse, recolour, remove, undo, overlay }: {
  marks: readonly SavedHighlight[]; close(): void; browse(mark: SavedHighlight): void; recolour(id: number): void;
  remove(ids: readonly number[], single: boolean): boolean; undo: ReactNode; overlay: ReactNode;
}) {
  const borders = useBorders();
  const [selected, select] = useState<Set<string> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const ids = marks.map((mark) => String(mark.id));
  const sweep = useRowSweep<SavedHighlight>({
    ids, values: ids.map((id) => [id]), selected: selected ?? new Set(), enabled: !confirming,
  }, select);
  const { ref, ...list } = sweep.list;
  const toggle = (id: string) => select((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const confirm = () => {
    if (!selected?.size) return;
    const batch = Array.from(selected, Number);
    setConfirming(true);
    Alert.alert(`Delete ${batch.length} highlight${batch.length === 1 ? '' : 's'}?`, undefined, [
      { text: 'Cancel', style: 'cancel', onPress: () => setConfirming(false) },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setConfirming(false);
        if (remove(batch, false)) select(null);
      } },
    ]);
  };
  const menu = (mark: SavedHighlight) => Alert.alert('Highlight', mark.text, [
    { text: 'Recolour', onPress: () => recolour(mark.id) },
    { text: 'Remove', style: 'destructive', onPress: () => remove([mark.id], true) },
    { text: 'Cancel', style: 'cancel' },
  ]);
  const allSelected = selected?.size === marks.length;
  return <Drawer visible title="Highlights" onClose={close} selectionFooter={!!selected}
    leadingAction={selected ? { label: allSelected ? 'Deselect all' : 'Select all',
      onPress: () => select(allSelected ? new Set() : new Set(ids)) } : undefined}
    action={{ label: selected ? 'Cancel' : 'Select', disabled: !marks.length, onPress: () => select(selected ? null : new Set()) }}>
    <GestureDetector gesture={sweep.gesture}>
      <DrawerList {...list} listRef={ref} data={marks} style={selected ? styles.selectionList : undefined} keyExtractor={(item) => String(item.id)}
        ListEmptyComponent={<DrawerFooter>No highlights.</DrawerFooter>}
        renderItem={({ item, index }) => {
          const checked = selected?.has(String(item.id));
          return <View>
            {(!index || item.chapterKey !== marks[index - 1].chapterKey) ?
              <Text accessibilityRole="header" style={styles.chapter}>{item.chapter}</Text> : null}
            <View style={styles.row}>
              <Pressable accessibilityRole={selected ? 'checkbox' : 'button'} accessibilityState={selected ? { checked } : undefined}
                style={styles.excerpt} onPress={sweep.guard(() => selected ? toggle(String(item.id)) : browse(item))}>
                {selected ? <View style={[styles.check, { borderColor: borders.line }]}>{checked ? <Icon name="check" color={INK.text} size={16} /> : null}</View> : null}
                <Text style={styles.words}><Text style={{ backgroundColor: HIGHLIGHT_PALETTE[item.colour] + '66' }}>{item.text}</Text></Text>
              </Pressable>
              {!selected ? <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${item.text}`} style={styles.more}
                onPress={() => menu(item)}><Icon name="more" size={21} color={INK.text} /></Pressable> : null}
            </View>
          </View>;
        }} />
    </GestureDetector>
    {undo}
    {selected ? <SelectionButton action="Delete" count={selected.size} onPress={confirm} /> : null}
    {overlay}
  </Drawer>;
}

export function SavedHighlights({ document, lookup, bridge, contents, anchors, listOpen, closeList, renderLookup }: {
  document: string; lookup: LookupHandle; bridge: ReaderBridge; contents: Contents;
  anchors: ReadonlyMap<number, ReadonlyMap<string, number>>; listOpen: boolean; closeList?(): void;
  renderLookup(onHighlight: () => void, highlightContent: ReactNode): ReactNode;
}) {
  const [marks, setMarks] = useState<SavedHighlight[]>([]);
  const [palette, setPalette] = useState<number | null>(null);
  if (!listOpen && palette !== null) setPalette(null);
  const [removed, setRemoved] = useState<SavedHighlight | null>(null);
  const refresh = useCallback(() => setMarks(readHighlights(document)), [document]);
  useEffect(() => {
    // Load this Document's durable marks after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { refresh(); } catch (error) { Alert.alert('Could not read highlights', String(error)); }
  }, [refresh]);
  const publish = bridge.setSavedHighlights;
  useEffect(() => { publish(marks); }, [marks, publish]);
  useEffect(() => {
    if (!removed) return;
    const timer = setTimeout(() => setRemoved(null), 6000);
    return () => clearTimeout(timer);
  }, [removed]);
  const location = lookup.selection?.location;
  const exact = location && marks.find((mark) => mark.cfi === location.cfi);
  const active = exact || (location && marks.find((mark) => mark.id === location.inside));
  const rowAt = (section: number, block: number) => currentRow(contents, { sectionIndex: section, block, anchors: anchors.get(section) })?.row;
  const first = location && rowAt(location.section, location.block);
  const crossesChapter = !!location && first !== rowAt(location.section, location.endBlock);
  const chapter = first === undefined ? `Section ${(location?.section ?? 0) + 1}` : contents.rows[first].label;
  const chapterKey = first === undefined ? `section-${location?.section}` : `chapter-${first}`;
  const edit = lookup.selection?.highlight;
  const edited = edit && marks.find((mark) => mark.id === edit.id);
  const selecting = lookup.selection?.selecting;
  const { highlightOnly, editHighlight } = lookup;
  const hasSelection = !!lookup.selection;
  useEffect(() => {
    if (!highlightOnly || !hasSelection || selecting || edit) return;
    // Enter the palette without writing. Existing passages take their full range.
    editHighlight(active?.id ?? null, active?.cfi);
  }, [highlightOnly, hasSelection, selecting, edit, active, editHighlight]);
  useEffect(() => {
    if (!edited || edit?.expandingTo || selecting || !location || crossesChapter || edited.cfi === location.cfi) return;
    try {
      moveHighlight(document, edited.id, location, chapter, chapterKey);
      // Publish the committed range and any merged entry to the list and page.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refresh();
    } catch (error) { Alert.alert('Could not change highlights', String(error)); }
  }, [edited, edit?.expandingTo, selecting, location, crossesChapter, document, chapter, chapterKey, refresh]);
  const change = (write: () => void) => {
    try { write(); refresh(); return true; }
    catch (error) { Alert.alert('Could not change highlights', String(error)); return false; }
  };
  const finishPalette = () => setPalette(null);
  const openHighlight = () => {
    if (active && !(lookup.selection?.adjusted && !exact)) {
      lookup.editHighlight(active.id, active.cfi);
    } else if (location && !crossesChapter) {
      change(() => lookup.editHighlight(saveHighlight(document, location, chapter, chapterKey)));
    } else {
      lookup.editHighlight(null);
    }
  };
  const chooseInlineColour = (colour: HighlightColour) => {
    if (!location || crossesChapter || selecting || edit?.expandingTo) return;
    if (!edited) {
      change(() => lookup.editHighlight(saveHighlight(document, location, chapter, chapterKey, colour)));
    } else if (edited.colour === colour) {
      change(() => { removeHighlights(document, [edited.id]); lookup.editHighlight(null); });
    } else {
      change(() => colourHighlight(document, edited.id, colour));
    }
  };
  const remove = (ids: readonly number[], single: boolean) => {
    const one = single ? marks.find((mark) => mark.id === ids[0]) : null;
    if (!change(() => removeHighlights(document, ids))) return false;
    setRemoved(one ?? null);
    return true;
  };
  const undo = removed ? <Action label="Undo remove" onPress={() => {
    if (change(() => restoreHighlight(document, removed))) setRemoved(null);
  }} /> : null;
  const selectedColour = marks.find((mark) => mark.id === palette)?.colour;
  const colourPicker = palette !== null ? <View style={styles.overlay}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close colours" style={StyleSheet.absoluteFill} onPress={finishPalette} />
    <HighlightColours selected={selectedColour} choose={(colour) => {
      if (change(() => colourHighlight(document, palette, colour))) finishPalette();
    }} />
  </View> : null;
  return <>
    {renderLookup(openHighlight, <ScrollView contentContainerStyle={styles.highlightTab}>
      {location && !crossesChapter ? <HighlightColours inline selected={edited?.colour} choose={chooseInlineColour} /> :
        <DrawerFooter>Select a passage within one chapter.</DrawerFooter>}
      <Text style={styles.passage}>{edit?.expandingTo ? edited?.text : lookup.selection?.text}</Text>
    </ScrollView>)}
    {listOpen ? <HighlightsList marks={marks} close={() => closeList?.()} overlay={colourPicker} undo={undo} recolour={setPalette} remove={remove}
      browse={(mark) => { closeList?.(); bridge.browse(mark.section, '', mark.cfi); }} /> : null}
    {palette !== null && listOpen ? <Pressable accessibilityLabel="Close colours"
      accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={finishPalette} /> : null}
  </>;
}

const styles = StyleSheet.create({
  selectionList: { flexGrow: 1 },
  row: { flexDirection: 'row', paddingHorizontal: 16, alignItems: 'center' },
  check: { width: 21, height: 21, borderRadius: 11, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  excerpt: { minHeight: 48, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  words: { ...TEXT.body, color: INK.text, flexShrink: 1 },
  chapter: { ...TEXT.subhead, color: INK.quiet, paddingHorizontal: 16, paddingTop: 12 },
  action: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  label: { ...TEXT.body, color: INK.text },
  more: { width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  palette: { borderRadius: 32, backgroundColor: INK.panel, padding: 8, gap: 5, flexDirection: 'row' },
  highlightTab: { alignItems: 'center', padding: 12, gap: 16 },
  passage: { ...TEXT.body, color: INK.text, alignSelf: 'stretch', paddingHorizontal: 4 },
  colourTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inlineSwatch: { width: 34, height: 34, borderRadius: 17 },
});
