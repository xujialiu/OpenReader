/** The Library's current Folder: immediate child folders, then Documents in their existing recency order (#121). */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { asDocumentId, type LibraryEntry } from '../core/document';
import { childFolders, folderAt, folderSubtree, type Folder, type FolderId } from '../core/folders';
import { DocumentRow, FolderRow, HeaderButton, INK, Note } from './controls';
import { pickDocument } from './document';
import { useDocumentCover } from './document-cover';
import { AddDrawer, confirmFolderDeletion, FolderActions } from './folder-actions';
import { importDocument } from './import-document';
import { documentFile } from './library';
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
      title: currentFolder?.name ?? 'Library',
      headerLeft: () => currentFolder
        ? <HeaderButton icon="previous" label="Back to parent folder" onPress={() => visit(currentFolder.parent)} disabled={busy} />
        : <HeaderButton icon="settings" label="Settings" onPress={() => navigation.navigate('Settings')} />,
      headerRight: () => <HeaderButton icon="plus" label={picking ? 'Adding…' : 'Add'} onPress={() => {
        importLocation.current = library.folders.getSnapshot().tree.current;
        setAdding(true);
      }} disabled={picking || busy || library.loading || !!problem} />,
    });
  }, [navigation, currentFolder, visit, picking, busy, library, problem]);

  const present = useMemo(() => {
    const found = new Set<string>();
    for (const entry of library.entries) {
      try { if (documentFile(entry.id, entry.format).exists) found.add(entry.id); }
      catch { /* Unreadable stays visible with a failure rather than silently disappearing. */ }
    }
    return found;
  }, [library.entries]);
  const rows: Row[] = [
    ...childFolders(tree, tree.current).map((folder): Row => ({ kind: 'folder', folder })),
    ...library.entries.filter((entry) => (tree.documents[entry.id] ?? null) === tree.current).map((entry): Row => ({ kind: 'document', entry })),
  ];
  return <View style={styles.screen}>
    <FlatList<Row>
      key={tree.current ?? 'root'}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: held ? READING_BUTTON_ROOM : 12 }}
      data={rows}
      keyExtractor={(row) => row.kind === 'folder' ? `folder:${row.folder.id}` : row.entry.id}
      renderItem={({ item }) => item.kind === 'folder'
        ? <FolderRow title={item.folder.name} disabled={busy} onPress={() => visit(item.folder.id)} onActions={() => setFolderActions(item.folder.id)} />
        : <LibraryDocument entry={item.entry} present={present.has(item.entry.id)} disabled={busy}
          onPress={() => navigation.navigate('Reader', { id: item.entry.id })} onActions={() => setActions(item.entry)} />}
      ListHeaderComponent={problem || library.note || busy ? <View style={styles.banner}>
        {problem ? <Note attention>{problem}</Note> : null}
        {library.note ? <Note attention>{library.note}</Note> : null}
        {busy ? <Note>Deleting folder…</Note> : null}
      </View> : null}
      ListEmptyComponent={library.loading ? null : <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{currentFolder ? 'No documents or folders yet' : 'Library is empty'}</Text>
        {settings.enabledProviders.length === 0 ? <Note attention>{NO_PROVIDER_SENTENCE}</Note> : null}
      </View>}
    />
    {held ? <View style={styles.reading} pointerEvents="box-none">
      <ReadingButton playing={held.playing} buffering={held.buffering} label="Return to the reading"
        onPress={() => navigation.navigate('Reader', { id: held.id })} />
    </View> : null}
    <AddDrawer visible={adding} onClose={() => setAdding(false)} onImport={() => void add()} />
    {actions ? <ReaderActions document={actions.id} movable onClose={() => setActions(null)} onDelete={() => remove(actions)} /> : null}
    {folderActions ? <FolderActions id={folderActions} onClose={() => setFolderActions(null)} onDelete={removeFolder} /> : null}
  </View>;
}
function LibraryDocument({ entry, present, onPress, onActions, disabled }: { entry: LibraryEntry; present: boolean; onPress(): void; onActions(): void; disabled?: boolean }) {
  const cover = useDocumentCover(entry);
  return <DocumentRow title={entry.title} progress={progressOf(entry, present)} cover={cover} onPress={onPress} onLongPress={onActions} onActions={onActions} disabled={disabled} />;
}
const READING_BUTTON_ROOM = READING_BUTTON_PLACE.bottom + 52 + 12;
const styles = StyleSheet.create({
  reading: { alignItems: 'flex-end', ...READING_BUTTON_PLACE },
  banner: { paddingHorizontal: 16, paddingTop: 12 },
  empty: { alignItems: 'flex-start', gap: 12, padding: 24 },
  emptyTitle: { ...TEXT_EMPHASIZED.title3, color: INK.text },
  screen: { backgroundColor: INK.page, flex: 1 },
});
