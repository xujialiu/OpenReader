import { describe, expect, it } from 'vitest';

import { createLocator, readingPositionAt, type DocumentId, type LibraryEntry } from '../../src/core/document';
import { migrationSentence, planIdMigration } from '../../src/app/document-ids';

/**
 * What happens to a shelf when the rule that names a Document changes (ADR 0004).
 *
 * ADR 0004's "Migration" section says the three books on the shelf are re-added.
 * Re-adding makes a **second entry** with `position: null` and leaves the first
 * one unopenable, so the owner's place in each book is the price. These are the
 * assertions that say it is not paid: the entry survives with its Reading
 * Position, its title and its Voice, and only its id moves.
 *
 * The file system is not here by design (`test/README.md`); the seam is
 * `identify`, which in the app opens the file and digests its central directory
 * and here is a map.
 */

const stamp = (at: number) => ({ at, device: 'device-one' });

function entry(id: string, title: string, at: number, position = true): LibraryEntry {
  return {
    id: id as DocumentId,
    format: 'epub',
    publicationId: null,
    publicationIdSource: 'none',
    title,
    position: position ? readingPositionAt(createLocator('epub', 'epubcfi(/6/2!/4/4)'), 'A sentence in the book.', 2, 10, { at: 1, device: 'phone' }) : null,
    voice: { provider: 'fish', voice: 'a-voice' },
    stamp: stamp(at),
  };
}

const OLD_ONE = 'sha256:' + 'a'.repeat(64);
const OLD_TWO = 'sha256:' + 'b'.repeat(64);
const NEW_ONE = 'sha256:' + '1'.repeat(64);
const NEW_TWO = 'sha256:' + '2'.repeat(64);

/** `identify`, as a table: the id the bytes under each stored name answer to. */
function answers(table: Record<string, string | null>): (one: LibraryEntry) => DocumentId | null {
  return (one) => (table[one.id] ?? null) as DocumentId | null;
}

describe('a shelf named under the rule ADR 0004 replaced', () => {
  it('does nothing at all when every file already answers to its own name', () => {
    const entries = [entry(NEW_ONE, '仙逆', 3), entry(NEW_TWO, 'A Short Test', 2)];
    const plan = planIdMigration(entries, answers({ [NEW_ONE]: NEW_ONE, [NEW_TWO]: NEW_TWO }));
    // The **same array**, so the caller writes neither the Library nor a file.
    expect(plan.entries).toBe(entries);
    expect(plan.renames).toEqual([]);
    expect(plan.merged).toBe(0);
    expect(migrationSentence(plan)).toBeNull();
  });

  it('keeps the Reading Position, the title and the Voice, and moves only the id', () => {
    // The whole argument for renaming rather than re-adding, as an assertion.
    const was = entry(OLD_ONE, '仙逆', 3);
    const plan = planIdMigration([was], answers({ [OLD_ONE]: NEW_ONE }));
    expect(plan.entries).toEqual([{ ...was, id: NEW_ONE }]);
    expect(plan.entries[0].position).toBe(was.position);
    expect(plan.renames).toEqual([{ from: OLD_ONE, to: NEW_ONE, format: 'epub' }]);
  });

  it('leaves an entry whose bytes cannot be read exactly as it was, and says how many', () => {
    // A file that is gone, or one `documentIdOf` refuses — ADR 0004 refuses rather
    // than falling back, so a refusal is an answer and not a reason to guess a name.
    const gone = entry(OLD_TWO, 'Fixtura', 1);
    const plan = planIdMigration([entry(OLD_ONE, '仙逆', 3), gone], answers({ [OLD_ONE]: NEW_ONE, [OLD_TWO]: null }));
    expect(plan.unreadable).toBe(1);
    expect(plan.entries).toContainEqual(gone);
    expect(plan.renames.map((one) => one.from)).toEqual([OLD_ONE]);
    expect(migrationSentence(plan)).toContain('could not be read');
  });

  it('collapses two entries the old rule kept apart, keeping the one read most recently', () => {
    /**
     * The old rule was a digest of the whole file, so the same book repacked at
     * another compression level was two documents and could sit on the shelf
     * twice — ADR 0004's own table, three files and one id. Under this rule they
     * are one entry, and which one survives is the **Stamp**, which is the rule
     * the Library already sorts and merges by.
     */
    const older = entry(OLD_ONE, 'The same book, older copy', 1);
    const newer = entry(OLD_TWO, 'The same book, read yesterday', 9);
    const plan = planIdMigration([older, newer], answers({ [OLD_ONE]: NEW_ONE, [OLD_TWO]: NEW_ONE }));
    expect(plan.merged).toBe(1);
    expect(plan.entries).toEqual([{ ...newer, id: NEW_ONE }]);
    // Both files move, so neither is left on disk under a name nothing names, and
    // the survivor's own bytes are the ones left at the destination.
    expect(plan.renames).toEqual([
      { from: OLD_ONE, to: NEW_ONE, format: 'epub' },
      { from: OLD_TWO, to: NEW_ONE, format: 'epub' },
    ]);
    expect(migrationSentence(plan)).toContain('copy of another book');
  });

  it('collapses an old entry onto one that is already named by this rule', () => {
    const already = entry(NEW_ONE, 'Added today', 9);
    const old = entry(OLD_ONE, 'Added last week', 1);
    const plan = planIdMigration([already, old], answers({ [NEW_ONE]: NEW_ONE, [OLD_ONE]: NEW_ONE }));
    expect(plan.entries).toEqual([already]);
    expect(plan.merged).toBe(1);
    // Only the one that has somewhere to go moves, and it moves onto the entry
    // that survives — whose own file is already there and is written over by bytes
    // that are the same Document.
    expect(plan.renames).toEqual([{ from: OLD_ONE, to: NEW_ONE, format: 'epub' }]);
  });

  it('is safe to run twice, because the second run finds nothing to do', () => {
    const entries = [entry(OLD_ONE, '仙逆', 3)];
    const first = planIdMigration(entries, answers({ [OLD_ONE]: NEW_ONE }));
    const second = planIdMigration(first.entries, answers({ [NEW_ONE]: NEW_ONE }));
    expect(second.entries).toBe(first.entries);
    expect(second.renames).toEqual([]);
  });

  it('tells the owner what changed on the shelf and that their places are kept', () => {
    const one = planIdMigration([entry(OLD_ONE, '仙逆', 3)], answers({ [OLD_ONE]: NEW_ONE }));
    expect(migrationSentence(one)).toBe(
      'One book was renamed to match the way a document is now recognised by what is inside it. ' +
        'Where you had got to in each of them is kept.',
    );
    const many = planIdMigration(
      [entry(OLD_ONE, 'One', 3), entry(OLD_TWO, 'Two', 2)],
      answers({ [OLD_ONE]: NEW_ONE, [OLD_TWO]: NEW_TWO }),
    );
    expect(migrationSentence(many)).toContain('2 books were renamed');
  });
});
