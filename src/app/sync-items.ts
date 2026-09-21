/**
 * The Library as the Positions File sees it, and the Positions File as the
 * Library takes it — the two pure halves of adoption, kept out of the hook so
 * a test can reach them (`test/app/sync-items.test.ts`).
 *
 * **Out**: every entry with a Reading Position becomes one item; an entry
 * without one contributes nothing and cannot beat an item that has one (spec
 * 6.7). The locator goes out assertion-stripped (`canonicalCfi`), which is the
 * one spelling the file allows; the Library keeps whatever epub.js minted.
 * `publicationId` goes out null: both writers write null in this version of the
 * format (spec 6.2), whatever the entry recorded. A position that has no Device
 * Name of its own — one read out of a version-1 Library file — goes out under
 * **this** device's name with its `at` left at 0: the time is unknown, the
 * device that holds it is not, and the spec allows no empty `device`, so an
 * item written with one could never be adopted anywhere.
 *
 * **In**: an item is taken for an entry with the same Document Id when its
 * Stamp is newer than the entry's position's, or the entry has no position. The
 * entry's own Stamp — the shelf's order — moves up to the item's when that is
 * newer, so a book read yesterday on the desktop rises above one opened last
 * week here. Items for Documents not on this shelf are not this device's to
 * keep; they stay in the file, which the transport carries through.
 */

import { createLocator, newerThan, readLocator, type DocumentFormat, type DocumentId, type LibraryEntry, type ReadingPlace, type ReadingPosition } from '../core/document';
import type { PositionsItem } from '../core/sync/positions-file';
import { canonicalCfi } from '../renderer/cursor';

/**
 * Whether two places are the same sentence in the same Block: the same
 * canonical locator and the same quotation. What `reached` asks before it
 * writes, so that leaving a book or pausing on the sentence the reading was
 * already at re-stamps nothing (ADR 0031: a position's Stamp moves only when
 * speech stops somewhere new). Measured 2026-09-21: a pause wrote
 * `1789997956288`, leaving the reader nine minutes later wrote the very same
 * locator and sentence again as `1789998483390`, and the phone won a merge it
 * should have lost.
 */
export function samePlace(a: ReadingPlace, b: ReadingPlace, format: DocumentFormat): boolean {
  const x = readLocator(a.locator, format);
  const y = readLocator(b.locator, format);
  if (x === null || y === null) return false;
  return canonicalCfi(x) === canonicalCfi(y) && a.anchor.exact === b.anchor.exact;
}

/** The Library's positions as items of the file. `device` is this device's Device Name, for a position that carries none. */
export function itemsOf(entries: readonly LibraryEntry[], device: string): PositionsItem[] {
  const items: PositionsItem[] = [];
  for (const entry of entries) {
    if (!entry.position) continue;
    // The one door into an opaque locator (ADR 0007): the entry's own format is
    // the only dialect its locator could be in.
    const text = readLocator(entry.position.locator, entry.format);
    if (!text) continue;
    items.push({
      id: entry.id,
      format: entry.format,
      publicationId: null,
      locator: canonicalCfi(text),
      anchor: { exact: entry.position.anchor.exact, prefix: entry.position.anchor.prefix, suffix: entry.position.anchor.suffix },
      stamp: { at: entry.position.stamp.at, device: entry.position.stamp.device || device },
    });
  }
  return items;
}

/** What adopting a set of items would do to the entries. */
export interface Adoption {
  entries: readonly LibraryEntry[];
  /** The Document Ids whose position moved, in shelf order. */
  adopted: readonly DocumentId[];
}

/**
 * Take every item that is newer than what the entry holds. Pure: the caller
 * writes the file once for all of them.
 */
export function planAdoption(entries: readonly LibraryEntry[], items: readonly PositionsItem[]): Adoption {
  const byId = new Map(items.map((item) => [item.id, item]));
  const adopted: DocumentId[] = [];
  const next = entries.map((entry) => {
    const item = byId.get(entry.id);
    if (!item || item.format !== entry.format) return entry;
    if (!newerThan(item.stamp, entry.position?.stamp)) return entry;
    const position: ReadingPosition = {
      locator: createLocator(entry.format, item.locator),
      anchor: { exact: item.anchor.exact, prefix: item.anchor.prefix, suffix: item.anchor.suffix },
      stamp: { at: item.stamp.at, device: item.stamp.device },
    };
    adopted.push(entry.id);
    const stamp = item.stamp.at > entry.stamp.at ? { at: item.stamp.at, device: item.stamp.device } : entry.stamp;
    return { ...entry, position, stamp };
  });
  return { entries: adopted.length ? next : entries, adopted };
}

