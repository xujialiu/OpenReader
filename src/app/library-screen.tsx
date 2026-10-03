/** The Library's current Folder: immediate child folders, then Documents in their existing recency order (#121). */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { GestureDetector } from 'react-native-gesture-handler';

import { asDocumentId, type LibraryEntry } from '../core/document';
import { childFolders, directFolderCounts, folderAt, folderSubtree, targetKey, type Folder, type FolderId, type LibraryTarget } from '../core/folders';
import { DocumentRow, FolderRow, HeaderButton, INK, Note } from './controls';
import { pickDocument } from './document';
import { useDocumentCover } from './document-cover';
import { AddDrawer, confirmFolderDeletion, FolderActions, MoveContent } from './folder-actions';
import { Drawer } from './drawer';
import { useLibrarySelection } from './use-library-selection';
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
import { formatBytes, occupied, removeDownloads, requestInventory } from '../offline/runtime';

const QUOTATION = 90;
function progressOf(entry: LibraryEntry, present: boolean): string {
  if (!present) return 'The file for this book is not on this device any more. The place it was left is kept; add the book again to read it.';
  if (!entry.position) return 'Not started.';
  const quoted = entry.position.anchor.exact.trim().replace(/\s+/g, ' ');
  return `Last read: “${quoted.length > QUOTATION ? `${quoted.slice(0, QUOTATION)}…` : quoted}”`;
}
type Row = { kind: 'folder'; folder: Folder } | { kind: 'document'; entry: LibraryEntry };

