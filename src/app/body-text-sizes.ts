/**
 * Each Document's **body text size** on this device (ADR 0030): what the owner's
 * Font Size is measured against, decided once per Document and kept so that the
 * next open is laid out at the owner's size on its first paint.
 *
 * A file of its own beside the Library rather than a field in it, the way
 * `display-names.json` is. `library.json` is the file ADR 0003 may one day sync
 * and it grows only by sibling files (`core/document/library.ts`), and this is a
 * cache of something the Document's own bytes decide.
 *
 * **Being a cache is also its failure policy.** A damaged or unwritable file
 * costs one count on the next open; a thrown parse or write would cost the
 * reading that is going on. So nothing here throws, where `display-names.ts` —
 * whose file holds what the owner typed — refuses a file it cannot read.
 */
import { File, Paths } from 'expo-file-system';

import { offlineNative } from '../../modules/open-reader-offline';
import type { DocumentId } from '../core/document';
import { isPixelSize } from '../renderer/body-text';

const file = () => new File(Paths.document, 'body-text-sizes.json');

/** Every size that is a size, from a file of this version, and nothing from anything else. */
function readAll(): Record<string, number> {
  const source = file();
  if (!source.exists) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.textSync());
  } catch {
    return {};
  }
  const sizes = parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1
    ? (parsed as { sizes?: unknown }).sizes : null;
  if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) return {};
  const kept: Record<string, number> = {};
  for (const [id, px] of Object.entries(sizes)) if (isPixelSize(px)) kept[id] = px;
  return kept;
}

/** The body text size this Document was measured at, or null if it has not been. */
export function readBodyTextSize(id: DocumentId): number | null {
  return readAll()[id] ?? null;
}

/** Remember a Document's body text size, beside every other one already measured. */
export function writeBodyTextSize(id: DocumentId, px: number): void {
  const value = JSON.stringify({ version: 1, sizes: { ...readAll(), [id]: px } });
  try {
    if (offlineNative) offlineNative.writeJson(file().uri, value);
    else file().write(value);
  } catch {
    // Not kept, and counted again on the next open: see the failure policy above.
  }
}
