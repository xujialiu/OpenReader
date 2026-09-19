/**
 * What a change to the **Document Id** rule costs a Library that was written
 * under the old one, and what to do about it (ADR 0004).
 *
 * ADR 0004's "Migration" section says the three books on the shelf "are
 * re-added", because at the time of the change nothing had synced. Re-adding
 * works and it throws away the one thing this app is named after: a re-added
 * book is a **new entry**, with `position: null`. The owner's place in it is on
 * the old entry, which nothing will ever match again. So the shelf ends up with
 * two rows for one book, one of which knows where the reading got to and can
 * never be opened at it.
 *
 * Renaming instead keeps the entry, and with it the Reading Position, the title
 * epub.js read out of the book and the Voice it was being read in. Nothing is
 * re-read, re-hashed at 34 MB or re-picked: the bytes are already on disk under
 * the old name, and the new name is a pure function of them.
 *
 * ## Why this file is platform-free
 *
 * It decides; `library.ts` moves the files and writes the Library, because it is
 * the file that knows where either of them is. The seam is one function: given
 * an entry, what is the id of the bytes stored under its current id. That makes
 * every decision here testable under Node (`test/README.md`), which matters more
 * than usual — the failure mode of getting this wrong is an entry that points at
 * nothing, and it is not visible until the owner taps the book.
 *
 * ## The order the caller must use, and what a crash in the middle costs
 *
 * Identify every entry first, then move every file, then write the Library once.
 * Identifying is the slow part and it changes nothing, so a crash during it
 * leaves the Library exactly as it was and the migration runs again at the next
 * launch. What is left is a window between the first move and the Library write,
 * which is a handful of `rename` calls wide.
 *
 * A crash inside that window leaves an entry naming a file that is now stored
 * under its new name. The Library screen says so — "The file for this book is
 * not on this device any more" — the bytes are still there, and adding the book
 * again re-attaches them, at the cost of that one book's Reading Position. A
 * journal file would close the window, and it was not built: it is a second file
 * and a second set of failures to reason about, to protect a few microseconds of
 * a migration that runs once per change to a rule that has changed once.
 */

import type { DocumentFormat, DocumentId, LibraryEntry } from '../core/document';

/** One file to move: the name its bytes are stored under now, and the name they belong under. */
export interface IdRename {
  from: DocumentId;
  to: DocumentId;
  format: DocumentFormat;
}

export interface IdMigrationPlan {
  /**
   * The entries as they should now be.
   *
   * **The very array that was passed in when nothing changed**, so that a caller
   * can tell "there was nothing to do" by identity and write neither the Library
   * nor anything else.
   */
  entries: readonly LibraryEntry[];
  /**
   * The files to move, **in this order**.
   *
   * Order is load-bearing where two entries turn out to be one Document: both
   * moves have the same destination, and the last one to run is the one whose
   * entry survives. Moving only the survivor's file would leave the other's bytes
   * on disk under a name nothing names — the orphan ADR 0004 declined to create
   * when it kept the `sha256:` prefix.
   */
  renames: readonly IdRename[];
  /** Entries that collapsed onto another, because two files the old rule called different documents are one under this one. */
  merged: number;
  /** Entries whose bytes could not be read or are not there. Left exactly as they were, and reported. */
  unreadable: number;
}

/**
 * What to do with a Library whose entries may have been named under an older
 * rule.
 *
 * `identify` answers with the Document Id of the bytes stored under an entry's
 * **current** id, or null when they cannot be read — a file that is not there, or
 * one `documentIdOf` refuses (ADR 0004 refuses rather than falling back, so a
 * refusal here is a real answer and not a shrug).
 *
 * An entry whose bytes come back with the id it already has is untouched, which
 * is what makes this safe to run again: the second run finds nothing to do.
 */
export function planIdMigration(
  entries: readonly LibraryEntry[],
  identify: (entry: LibraryEntry) => DocumentId | null,
): IdMigrationPlan {
  /** Every entry beside the id its own bytes answer to, or null where they could not be read. */
  const found = entries.map((entry) => ({ entry, id: identify(entry) }));
  const unreadable = found.filter((one) => one.id === null).length;

  /**
   * The entries that answer to each id, in shelf order.
   *
   * More than one is two entries for one Document: the old rule was a digest of
   * the whole file, so the same book repacked at another compression level had
   * two ids and could sit on the shelf twice. Under this rule it has one — which
   * is ADR 0004's own table, arriving on the shelf.
   */
  const groups = new Map<DocumentId, { entry: LibraryEntry; id: DocumentId }[]>();
  for (const one of found) {
    if (one.id === null) continue;
    const group = groups.get(one.id);
    if (group) group.push({ entry: one.entry, id: one.id });
    else groups.set(one.id, [{ entry: one.entry, id: one.id }]);
  }

  /**
   * Which entry of a group survives: the newer **Stamp**, which is the rule the
   * Library already sorts by and the rule that decides which of two copies of an
   * entry is current (`core/document/library.ts`).
   */
  const winners = new Map<DocumentId, LibraryEntry>();
  const renames: IdRename[] = [];
  let merged = 0;
  for (const [id, group] of groups) {
    const winner = group.reduce((best, one) => (one.entry.stamp.at > best.entry.stamp.at ? one : best));
    winners.set(id, { ...winner.entry, id });
    merged += group.length - 1;
    // The loser's file moves too, so nothing is orphaned, and it moves **first**
    // so that the surviving entry's own bytes are the ones left at the
    // destination. With one member the question does not arise.
    for (const one of group) {
      if (one !== winner && one.entry.id !== id) renames.push({ from: one.entry.id, to: id, format: one.entry.format });
    }
    if (winner.entry.id !== id) renames.push({ from: winner.entry.id, to: id, format: winner.entry.format });
  }

  if (renames.length === 0 && merged === 0) return { entries, renames: [], merged: 0, unreadable };

  /** Shelf order, with each group standing where its first member stood and the unreadable entries where they were. */
  const emitted = new Set<DocumentId>();
  const next: LibraryEntry[] = [];
  for (const one of found) {
    if (one.id === null) {
      next.push(one.entry);
      continue;
    }
    if (emitted.has(one.id)) continue;
    emitted.add(one.id);
    next.push(winners.get(one.id)!);
  }
  return { entries: next, renames, merged, unreadable };
}

/**
 * What the owner is told, or null when there was nothing to tell them.
 *
 * In their terms and not the rule's: what changed on the shelf, and that their
 * places are kept — which is the whole reason this is a migration rather than
 * ADR 0004's "add the books again".
 */
export function migrationSentence(plan: IdMigrationPlan): string | null {
  const said: string[] = [];
  const renamed = plan.renames.length;
  if (renamed > 0) {
    said.push(
      `${renamed === 1 ? 'One book was' : `${renamed} books were`} renamed to match the way a document is now recognised ` +
        'by what is inside it. Where you had got to in each of them is kept.',
    );
  }
  if (plan.merged > 0) {
    said.push(
      `${plan.merged === 1 ? 'One of them' : `${plan.merged} of them`} turned out to be a copy of another book on the shelf, ` +
        'so the shelf has that many fewer entries. The one kept is the one read most recently.',
    );
  }
  if (plan.unreadable > 0) {
    said.push(
      `${plan.unreadable === 1 ? 'One book' : `${plan.unreadable} books`} could not be read and ` +
        `${plan.unreadable === 1 ? 'was' : 'were'} left exactly as ${plan.unreadable === 1 ? 'it was' : 'they were'}.`,
    );
  }
  return said.length ? said.join(' ') : null;
}
