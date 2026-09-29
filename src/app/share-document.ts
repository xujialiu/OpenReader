/**
 * **Share** (CONTEXT.md): hand a copy of one Document's file to another app or
 * person through the phone's own share sheet (#95, ADR 0059).
 *
 * Only the file goes. Its bytes are the ones that were added, so another
 * OpenReader, or the desktop plugin, recognises it as the same Document Id
 * (ADR 0004). The Library entry, its Reading Position and its Offline
 * Narration stay here.
 *
 * ## Why a copy
 *
 * iOS names a shared file after the last part of its path, and the kept file's
 * name is its Document Id (`library.ts`). The copy exists only to carry the name
 * the Library shows (`share-name.ts`). It is kept in the cache, in a folder of
 * its own that is emptied before the next share rather than after this one:
 * the share sheet closes before AirDrop or Mail has necessarily finished reading
 * what it was given, and the phone may empty the cache itself whenever it needs
 * the room.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { LibraryEntry } from '../core/document';
import { cutText, debugLog, describeProblem, shortId } from '../debug/debug-log';
import { EPUB_MEDIA_TYPE } from './document';
import { documentFile } from './library';
import { sharedFileName } from './share-name';

/** The cache folder the named copy is made in. */
const SHARE_DIRECTORY = 'share';

/**
 * Open the share sheet for this Document, and settle when the sheet has gone.
 *
 * It rejects with a sentence for the owner: the drawer shows the message as it
 * is (Q6 on #95), so it names what went wrong in their words.
 */
export async function shareDocument(entry: Pick<LibraryEntry, 'id' | 'format' | 'title'>): Promise<void> {
  const kept = documentFile(entry.id, entry.format);
  if (!kept.exists) {
    debugLog('document', `share ${shortId(entry.id)}: no file`);
    throw new Error('The file for this book is not on this device any more, so there is nothing to share. Add the book again to share it.');
  }
  const started = Date.now();
  try {
    const outbox = new Directory(Paths.cache, SHARE_DIRECTORY);
    if (outbox.exists) outbox.delete();
    outbox.create({ intermediates: true, idempotent: true });
    const copy = new File(outbox, sharedFileName(entry.title, entry.format));
    kept.copySync(copy);
    debugLog('document', `share ${shortId(entry.id)} as ${cutText(copy.name)}: copied in ${Date.now() - started} ms`);
    // `mimeType` and `dialogTitle` are Android's. On iOS the sheet reads the
    // type from the file's extension, and `UTI` is accepted and never used
    // (read from `SharingModule.swift` in 57.0.22).
    await Sharing.shareAsync(copy.uri, { mimeType: EPUB_MEDIA_TYPE, dialogTitle: entry.title });
    debugLog('document', `share ${shortId(entry.id)}: sheet closed after ${Date.now() - started} ms`);
  } catch (problem) {
    debugLog('document', `share ${shortId(entry.id)} failed: ${describeProblem(problem)}`);
    throw new Error(`This book could not be shared: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}
