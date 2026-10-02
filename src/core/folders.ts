/** Device-local Library organization. Document identities and positions never change with their Folder. */
export type FolderId = string;
export interface Folder { id: FolderId; name: string; parent: FolderId | null }
export interface FolderTree {
  version: 1;
  folders: readonly Folder[];
  /** Missing membership means the Library root. */
  documents: Readonly<Record<string, FolderId>>;
  current: FolderId | null;
}
export const emptyFolders = (): FolderTree => ({ version: 1, folders: [], documents: {}, current: null });

export function folderAt(tree: FolderTree, id: FolderId): Folder {
  const found = tree.folders.find((folder) => folder.id === id);
  if (!found) throw new Error('That folder no longer exists.');
  return found;
}
export function folderPath(tree: FolderTree, id: FolderId | null): string {
  const names = [];
  while (id !== null) {
    const folder = folderAt(tree, id);
    names.push(folder.name);
    id = folder.parent;
  }
  return ['Library', ...names.reverse()].join(' → ');
}
export function childFolders(tree: FolderTree, parent: FolderId | null): Folder[] {
  return tree.folders.filter((folder) => folder.parent === parent)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
export function folderSubtree(tree: FolderTree, id: FolderId): Set<FolderId> {
  folderAt(tree, id);
  const ids = new Set([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    for (const folder of tree.folders) if (folder.parent === queue[i] && !ids.has(folder.id)) {
      ids.add(folder.id);
      queue.push(folder.id);
    }
  }
  return ids;
}
const nameKey = (name: string) => name.normalize('NFC').toLowerCase();
export function folderNameProblem(tree: FolderTree, name: string, parent: FolderId | null, except?: FolderId): string | null {
  if (!name.trim()) return 'Enter a folder name.';
  if (tree.folders.some((folder) => folder.parent === parent && folder.id !== except && nameKey(folder.name) === nameKey(name.trim()))) {
    return 'A folder with this name already exists here. Rename it first.';
  }
  return null;
}
function parentExists(tree: FolderTree, parent: FolderId | null): void { if (parent !== null) folderAt(tree, parent); }
export function putFolder(tree: FolderTree, folder: Folder): FolderTree {
  parentExists(tree, folder.parent);
  const problem = folderNameProblem(tree, folder.name, folder.parent, folder.id);
  if (problem) throw new Error(problem);
  const exists = tree.folders.some((one) => one.id === folder.id);
  if (folder.parent === folder.id || (exists && folder.parent !== null && folderSubtree(tree, folder.id).has(folder.parent))) {
    throw new Error('A folder cannot be moved into itself or one of its subfolders.');
  }
  const next = { ...folder, name: folder.name.trim() };
  return { ...tree, folders: exists ? tree.folders.map((one) => one.id === folder.id ? next : one) : [...tree.folders, next] };
}
export function placeDocument(tree: FolderTree, document: string, parent: FolderId | null): FolderTree {
  parentExists(tree, parent);
  const documents = { ...tree.documents };
  if (parent === null) delete documents[document];
  else documents[document] = parent;
  return { ...tree, documents };
}
export function withoutFolder(tree: FolderTree, id: FolderId): FolderTree {
  const removed = folderSubtree(tree, id);
  return { ...tree, folders: tree.folders.filter((folder) => !removed.has(folder.id)),
    documents: Object.fromEntries(Object.entries(tree.documents).filter(([, parent]) => !removed.has(parent))),
    current: tree.current !== null && removed.has(tree.current) ? null : tree.current };
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
/** Refuse corrupt/newer/unknown data instead of silently flattening the owner's organization. Only a stale browsing location falls back to root. */
export function parseFolders(text: string): FolderTree {
  const value: unknown = JSON.parse(text);
  const invalid = () => new Error('The saved folders cannot be read by this version. The file has been kept unchanged.');
  if (!record(value) || !exactKeys(value, ['version', 'folders', 'documents', 'current']) || value.version !== 1 ||
      !Array.isArray(value.folders) || !record(value.documents) || (value.current !== null && typeof value.current !== 'string')) throw invalid();
  const folders: Folder[] = [];
  for (const folder of value.folders) {
    if (!record(folder) || !exactKeys(folder, ['id', 'name', 'parent']) || typeof folder.id !== 'string' || !folder.id ||
        typeof folder.name !== 'string' || !folder.name.trim() || folder.name !== folder.name.trim() ||
        (folder.parent !== null && typeof folder.parent !== 'string') || folders.some((one) => one.id === folder.id)) throw invalid();
    folders.push({ id: folder.id, name: folder.name, parent: folder.parent });
  }
  const documents: Record<string, string> = {};
  const tree: FolderTree = { version: 1, folders, documents, current: value.current };
  for (const folder of folders) {
    if (folderNameProblem(tree, folder.name, folder.parent, folder.id)) throw invalid();
    const seen = new Set([folder.id]);
    let parent = folder.parent;
    while (parent !== null) {
      if (seen.has(parent)) throw invalid();
      seen.add(parent);
      const found = folders.find((one) => one.id === parent);
      if (!found) throw invalid();
      parent = found.parent;
    }
  }
  for (const [id, parent] of Object.entries(value.documents)) {
    if (!id || typeof parent !== 'string' || !folders.some((one) => one.id === parent)) throw invalid();
    Object.defineProperty(documents, id, { value: parent, enumerable: true, writable: true, configurable: true });
  }
  if (tree.current !== null && !folders.some((one) => one.id === tree.current)) tree.current = null;
  return tree;
}

export interface FolderSnapshot { tree: FolderTree; busy: boolean; problem: string | null }
/** Synchronous durable mutations; listeners see a change only after its write succeeds. */
export function createFolderStore(io: { read(): string | null; write(text: string): void; id(): string }) {
  let snapshot: FolderSnapshot;
  try {
    const text = io.read();
    snapshot = { tree: text === null ? emptyFolders() : parseFolders(text), busy: false, problem: null };
  } catch (error) {
    snapshot = { tree: emptyFolders(), busy: false, problem: error instanceof Error ? error.message : String(error) };
  }
  const listeners = new Set<() => void>();
  const emit = () => { for (const listener of listeners) listener(); };
  const writable = () => {
    if (snapshot.problem) throw new Error(snapshot.problem);
    if (snapshot.busy) throw new Error('Wait for the folder deletion to finish.');
  };
  const save = (tree: FolderTree) => {
    io.write(JSON.stringify(tree));
    snapshot = { ...snapshot, tree };
    emit();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    writable,
    visit(id: FolderId | null) {
      writable(); parentExists(snapshot.tree, id);
      if (id !== snapshot.tree.current) save({ ...snapshot.tree, current: id });
    },
    create(name: string, parent: FolderId | null): FolderId {
      writable();
      const id = io.id();
      if (!id || snapshot.tree.folders.some((folder) => folder.id === id)) throw new Error('Could not create a unique folder. Try again.');
      save(putFolder(snapshot.tree, { id, name, parent }));
      return id;
    },
    rename(id: FolderId, name: string) { writable(); save(putFolder(snapshot.tree, { ...folderAt(snapshot.tree, id), name })); },
    moveFolder(id: FolderId, parent: FolderId | null) { writable(); save(putFolder(snapshot.tree, { ...folderAt(snapshot.tree, id), parent })); },
    place(document: string, parent: FolderId | null) { writable(); save(placeDocument(snapshot.tree, document, parent)); },
    /** Lock organization/imports while paid audio and Library entries are removed. On failure keep the remaining subtree reachable for retry. */
    async deleteTree(id: FolderId, documents: readonly string[], remove: (document: string) => Promise<void>) {
      writable();
      const subtree = folderSubtree(snapshot.tree, id);
      const contained = documents.filter((document) => subtree.has(snapshot.tree.documents[document]));
      snapshot = { ...snapshot, busy: true }; emit();
      try {
        for (const document of contained) await remove(document);
        save(withoutFolder(snapshot.tree, id));
      } finally {
        snapshot = { ...snapshot, busy: false }; emit();
      }
    },
  };
}
export type FolderStore = ReturnType<typeof createFolderStore>;
