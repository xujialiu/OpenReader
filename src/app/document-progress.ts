import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';
import type { DocumentId, ReadingPosition } from '../core/document';
import type { ArchiveBytes } from '../core/document/zip';
import { indexReadingText, readingPercentage, type SectionLength } from '../renderer/reading-progress';
import { documentFile } from './library';

async function withBook<T>(id: DocumentId, read: (archive: ArchiveBytes) => Promise<T>): Promise<T> {
  const file = documentFile(id, 'epub');
  const handle = file.open(FileMode.ReadOnly);
  try {
    return await read({ size: file.size, read(offset, length) {
      handle.offset = offset;
      return handle.readBytesSync(length);
    } });
  } finally { handle.close(); }
}

function workSlice() {
  let since = Date.now();
  return async () => {
    if (Date.now() - since < 8) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    since = Date.now();
  };
}

const building = new Map<DocumentId, Promise<SectionLength[]>>();
async function loadIndex(id: DocumentId) {
  const directory = new Directory(Paths.cache, 'reading-lengths-v1');
  const file = new File(directory, id + '.json');
  if (file.exists) {
    try {
      const lengths: unknown = JSON.parse(await file.text());
      if (Array.isArray(lengths) && lengths.every((item) => item && typeof item.path === 'string'
        && Number.isSafeInteger(item.length) && item.length >= 0)) return lengths as SectionLength[];
    } catch { /* An interrupted or evicted cache is rebuilt from the EPUB. */ }
  }
  const lengths = await withBook(id, (archive) => indexReadingText(archive, workSlice()));
  try {
    directory.create({ intermediates: true, idempotent: true });
    await file.write(JSON.stringify(lengths));
  } catch { /* These lengths still serve this request when the cache cannot be written. */ }
  return lengths;
}

function indexFor(id: DocumentId) {
  let pending = building.get(id);
  if (!pending) {
    pending = loadIndex(id).finally(() => building.delete(id));
    building.set(id, pending);
  }
  return pending;
}

export function useReadingPercentage(id: DocumentId, position: ReadingPosition | null) {
  const [found, setFound] = useState<{ id: DocumentId; position: ReadingPosition; percent: number | null } | null>(null);
  useEffect(() => {
    if (!position) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const sections = await indexFor(id);
        if (!current) return;
        const percent = await withBook(id, (archive) => readingPercentage(archive, sections, position, workSlice()));
        if (current) setFound({ id, position, percent });
      } catch {
        if (current) setFound({ id, position, percent: null });
      }
    }, 0);
    return () => { current = false; clearTimeout(timer); };
  }, [id, position]);
  return found?.id === id && found.position === position ? found.percent : null;
}
