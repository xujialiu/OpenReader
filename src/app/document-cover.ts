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

/**
 * The Document's Cover as a file URI, `null` when it has none, and `undefined`
 * until that is known. The Library draws its placeholder for both of the last two;
 * Now Playing waits through `undefined`, so a Document with a Cover never shows
 * the app's icon first (#119). A Cover that cannot be read is no Cover.
 */
export function useDocumentCover({ id, format }: Pick<LibraryEntry, 'id' | 'format'>): string | null | undefined {
  const [found, setFound] = useState<{ id: string; cover: string | null } | null>(null);
  useEffect(() => {
    // Only mounted list rows are read, after the list has had a chance to paint.
    const timer = setTimeout(() => {
      let cover: string | null;
      try { cover = coverOf({ id, format }); } catch { cover = null; }
      setFound({ id, cover });
    }, 0);
    return () => clearTimeout(timer);
  }, [id, format]); // Position writes do not re-read the archive.
  // Another Document's answer is not this one's.
  return found?.id === id ? found.cover : undefined;
}
