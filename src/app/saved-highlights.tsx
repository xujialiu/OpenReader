import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { currentRow, type Contents } from '../core/document/contents';
import { HIGHLIGHT_PALETTE, type HighlightColour, type SavedHighlight } from '../core/document/saved-highlight';
import type { ReaderBridge } from '../renderer/reader-bridge';
import { INK, useBorders } from './controls';
import { Drawer, DrawerFooter, DrawerList, DrawerRow } from './drawer';
import { Icon } from './icon';
import { colourHighlight, moveHighlight, readHighlights, removeHighlights, restoreHighlight, saveHighlight } from './saved-highlight-store';
import { TEXT } from './text-styles';
import type { LookupHandle } from './use-lookup';
import { useRowSweep } from './use-sweep';

function Action({ label, onPress, destructive }: { label: string; onPress(): void; destructive?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}>
    <Text style={[styles.label, destructive && { color: INK.attention }]}>{label}</Text>
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
    Alert.alert(`Remove ${batch.length} highlight${batch.length === 1 ? '' : 's'}?`, undefined, [
      { text: 'Cancel', style: 'cancel', onPress: () => setConfirming(false) },
      { text: 'Remove', style: 'destructive', onPress: () => {
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
  return <Drawer visible title="Highlights" onClose={close}
    action={{ label: selected ? 'Cancel' : 'Select', disabled: !marks.length, onPress: () => select(selected ? null : new Set()) }}>
    {selected ? <Action label={selected.size === marks.length ? 'Deselect all' : 'Select all'}
      onPress={() => select(selected.size === marks.length ? new Set() : new Set(ids))} /> : null}
    <GestureDetector gesture={sweep.gesture}>
      <DrawerList {...list} listRef={ref} data={marks} keyExtractor={(item) => String(item.id)}
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
    {selected ? <DrawerRow disabled={!selected.size} onPress={confirm}><Text style={styles.remove}>Remove ({selected.size})</Text></DrawerRow> : null}
    {undo}
    {overlay}
  </Drawer>;
}

export function SavedHighlights({ document, lookup, bridge, contents, anchors, listOpen, closeList, renderLookup }: {
  document: string; lookup: LookupHandle; bridge: ReaderBridge; contents: Contents;
  anchors: ReadonlyMap<number, ReadonlyMap<string, number>>; listOpen: boolean; closeList?(): void;
  renderLookup(onHighlight: () => void, highlightContent: ReactNode): ReactNode;
}) {
  const [marks, setMarks] = useState<SavedHighlight[]>([]);
  const [pen, setPen] = useState<{ id: number; owner: string } | null>(null);
  const surface = listOpen ? 'list' : lookup.selection?.location?.cfi;
  const palette = pen && pen.owner === surface ? pen.id : null;
  const setPalette = (id: number | null) => setPen(id !== null && surface ? { id, owner: surface } : null);
  // A dismissed Drawer cannot leave an invisible touch target on the page.
  if (pen && pen.owner !== surface) setPen(null);
  const [removed, setRemoved] = useState<SavedHighlight | null>(null);
  const { height } = useWindowDimensions();
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
  const finishPalette = () => {
    setPalette(null);
    if (!lookup.requested && lookup.selection) lookup.close();
  };
  const highlight = () => {
    if (!location || crossesChapter) return;

    change(() => setPalette(saveHighlight(document, location, chapter, chapterKey)));
  };
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
    if (!listOpen && !lookup.requested) lookup.close();
    return true;
  };
  const undo = removed ? <Action label="Undo remove" onPress={() => {
    if (change(() => restoreHighlight(document, removed))) setRemoved(null);
  }} /> : null;
  const actions = <View style={styles.card}>
    {active ? <ScrollView style={styles.previewBox}><Text style={styles.preview}>{active.text}</Text></ScrollView> : null}
    <View style={styles.actions}>
      {active ? <Action label="Recolour" onPress={() => setPalette(active.id)} /> : null}
      {location && !crossesChapter && (!active || (!exact && lookup.selection?.adjusted)) ?
        <Action label="Highlight" onPress={highlight} /> : null}
      {active ? <Action label="Remove" destructive onPress={() => remove([active.id], true)} /> : null}
      {!lookup.requested ? <>
        <Action label={lookup.selection?.mode === 'translation' ? 'Translate' : 'Look up'} onPress={lookup.request} />
        <Action label="Close" onPress={() => lookup.close()} />
      </> : null}
    </View>
    {crossesChapter ? <DrawerFooter>Select a passage within one chapter.</DrawerFooter> : null}
  </View>;
  const menuTop = location && location.top > 140 ? location.top - (active ? 110 : 58) : (location?.bottom ?? 90) + 12;
  const selectedColour = marks.find((mark) => mark.id === palette)?.colour;
  const colourPicker = palette !== null ? <View style={styles.overlay}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close colours" style={StyleSheet.absoluteFill} onPress={finishPalette} />
    <View style={!listOpen && !lookup.requested ?
      { position: 'absolute', top: Math.max(4, Math.min(height - 100, menuTop)) } : undefined}>
      <HighlightColours selected={selectedColour} choose={(colour) => {
        if (change(() => colourHighlight(document, palette, colour))) finishPalette();
      }} />
    </View>
  </View> : null;
  return <>
    {renderLookup(openHighlight, <ScrollView contentContainerStyle={styles.highlightTab}>
      {location && !crossesChapter ? <HighlightColours inline selected={edited?.colour} choose={chooseInlineColour} /> :
        <DrawerFooter>Select a passage within one chapter.</DrawerFooter>}
      <Text style={styles.passage}>{edit?.expandingTo ? edited?.text : location?.text ?? lookup.selection?.text}</Text>
    </ScrollView>)}
    {lookup.selection && !lookup.requested && !lookup.selection.selecting ?
      <View style={[styles.floating, { top: Math.max(4, Math.min(height - 150, menuTop)) }]}>
        {actions}
      </View> : null}
    {!listOpen && !lookup.requested && undo ? <View style={styles.undo}>{undo}</View> : null}
    {listOpen ? <HighlightsList marks={marks} close={() => closeList?.()} overlay={colourPicker} undo={undo} recolour={setPalette} remove={remove}
      browse={(mark) => { closeList?.(); bridge.browse(mark.section, '', mark.cfi); }} /> : null}
    {palette !== null && !listOpen && !lookup.requested ? colourPicker : null}
    {palette !== null && listOpen ? <Pressable accessibilityLabel="Close colours"
      accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={finishPalette} /> : null}
  </>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 16, alignItems: 'center' },
  check: { width: 21, height: 21, borderRadius: 11, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  excerpt: { minHeight: 48, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  words: { ...TEXT.body, color: INK.text, flexShrink: 1 },
  chapter: { ...TEXT.subhead, color: INK.quiet, paddingHorizontal: 16, paddingTop: 12 },
  action: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  label: { ...TEXT.body, color: INK.text }, remove: { ...TEXT.body, color: INK.attention },
  more: { width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  previewBox: { maxHeight: 72 },
  preview: { ...TEXT.footnote, color: INK.quiet, paddingHorizontal: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  card: { padding: 3 }, floating: { position: 'absolute', alignSelf: 'center', maxWidth: '95%', backgroundColor: INK.page, borderRadius: 16 },
  undo: { position: 'absolute', alignSelf: 'center', bottom: '30%', backgroundColor: INK.page, borderRadius: 12 },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  palette: { borderRadius: 32, backgroundColor: INK.panel, padding: 8, gap: 5, flexDirection: 'row' },
  highlightTab: { alignItems: 'center', padding: 12, gap: 16 },
  passage: { ...TEXT.body, color: INK.text, alignSelf: 'stretch', paddingHorizontal: 4 },
  colourTarget: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inlineSwatch: { width: 34, height: 34, borderRadius: 17 },
});
