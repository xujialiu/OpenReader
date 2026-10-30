/**
 * One page of the Library: the root, or one Folder pushed over the page of the
 * Folder it is in (#317). Immediate child folders, then Documents in their
 * existing recency order (#121).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { GestureDetector } from 'react-native-gesture-handler';

import { asDocumentId, type LibraryEntry } from '../core/document';
import { directFolderCounts, folderAt, folderPath, folderSubtree, targetKey, type FolderId, type LibraryTarget } from '../core/folders';
import { DocumentRow, FolderRow, HeaderButton, INK, Note, useAccent } from './controls';
import { pickDocument } from './document';
import { useDocumentCover } from './document-cover';
import { AddDrawer, confirmFolderDeletion, FolderActions, useMovePage } from './folder-actions';
import { Drawer } from './drawer';
import { useLibrarySelection } from './use-library-selection';
import { libraryQuery, libraryRows, type LibraryRow as Row } from './library-search';
import { useLibrarySearch } from './use-library-search';
import { LibrarySelectionAction } from './library-selection-actions';
import { useRowSweep } from './use-sweep';
import { importDocument } from './import-document';
import { documentFile } from './library';
import { folderSummary } from './library-row-layout';
import type { ScreenProps } from './routes';
import { useShell } from './routes';
import { NO_PROVIDER_SENTENCE } from './settings';
import { ReaderActions } from './reader-actions';
import { READING_BUTTON_PLACE, ReadingButton } from './reading-button';
import { useHeldReading } from './reading-host';
import { TEXT_EMPHASIZED } from './text-styles';
import { LAYOUT_WIDTH } from './layout-widths';
import { formatBytes, occupied, removeDownloads, requestInventory } from '../offline/runtime';

const QUOTATION = 90;
function progressOf(entry: LibraryEntry, present: boolean): string {
  if (!present) return 'The file for this book is not on this device any more. The place it was left is kept; add the book again to read it.';
  if (!entry.position) return 'Not started.';
  const quoted = entry.position.anchor.exact.trim().replace(/\s+/g, ' ');
  return `Last read: “${quoted.length > QUOTATION ? `${quoted.slice(0, QUOTATION)}…` : quoted}”`;
}

export function LibraryScreen({ navigation, route }: ScreenProps<'Library' | 'Folder'>) {
  const { settings, library, sync } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  /** The Folder this page shows, for as long as the page is open; `null` is the Library root. */
  const folder = route.params?.id ?? null;
  const insets = useSafeAreaInsets();
  const accent = useAccent();
  const focused = useIsFocused();
  const [actionHeight, setActionHeight] = useState(52);
  const actionBottom = Math.max(insets.bottom, 12);
  const reading = useHeldReading();
  const held = reading.current;
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [actions, setActions] = useState<LibraryEntry | null>(null);
  const [folderActions, setFolderActions] = useState<FolderId | null>(null);
  const importLocation = useRef<FolderId | null>(null);
  /**
   * `null` at the root, and for the moment between a drawer left over this
   * page deleting its Folder and the shell taking the page away
   * (`reconcileFolderStack`): the page then shows nothing, under the name it
   * had, rather than throwing.
   */
  const currentFolder = folder === null ? null : tree.folders.find((one) => one.id === folder) ?? null;
  const reportDeletion = (error: unknown) => library.report(error instanceof Error ? error.message : String(error), 'delete');

  const removeDocument = async (id: string) => {
    const document = asDocumentId(id);
    if (!document) throw new Error('Invalid document identity.');
    reading.end(document);
    await removeDownloads(document);
    library.remove(document);
  };
  const browsingRows = libraryRows(tree, library.entries, folder, '');
  const selection = useLibrarySelection(navigation, browsingRows.map(rowTarget), removeDocument);
  const move = useMovePage({ targets: selection.selected, from: folder }, { onMoved: selection.moved });
  const selectionRef = useRef(selection);
  useLayoutEffect(() => { selectionRef.current = selection; }, [selection]);
  const selecting = selection.active;
  const selectedCount = selection.selected.length;
  const working = selection.working;
  const search = useLibrarySearch(navigation, route.key, selecting, { tintColor: accent.reading, textColor: INK.text });
  const searching = !!libraryQuery(search.query);
  const rows = searching ? libraryRows(tree, library.entries, folder, search.query) : browsingRows;
  const selectedKeys = new Set(selection.selected.map(targetKey));
  const selectionLocked = busy || selection.working || selection.moving || selection.confirming;
  const sweepIds = rows.map((row) => targetKey(rowTarget(row)));
  const sweep = useRowSweep<Row>({
    ids: sweepIds, values: sweepIds.map((id) => [id]), selected: selectedKeys,
    enabled: focused && !search.active && !selectionLocked && !adding && !actions && !folderActions && !picking && !library.loading && !problem,
    scope: folder ?? 'root', bottomInset: actionBottom + actionHeight + 12,
  }, selection.sweepTo);
  const remove = (entry: LibraryEntry) => {
    void requestInventory(entry.id).then(() => Alert.alert('Delete this book?',
      `Local downloaded audio will also be deleted, freeing ${formatBytes(occupied(entry.id))}. The original file is kept.`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
          setActions(null);
          const complete = library.beginOperation('delete');
          void removeDocument(entry.id).then(complete).catch(reportDeletion);
        } },
      ]), reportDeletion);
  };
  const removeFolder = (id: FolderId) => {
    const snapshot = library.folders.getSnapshot().tree;
    const subtree = folderSubtree(snapshot, id);
    const documents = library.entries.filter((entry) => subtree.has(snapshot.documents[entry.id]));
    confirmFolderDeletion(folderAt(snapshot, id).name, subtree.size - 1, documents.length, () => {
      if (library.folders.getSnapshot().tree !== snapshot) {
        library.report('The folder contents changed. Review them and confirm deletion again.', 'delete');
        return;
      }
      setFolderActions(null);
      const complete = library.beginOperation('delete');
      void library.folders.deleteTree(id, documents.map((entry) => entry.id), removeDocument)
        .then(complete)
        .catch((error: unknown) => library.report(`The folder could not be completely deleted. Remaining contents have been kept. ${error instanceof Error ? error.message : String(error)}`, 'delete'));
    });
  };

  const add = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await pickDocument();
      if (!picked) return;
      const sourceName = picked.name;
      try {
        await importDocument(library, picked, { move: true, folder: importLocation.current }, (id) => {
          sync.poke('add');
          navigation.navigate('Reader', { id });
        });
      } catch (refused) {
        library.report(`“${sourceName}” was not added: ${refused instanceof Error ? refused.message : String(refused)}`, 'import');
      }
    } catch (error) {
      library.report(error instanceof Error ? error.message : String(error), 'import');
    } finally { setPicking(false); }
  }, [library, navigation, sync]);

  /**
   * The Folder being browsed is the focused page's (#317), remembered for a
   * relaunch and for a Document arriving from another app (design 0069). Not
   * while a deletion holds the store: the page can be left during one, and the
   * place is written once it ends.
   */
  const shown = folder === null || currentFolder !== null;
  const browsed = tree.current;
  useEffect(() => {
    if (!focused || busy || problem || !shown || browsed === folder) return;
    const complete = library.beginOperation('visit');
    try { library.folders.visit(folder); complete(); }
    catch (error) { library.report(error instanceof Error ? error.message : String(error), 'visit'); }
  }, [focused, busy, problem, shown, browsed, folder, library]);
  const title = selecting ? `${selectedCount} selected` : folder === null ? 'Library' : currentFolder?.name;
  useLayoutEffect(() => {
    navigation.setOptions({
      ...(title === undefined ? {} : { title }),
      // Select all stands where the back arrow was, so leaving waits for Cancel, as in Files.
      gestureEnabled: !selecting,
      // Native bar items size their own labels at accessibility text sizes; custom RN text can outgrow UIKit's bar.
      unstable_headerLeftItems: selecting ? () => [{ type: 'button',
        label: selectedCount === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all',
        onPress: () => selectionRef.current.selectAll(), disabled: selectionLocked || !rows.length, tintColor: INK.text,
      }] : undefined,
      unstable_headerRightItems: selecting ? () => [{ type: 'button', label: 'Cancel',
        onPress: () => selectionRef.current.cancel(), disabled: selectionLocked, tintColor: INK.text,
      }] : undefined,
      headerLeft: () => selecting
        ? <HeaderButton label={selectedCount === rows.length && rows.length > 0 ? 'Deselect all' : 'Select all'} onPress={() => selectionRef.current.selectAll()} disabled={selectionLocked || !rows.length} />
        // Inside a Folder the phone's own back arrow, which goes back as the swipe does (#317).
        : folder !== null ? undefined
        : <HeaderButton icon="settings" label="Settings" onPress={() => navigation.navigate('Settings')} />,
      headerRight: () => selecting
        ? <HeaderButton label="Cancel" onPress={() => selectionRef.current.cancel()} disabled={selectionLocked} />
        : <HeaderButton icon="more" label={picking ? 'Adding…' : 'Library actions'} onPress={() => {
        importLocation.current = folder;
        setAdding(true);
      }} disabled={picking || busy || working || library.loading || !!problem} />,
    });
  }, [navigation, folder, title, picking, busy, library, problem, selecting, selectedCount, working, selectionLocked, rows.length]);

  const present = useMemo(() => {
    const found = new Set<string>();
    for (const entry of library.entries) {
      try { if (documentFile(entry.id, entry.format).exists) found.add(entry.id); }
      catch { /* Unreadable stays visible with a failure rather than silently disappearing. */ }
    }
    return found;
  }, [library.entries]);
  const counts = useMemo(() => directFolderCounts(tree, library.entries.map((entry) => entry.id)), [tree, library.entries]);
  return <View style={styles.screen}>
    <GestureDetector gesture={sweep.gesture}>
    <View style={[styles.list, styles.column]} collapsable={false}>
    <GestureDetector gesture={sweep.nativeGesture}>
    <FlatList<Row>
      {...sweep.list}
      ref={(node) => { sweep.list.ref(node); search.attachList(node); }}
      onScroll={(event) => { sweep.list.onScroll(event); search.onScroll(event); }}
      onScrollBeginDrag={search.onScrollBeginDrag}
      onContentSizeChange={(width, height) => { sweep.list.onContentSizeChange(width, height); search.onContentSizeChange(); }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      style={styles.list}
      contentContainerStyle={{ flexGrow: 1, paddingTop: 12, paddingBottom: (held ? READING_BUTTON_ROOM : 12) + (selection.active ? actionBottom + actionHeight + 12 : 0) }}
      data={rows}
      keyExtractor={(row) => targetKey(rowTarget(row))}
      renderItem={({ item }) => item.kind === 'folder'
        ? <FolderRow title={item.folder.name} summary={folderSummary(counts.get(item.folder.id)?.documents ?? 0, counts.get(item.folder.id)?.folders ?? 0)} disabled={selectionLocked} selected={selection.active ? selectedKeys.has(targetKey(rowTarget(item))) : undefined}
          onPress={() => selection.active ? selection.toggle(rowTarget(item)) : navigation.push('Folder', { id: item.folder.id })} onActions={() => setFolderActions(item.folder.id)} />
        : <LibraryDocument entry={item.entry} present={present.has(item.entry.id)} disabled={selectionLocked}
          path={searching ? folderPath(tree, tree.documents[item.entry.id] ?? null) : undefined}
          selected={selection.active ? selectedKeys.has(targetKey(rowTarget(item))) : undefined}
          onPress={() => {
            if (selection.active) selection.toggle(rowTarget(item));
            else { search.openingResult(item.entry.id); navigation.navigate('Reader', { id: item.entry.id }); }
          }} onActions={() => setActions(item.entry)} />}
      ListHeaderComponent={problem || library.note || busy ? <View style={styles.banner}>
        {problem ? <Note attention>{problem}</Note> : null}
        {library.note ? <View style={styles.message}>
          <View style={styles.messageText}><Note attention>{library.note}</Note></View>
          {library.dismissNote ? <HeaderButton icon="close" label="Dismiss Library message" onPress={library.dismissNote} /> : null}
        </View> : null}
        {busy && !selection.working ? <Note>Deleting folder…</Note> : null}
      </View> : null}
      ListEmptyComponent={library.loading ? null : <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{searching ? 'No documents found' : folder !== null ? 'No documents or folders yet' : 'Library is empty'}</Text>
        {!searching && settings.enabledProviders.length === 0 ? <Note attention>{NO_PROVIDER_SENTENCE}</Note> : null}
      </View>}
    />
    </GestureDetector>
    </View>
    </GestureDetector>
    {selection.active ? <View pointerEvents="box-none" style={[styles.selectionActions, { bottom: actionBottom }]}
      onLayout={(event) => setActionHeight(event.nativeEvent.layout.height)}>
      <LibrarySelectionAction action="Move" disabled={!selection.selected.length || selectionLocked || !!problem} onPress={() => { move.restart(); selection.openMove(); }} />
      <LibrarySelectionAction action="Delete" disabled={!selection.selected.length || selectionLocked || !!problem} working={selection.working} onPress={selection.deleteSelected} />
    </View> : null}
    {held ? <View style={[styles.reading, selection.active && { bottom: actionBottom + actionHeight + 12 }]} pointerEvents="box-none">
      <ReadingButton playing={held.playing} buffering={held.buffering} label="Return to the reading"
        onPress={() => navigation.navigate('Reader', { id: held.id })} />
    </View> : null}
    <AddDrawer visible={adding} folder={folder} onClose={() => setAdding(false)} onImport={() => void add()}
      onSearch={search.start} onSelect={search.active ? undefined : selection.begin} />
    <Drawer visible={selection.moving} {...move.header} onClose={selection.closeMove}>
      {selection.moving ? move.body : null}
    </Drawer>
    {actions ? <ReaderActions document={actions.id} movable onClose={() => setActions(null)} onDelete={() => remove(actions)}
      onSelect={search.active ? undefined : () => { setActions(null); selection.begin({ kind: 'document', id: actions.id }); }} /> : null}
    {folderActions ? <FolderActions id={folderActions} onClose={() => setFolderActions(null)} onDelete={removeFolder}
      onSelect={search.active ? undefined : (id) => { setFolderActions(null); selection.begin({ kind: 'folder', id }); }} /> : null}
  </View>;
}
function rowTarget(row: Row): LibraryTarget { return { kind: row.kind, id: row.kind === 'folder' ? row.folder.id : row.entry.id }; }
function LibraryDocument({ entry, present, path, onPress, onActions, disabled, selected }: { entry: LibraryEntry; present: boolean; path?: string; onPress(): void; onActions(): void; disabled?: boolean; selected?: boolean }) {
  const cover = useDocumentCover(entry);
  const progress = path === undefined ? progressOf(entry, present) : present ? path : `${path} · File not on this device`;
  return <DocumentRow title={entry.title} progress={progress} cover={cover} onPress={onPress} onLongPress={onActions} onActions={onActions} disabled={disabled} selected={selected} />;
}
const READING_BUTTON_ROOM = READING_BUTTON_PLACE.bottom + 52 + 12;
const styles = StyleSheet.create({
  list: { flex: 1 },
  column: { width: '100%', maxWidth: LAYOUT_WIDTH.library, alignSelf: 'center' },
  selectionActions: { position: 'absolute', width: '100%', maxWidth: LAYOUT_WIDTH.library, alignSelf: 'center', paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reading: { alignItems: 'flex-end', ...READING_BUTTON_PLACE },
  banner: { paddingHorizontal: 16, paddingTop: 12 },
  message: { flexDirection: 'row', alignItems: 'flex-start' },
  messageText: { flex: 1 },
  empty: { alignItems: 'flex-start', gap: 12, padding: 24 },
  emptyTitle: { ...TEXT_EMPHASIZED.title3, color: INK.text },
  screen: { backgroundColor: INK.page, flex: 1 },
});
