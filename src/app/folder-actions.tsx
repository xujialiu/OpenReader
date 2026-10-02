import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import type { DocumentId } from '../core/document';
import { childFolders, folderAt, folderNameProblem, folderPath, folderSubtree, type FolderId } from '../core/folders';
import { INK } from './controls';
import { Drawer, DrawerChevron, DrawerFooter, DrawerRow, DrawerRowText, DrawerScroll } from './drawer';
import { RenameAlert } from './rename-alert';
import { useShell } from './routes';

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Kept mounted until the native dismissal finishes before handing over to Files. */
export function AddDrawer({ visible, onClose, onImport }: { visible: boolean; onClose(): void; onImport(): void }) {
  const { library } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const [naming, setNaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const importing = useRef(false);
  const parent = useRef<FolderId | null>(null);
  return <Drawer visible={visible} title="Add" onClose={onClose} onDismiss={() => {
    setNaming(false); setFailure(null);
    if (importing.current) { importing.current = false; onImport(); }
  }}>
    <DrawerScroll>
      <DrawerRow icon="folder" disabled={busy || !!problem} onPress={() => { parent.current = tree.current; setNaming(true); }}>
        <DrawerRowText>Create folder</DrawerRowText>
      </DrawerRow>
      <DrawerRow icon="plus" disabled={busy || !!problem} onPress={() => { importing.current = true; onClose(); }}>
        <DrawerRowText>Import file</DrawerRowText>
      </DrawerRow>
      {failure ? <DrawerFooter attention>{failure}</DrawerFooter> : null}
    </DrawerScroll>
    {naming ? <RenameAlert name="" title="Create folder" saveLabel="Create" onCancel={() => setNaming(false)}
      validate={(name) => folderNameProblem(tree, name, parent.current)} onSave={(name) => {
        setNaming(false);
        try { library.folders.create(name, parent.current); onClose(); }
        catch (error) { setFailure(describe(error)); }
      }} /> : null}
  </Drawer>;
}

export type MoveTarget = { kind: 'folder'; id: FolderId } | { kind: 'document'; id: DocumentId };
/** Shared by Document and Folder action drawers; exploring a destination never changes the browsing location. */
export function MoveContent({ target, onMoved }: { target: MoveTarget; onMoved(): void }) {
  const { library } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const source = target.kind === 'folder' ? folderAt(tree, target.id).parent : tree.documents[target.id] ?? null;
  const [destination, setDestination] = useState<FolderId | null>(source);
  const [failure, setFailure] = useState<string | null>(null);
  const current = destination !== null && !tree.folders.some((folder) => folder.id === destination) ? null : destination;
  const forbidden = target.kind === 'folder' ? folderSubtree(tree, target.id) : new Set<FolderId>();
  const parent = current === null ? null : folderAt(tree, current).parent;
  return <DrawerScroll>
    <DrawerFooter>{folderPath(tree, current)}</DrawerFooter>
    {current !== null ? <DrawerRow icon="previous" onPress={() => { setDestination(parent); setFailure(null); }}>
      <DrawerRowText>{parent === null ? 'Library' : folderAt(tree, parent).name}</DrawerRowText>
    </DrawerRow> : null}
    <DrawerRow icon="check" disabled={current === source || busy || !!problem || (current !== null && forbidden.has(current))} onPress={() => {
      try {
        if (target.kind === 'folder') library.folders.moveFolder(target.id, current);
        else {
          if (!library.current(target.id)) throw new Error('That document is no longer in the Library.');
          library.folders.place(target.id, current);
        }
        onMoved();
      } catch (error) { setFailure(describe(error)); }
    }}><DrawerRowText>Move here</DrawerRowText></DrawerRow>
    {childFolders(tree, current).filter((folder) => !forbidden.has(folder.id)).map((folder) =>
      <DrawerRow key={folder.id} icon="folder" accessory={<DrawerChevron />} onPress={() => { setDestination(folder.id); setFailure(null); }}>
        <DrawerRowText>{folder.name}</DrawerRowText>
      </DrawerRow>)}
    {failure ? <DrawerFooter attention>{failure}</DrawerFooter> : null}
  </DrawerScroll>;
}

export function FolderActions({ id, onClose, onDelete }: { id: FolderId; onClose(): void; onDelete(id: FolderId): void }) {
  const { library } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const folder = tree.folders.find((one) => one.id === id);
  const [moving, setMoving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!folder) return null;
  return <Drawer visible title={moving ? 'Move to…' : folder.name} onClose={onClose} onBack={moving ? () => setMoving(false) : undefined}>
    {moving ? <MoveContent target={{ kind: 'folder', id }} onMoved={onClose} /> : <DrawerScroll>
      <DrawerRow icon="rename" disabled={busy || !!problem} onPress={() => setNaming(true)}><DrawerRowText>Rename</DrawerRowText></DrawerRow>
      <DrawerRow icon="folder" disabled={busy || !!problem} onPress={() => setMoving(true)} accessory={<DrawerChevron />}><DrawerRowText>Move to…</DrawerRowText></DrawerRow>
      <DrawerRow icon="trash" iconColour={INK.attention} disabled={busy || !!problem} onPress={() => onDelete(id)}>
        <DrawerRowText style={{ color: INK.attention }}>Delete</DrawerRowText>
      </DrawerRow>
      {failure ? <DrawerFooter attention>{failure}</DrawerFooter> : null}
    </DrawerScroll>}
    {naming ? <RenameAlert name={folder.name} onCancel={() => setNaming(false)}
      validate={(name) => folderNameProblem(tree, name, folder.parent, id)} onSave={(name) => {
        setNaming(false);
        try { library.folders.rename(id, name); onClose(); }
        catch (error) { setFailure(describe(error)); }
      }} /> : null}
  </Drawer>;
}

export function confirmFolderDeletion(name: string, folders: number, documents: number, remove: () => void): void {
  Alert.alert(`Delete “${name}”?`,
    `This will delete ${documents} document${documents === 1 ? '' : 's'} and ${folders} subfolder${folders === 1 ? '' : 's'}. ` +
    'Reading and downloads for these documents will stop, and their downloaded audio will be deleted. The original files are kept. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: remove },
    ]);
}
