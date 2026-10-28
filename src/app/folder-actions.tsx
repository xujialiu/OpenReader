import { useRef, useState, type ReactNode } from 'react';
import { Alert } from 'react-native';
import type { DocumentId } from '../core/document';
import { documentNameProblem, folderAt, folderNameProblem, folderPath, moveChoice, type FolderId, type LibraryTarget } from '../core/folders';
import { INK } from './controls';
import { Drawer, DrawerChevron, DrawerFooter, DrawerRow, DrawerRowText, DrawerScroll, type DrawerAction } from './drawer';
import { RenameAlert } from './rename-alert';
import { useShell } from './routes';

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Native dismissal finishes before opening Files or focusing search. `folder` is the page's, where Create folder creates (#317). */
export function AddDrawer({ visible, folder, onClose, onImport, onSearch, onSelect }: { visible: boolean; folder: FolderId | null; onClose(): void; onImport(): void; onSearch(): void; onSelect?(): void }) {
  const { library } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const [naming, setNaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef<'import' | 'search' | null>(null);
  const parent = useRef<FolderId | null>(null);
  return <Drawer visible={visible} title="Library actions" onClose={onClose} onDismiss={() => {
    setNaming(false); setFailure(null);
    const action = pending.current;
    pending.current = null;
    if (action === 'import') onImport();
    else if (action === 'search') onSearch();
  }}>
    <DrawerScroll>
      <DrawerRow icon="plus" disabled={busy || !!problem} onPress={() => { pending.current = 'import'; onClose(); }}>
        <DrawerRowText>Import file</DrawerRowText>
      </DrawerRow>
      <DrawerRow icon="folder" disabled={busy || !!problem} onPress={() => { parent.current = folder; setNaming(true); }}>
        <DrawerRowText>Create folder</DrawerRowText>
      </DrawerRow>
      <DrawerRow icon="search" disabled={busy || !!problem} onPress={() => { pending.current = 'search'; onClose(); }}>
        <DrawerRowText>Search</DrawerRowText>
      </DrawerRow>
      {onSelect ? <DrawerRow icon="check" disabled={busy || !!problem} onPress={() => { onClose(); onSelect(); }}>
        <DrawerRowText>Select</DrawerRowText>
      </DrawerRow> : null}
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

/** A move page's header, spread into its `Drawer`, and what goes under it. */
export interface MovePage {
  header: { title: string; onBack?(): void; backLabel?: string; action: DrawerAction };
  body: ReactNode;
  /** Show the entries' own folder again: called as the page is opened. */
  restart(): void;
}

/**
 * The move page, shared by a Document's and a Folder's actions and by a
 * selection's Move; looking through destinations never changes the folder
 * being browsed.
 *
 * As Files' Move sheet (#151, notes 2026-10-10 13:42), so that nothing on it
 * changes place from one folder to the next: `Move` is the header's action at
 * the right, plain where it cannot act (the entries' own folder, a Folder being
 * moved and its descendants) and filled where it can; the header's back button
 * goes up a folder, and at the Library root leaves the page through `onLeave`,
 * or is absent without one. Under the header are the path, the one place that
 * says where the page is, and the folder's Folders, a Folder being moved
 * included. A refusal is the phone's alert, since a line under a long list is
 * out of sight of the button that was pressed.
 */
export function useMovePage(moving: { target: MoveTarget } | { targets: readonly LibraryTarget[]; from: FolderId | null }, { onMoved, onLeave }: { onMoved(): void; onLeave?(): void }): MovePage {
  const { library } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const target = 'target' in moving ? moving.target : null;
  // A selection's entries are the rows of the page it was made on (#317).
  const source = 'from' in moving ? moving.from : target ? (target.kind === 'folder' ? tree.folders.find((folder) => folder.id === target.id)?.parent ?? null : tree.documents[target.id] ?? null) : null;
  /** `undefined` until the owner leaves the entries' own folder. */
  const [destination, setDestination] = useState<FolderId | null | undefined>(undefined);
  const shown = destination === undefined ? source : destination;
  const current = shown !== null && !tree.folders.some((folder) => folder.id === shown) ? null : shown;
  const { canMove, folders } = moveChoice(tree, target ? [target] : 'targets' in moving ? moving.targets : [], source, current);
  const parent = current === null ? null : folderAt(tree, current).parent;
  const move = () => {
    try {
      if (!target) library.folders.moveEntries('targets' in moving ? moving.targets : [], library.entries.map((entry) => entry.id), current,
        Object.fromEntries(library.entries.map((entry) => [entry.id, entry.title])));
      else if (target.kind === 'folder') library.folders.moveFolder(target.id, current);
      else {
        const entry = library.current(target.id);
        if (!entry) throw new Error('That document is no longer in the Library.');
        // A Document is not moved into a Folder holding another of its name (#227).
        const problem = documentNameProblem(tree, library.entries, entry.title, current, entry.id);
        if (problem) throw new Error(`“${entry.title}”: ${problem}`);
        library.folders.place(target.id, current);
      }
      onMoved();
    } catch (error) { Alert.alert('Could not move', describe(error)); }
  };
  return {
    header: {
      title: 'Move to…',
      onBack: current !== null ? () => setDestination(parent) : onLeave,
      backLabel: current !== null ? `Back to ${parent === null ? 'Library' : folderAt(tree, parent).name}` : undefined,
      action: { label: 'Move', prominent: true, disabled: !canMove || busy || !!problem, onPress: move },
    },
    body: <DrawerScroll>
      <DrawerFooter>{folderPath(tree, current)}</DrawerFooter>
      {folders.map((folder) =>
        <DrawerRow key={folder.id} icon="folder" accessory={<DrawerChevron />} onPress={() => setDestination(folder.id)}>
          <DrawerRowText>{folder.name}</DrawerRowText>
        </DrawerRow>)}
    </DrawerScroll>,
    restart: () => setDestination(undefined),
  };
}

export function FolderActions({ id, onClose, onDelete, onSelect }: { id: FolderId; onClose(): void; onDelete(id: FolderId): void; onSelect?(id: FolderId): void }) {
  const { library } = useShell();
  const { tree, busy, problem } = library.folderSnapshot;
  const folder = tree.folders.find((one) => one.id === id);
  const [moving, setMoving] = useState(false);
  const [naming, setNaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const move = useMovePage({ target: { kind: 'folder', id } }, { onMoved: onClose, onLeave: () => setMoving(false) });
  // Another Folder's `…`, touched in the Library behind the open drawer, opens that Folder's menu afresh, as a Document's does (#151).
  const [shown, setShown] = useState(id);
  if (shown !== id) {
    setShown(id); setMoving(false); setNaming(false); setFailure(null); move.restart();
  }
  if (!folder) return null;
  return <Drawer visible onClose={onClose} {...(moving ? move.header : { title: folder.name })}>
    {moving ? move.body : <DrawerScroll>
      <DrawerRow icon="rename" disabled={busy || !!problem} onPress={() => setNaming(true)}><DrawerRowText>Rename</DrawerRowText></DrawerRow>
      <DrawerRow icon="folder" disabled={busy || !!problem} onPress={() => { move.restart(); setMoving(true); }} accessory={<DrawerChevron />}><DrawerRowText>Move to…</DrawerRowText></DrawerRow>
      {onSelect ? <DrawerRow icon="check" disabled={busy || !!problem} onPress={() => onSelect(id)}><DrawerRowText>Select</DrawerRowText></DrawerRow> : null}
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