export function LibraryScreen({ navigation }: ScreenProps<'Library'>) {
  const { settings, library, sync } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const insets = useSafeAreaInsets();
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
  const currentFolder = tree.current === null ? null : folderAt(tree, tree.current);
  const report = (error: unknown) => library.report(error instanceof Error ? error.message : String(error));

  const removeDocument = async (id: string) => {
    const document = asDocumentId(id);
    if (!document) throw new Error('Invalid document identity.');
    reading.end(document);
    await removeDownloads(document);
    library.remove(document);
  };
  const rows: Row[] = [
    ...childFolders(tree, tree.current).map((folder): Row => ({ kind: 'folder', folder })),
    ...library.entries.filter((entry) => (tree.documents[entry.id] ?? null) === tree.current).map((entry): Row => ({ kind: 'document', entry })),
  ];
  const selection = useLibrarySelection(navigation, rows.map(rowTarget), removeDocument);
  const selectionRef = useRef(selection);
  useLayoutEffect(() => { selectionRef.current = selection; }, [selection]);
  const selecting = selection.active;
  const selectedCount = selection.selected.length;
  const working = selection.working;
  const selectedKeys = new Set(selection.selected.map(targetKey));
  const selectionLocked = busy || selection.working || selection.moving || selection.confirming;
  const sweepIds = rows.map((row) => targetKey(rowTarget(row)));
  const sweep = useRowSweep<Row>({
    ids: sweepIds, values: sweepIds.map((id) => [id]), selected: selectedKeys,
    enabled: focused && !selectionLocked && !adding && !actions && !folderActions && !picking && !library.loading && !problem,
    scope: tree.current ?? 'root', bottomInset: actionBottom + actionHeight + 12,
  }, selection.sweepTo);
  const remove = (entry: LibraryEntry) => {
    void requestInventory(entry.id).then(() => Alert.alert('Delete this book?',
      `Local downloaded audio will also be deleted, freeing ${formatBytes(occupied(entry.id))}. The original file is kept.`, [
        { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => {
          setActions(null);
          void removeDocument(entry.id).catch(report);
        } },
      ]), report);
  };
  const removeFolder = (id: FolderId) => {
    const snapshot = library.folders.getSnapshot().tree;
    const subtree = folderSubtree(snapshot, id);
    const documents = library.entries.filter((entry) => subtree.has(snapshot.documents[entry.id]));
    confirmFolderDeletion(folderAt(snapshot, id).name, subtree.size - 1, documents.length, () => {
      if (library.folders.getSnapshot().tree !== snapshot) {
        library.report('The folder contents changed. Review them and confirm deletion again.');
        return;
      }
      setFolderActions(null);
      void library.folders.deleteTree(id, documents.map((entry) => entry.id), removeDocument)
        .catch((error: unknown) => library.report(`The folder could not be completely deleted. Remaining contents have been kept. ${error instanceof Error ? error.message : String(error)}`));
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
        library.report(`“${sourceName}” was not added: ${refused instanceof Error ? refused.message : String(refused)}`);
      }
    } catch (error) {
      library.report(error instanceof Error ? error.message : String(error));
    } finally { setPicking(false); }
  }, [library, navigation, sync]);

  const visit = useCallback((id: FolderId | null) => {
    try { library.folders.visit(id); }
    catch (error) { library.report(error instanceof Error ? error.message : String(error)); }
  }, [library]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: selecting ? `${selectedCount} selected` : currentFolder?.name ?? 'Library',
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
        : currentFolder
        ? <HeaderButton icon="previous" label="Back to parent folder" onPress={() => visit(currentFolder.parent)} disabled={busy} />
        : <HeaderButton icon="settings" label="Settings" onPress={() => navigation.navigate('Settings')} />,
      headerRight: () => selecting
        ? <HeaderButton label="Cancel" onPress={() => selectionRef.current.cancel()} disabled={selectionLocked} />
        : <HeaderButton icon="more" label={picking ? 'Adding…' : 'Library actions'} onPress={() => {
        importLocation.current = library.folders.getSnapshot().tree.current;
        setAdding(true);
      }} disabled={picking || busy || working || library.loading || !!problem} />,
    });
  }, [navigation, currentFolder, visit, picking, busy, library, problem, selecting, selectedCount, working, selectionLocked, rows.length]);

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
    <View style={styles.list} collapsable={false}>
    <GestureDetector gesture={sweep.nativeGesture}>
    <FlatList<Row>
      {...sweep.list}
      style={styles.list}
      key={tree.current ?? 'root'}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: (held ? READING_BUTTON_ROOM : 12) + (selection.active ? actionBottom + actionHeight + 12 : 0) }}
      data={rows}
      keyExtractor={(row) => targetKey(rowTarget(row))}
      renderItem={({ item }) => item.kind === 'folder'
        ? <FolderRow title={item.folder.name} summary={folderSummary(counts.get(item.folder.id)?.documents ?? 0, counts.get(item.folder.id)?.folders ?? 0)} disabled={selectionLocked} selected={selection.active ? selectedKeys.has(targetKey(rowTarget(item))) : undefined}
          onPress={() => selection.active ? selection.toggle(rowTarget(item)) : visit(item.folder.id)} onActions={() => setFolderActions(item.folder.id)} />
        : <LibraryDocument entry={item.entry} present={present.has(item.entry.id)} disabled={selectionLocked}
          selected={selection.active ? selectedKeys.has(targetKey(rowTarget(item))) : undefined}
          onPress={() => selection.active ? selection.toggle(rowTarget(item)) : navigation.navigate('Reader', { id: item.entry.id })} onActions={() => setActions(item.entry)} />}
      ListHeaderComponent={problem || library.note || busy ? <View style={styles.banner}>
        {problem ? <Note attention>{problem}</Note> : null}
        {library.note ? <Note attention>{library.note}</Note> : null}
        {busy && !selection.working ? <Note>Deleting folder…</Note> : null}
      </View> : null}
      ListEmptyComponent={library.loading ? null : <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{currentFolder ? 'No documents or folders yet' : 'Library is empty'}</Text>
        {settings.enabledProviders.length === 0 ? <Note attention>{NO_PROVIDER_SENTENCE}</Note> : null}
      </View>}
    />
    </GestureDetector>
    </View>
    </GestureDetector>
    {selection.active ? <View pointerEvents="box-none" style={[styles.selectionActions, { bottom: actionBottom }]}
      onLayout={(event) => setActionHeight(event.nativeEvent.layout.height)}>
      <LibrarySelectionAction action="Move" disabled={!selection.selected.length || selectionLocked || !!problem} onPress={selection.openMove} />
      <LibrarySelectionAction action="Delete" disabled={!selection.selected.length || selectionLocked || !!problem} working={selection.working} onPress={selection.deleteSelected} />
    </View> : null}
    {held ? <View style={[styles.reading, selection.active && { bottom: actionBottom + actionHeight + 12 }]} pointerEvents="box-none">
      <ReadingButton playing={held.playing} buffering={held.buffering} label="Return to the reading"
        onPress={() => navigation.navigate('Reader', { id: held.id })} />
    </View> : null}
    <AddDrawer visible={adding} onClose={() => setAdding(false)} onImport={() => void add()} onSelect={selection.begin} />
    <Drawer visible={selection.moving} title="Move to…" onClose={selection.closeMove}>
      {selection.moving ? <MoveContent targets={selection.selected} onMoved={selection.moved} /> : null}
    </Drawer>
    {actions ? <ReaderActions document={actions.id} movable onClose={() => setActions(null)} onDelete={() => remove(actions)} /> : null}
    {folderActions ? <FolderActions id={folderActions} onClose={() => setFolderActions(null)} onDelete={removeFolder} /> : null}
  </View>;
}
function rowTarget(row: Row): LibraryTarget { return { kind: row.kind, id: row.kind === 'folder' ? row.folder.id : row.entry.id }; }
function LibraryDocument({ entry, present, onPress, onActions, disabled, selected }: { entry: LibraryEntry; present: boolean; onPress(): void; onActions(): void; disabled?: boolean; selected?: boolean }) {
  const cover = useDocumentCover(entry);
  return <DocumentRow title={entry.title} progress={progressOf(entry, present)} cover={cover} onPress={onPress} onLongPress={onActions} onActions={onActions} disabled={disabled} selected={selected} />;
}
const READING_BUTTON_ROOM = READING_BUTTON_PLACE.bottom + 52 + 12;
const styles = StyleSheet.create({
  list: { flex: 1 },
  selectionActions: { position: 'absolute', left: 22, right: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reading: { alignItems: 'flex-end', ...READING_BUTTON_PLACE },
  banner: { paddingHorizontal: 16, paddingTop: 12 },
  empty: { alignItems: 'flex-start', gap: 12, padding: 24 },
  emptyTitle: { ...TEXT_EMPHASIZED.title3, color: INK.text },
  screen: { backgroundColor: INK.page, flex: 1 },
});
