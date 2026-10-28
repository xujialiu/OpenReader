import type { LibraryEntry } from '../core/document';
import { childFolders, type Folder, type FolderId, type FolderTree } from '../core/folders';

export type LibraryRow = { kind: 'folder'; folder: Folder } | { kind: 'document'; entry: LibraryEntry };

/** Names as displayed, not EPUB metadata or text. Whitespace alone is an empty query. */
export function libraryQuery(text: string): string { return text.trim().normalize('NFC').toLowerCase(); }

/** The Library already owns the recency order; filtering must neither sort nor change it. */
export function libraryRows(tree: FolderTree, entries: readonly LibraryEntry[], folder: FolderId | null, query: string): LibraryRow[] {
  const fragment = libraryQuery(query);
  if (fragment) return entries.filter((entry) => libraryQuery(entry.title).includes(fragment))
    .map((entry) => ({ kind: 'document', entry }));
  return [
    ...childFolders(tree, folder).map((child): LibraryRow => ({ kind: 'folder', folder: child })),
    ...entries.filter((entry) => (tree.documents[entry.id] ?? null) === folder)
      .map((entry): LibraryRow => ({ kind: 'document', entry })),
  ];
}
