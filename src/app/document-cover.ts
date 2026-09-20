/** Rebuildable device-local thumbnails; the shared Library format stays unchanged. */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import type { LibraryEntry } from '../core/document';
import { readDocumentCover } from '../core/document/cover';
import { documentFile } from './library';

const directory = () => new Directory(Paths.cache, 'document-covers');
const remembered = new Map<string, string | null>();
function coverOf(entry: Pick<LibraryEntry, 'id' | 'format'>): string | null {
  const previous = remembered.get(entry.id);
  if (previous && new File(previous).exists) return previous;
  if (previous === null) return null;
  const dir = directory();
  dir.create({ intermediates: true, idempotent: true });
  for (const extension of ['jpg', 'png', 'webp', 'gif']) {
    const file = new File(dir, `${entry.id}.${extension}`);
    if (file.exists) { remembered.set(entry.id, file.uri); return file.uri; }
  }
  const file = documentFile(entry.id, entry.format);
  if (!file.exists) return null; // A later import can restore the file.
  const handle = file.open(FileMode.ReadOnly);
  try {
    const cover = readDocumentCover({ size: file.size, read: (offset, length) => {
      handle.offset = offset;
      return handle.readBytes(length);
    } });
    if (!cover) { remembered.set(entry.id, null); return null; }
    const target = new File(dir, `${entry.id}.${cover.extension}`);
    target.write(cover.bytes);
    remembered.set(entry.id, target.uri);
    return target.uri;
  } finally { handle.close(); }
}

export function useDocumentCover(entry: LibraryEntry): string | null {
  const [cover, setCover] = useState<string | null>(null);
  const { id, format } = entry;
  useEffect(() => {
    // Only mounted list rows are read, after the list has had a chance to paint.
    const timer = setTimeout(() => {
      try { setCover(coverOf({ id, format })); } catch { setCover(null); }
    }, 0);
    return () => clearTimeout(timer);
  }, [id, format]); // Position writes do not re-read the archive.
  return cover;
}
