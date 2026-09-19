/**
 * The **Library** on disk: one JSON file, and the Documents it names.
 *
 * ADR 0019 puts the whole of it in the app's own documents directory, written
 * after every change and read once at launch. `core/document/library.ts` owns
 * the *format* — the version rule, the defensive parse, the canonical bytes —
 * and this file owns the only two things that format cannot: where the file is,
 * and where a Document's own bytes are.
 *
 * ## Where a Document's bytes are, and why it is not in the file
 *
 * ADR 0019 said an entry would store "a security-scoped bookmark and re-resolve
 * it on use". It does not, and the reason is measured rather than preferred:
 * **Expo SDK 57 has no API that makes one.** `expo-file-system` starts and stops
 * access on a URL it was already handed (`ios/FileSystemPath.swift:139`) and
 * never calls `URL.bookmarkData`; the string `bookmarkData` appears in no
 * installed `expo-*` or `@expo/*` package. Expo's own type for the directory
 * picker states the consequence in as many words: "On iOS, the selected
 * directory grants temporary read and write access for the current app session
 * only. After the app restarts, you must prompt the user again to regain
 * access." A bookmark is therefore a native module that does not exist yet.
 *
 * There is a second fact that makes the bookmark the wrong shape here even once
 * that module exists. `File.pickFileAsync` **never shows the picked file's own
 * URL to JavaScript at all**: the picker is built `asCopy: true`
 * (`expo-file-system/ios/FilePickingUtils.swift:79`), so what arrives is already
 * a copy in the app's temporary directory. Nothing this app can reach has the
 * original's location to bookmark.
 *
 * So the Document's bytes are kept, and **the Document Id is the file name**.
 * That is not a substitute for the bookmark, it is better than one in the one
 * way that matters to ADR 0003: a bookmark is meaningless on any other device,
 * and the Library file is the candidate for what is synced to the owner's own
 * WebDAV folder. A file named by its own content hash needs no field in the
 * Library file, no sibling file and no device to interpret it — so this build
 * adds **no field** to the version-1 format, which is what `core/document`'s
 * README says growth must look like.
 *
 * A Document whose file has gone is surfaced on the entry rather than deleted
 * (`missing` below), per the design file: a file that is temporarily unreachable
 * is not the same as one the owner threw away.
 *
 * ## Four things in this directory, and only one of them is shared
 *
 * - `library.json` — the Library, exactly as `serializeLibrary` writes it. This
 *   is the file ADR 0003 may one day sync, and it holds nothing device-local.
 * - `library/<document-id>.epub` — a Document's bytes, named by its Document Id.
 * - `this-device` — an opaque string that differs between devices, for the
 *   **Stamp** (CONTEXT.md). It is in its own file for the same reason the
 *   bookmark is not in the Library file: it means nothing anywhere else. It must
 *   survive a relaunch or the Stamp says nothing, which is why it is written
 *   down rather than generated per session.
 * - `library-id-rule` — which **Document Id rule** the names in `library/` were
 *   computed by (ADR 0004). Also device-local: it describes the files on this
 *   disk. A new file rather than a field, which is ADR 0003's rule for growth and
 *   is here the only shape available — an id from the old rule is
 *   indistinguishable from one from this rule, so nothing *inside* the Library
 *   could ever say which named an entry.
 */

import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { APP_NAME } from '../../app-name';

import {
  DOCUMENT_ID_RULE,
  documentIdOf,
  serializeLibrary,
  parseLibrary,
  type DocumentId,
  type DocumentFormat,
  type LibraryEntry,
  type LibraryProblem,
} from '../core/document';

import { migrationSentence, planIdMigration } from './document-ids';

/** The Library itself. One file, rewritten whole (ADR 0019). */
const LIBRARY_FILE = 'library.json';

/** Where the Documents' bytes go. A subdirectory, so the Library file is not sitting among books. */
const BOOKS_DIRECTORY = 'library';

/** The device half of a Stamp. */
const DEVICE_FILE = 'this-device';

/**
 * Which **Document Id rule** the files in `library/` are named under
 * (`DOCUMENT_ID_RULE`, ADR 0004).
 *
 * A file of its own rather than a field, which is ADR 0003's rule for how this
 * format grows — and here it is also the only shape that works. An id computed
 * by the rule ADR 0004 replaced "has exactly the shape of one from this rule and
 * cannot be told apart from it", so nothing in the Library file could ever say
 * which rule named an entry. Something outside it has to.
 *
 * It is device-local, like `this-device` and for the same reason: it describes
 * the files on **this** disk, and syncing it would be syncing a fact that is
 * false everywhere else.
 *
 * Absent means "unknown", which is what a Library written before this file
 * existed looks like, so the migration runs. Present and equal to the current
 * rule means every file is already named by it and nothing is read at all — which
 * is what stops a 34 MB book being opened and digested at every launch for ever.
 */
const ID_RULE_FILE = 'library-id-rule';

/**
 * A Document Id as a file name: `sha256:abc…` → `sha256-abc….epub`.
 *
 * The colon is replaced rather than dropped, so the name is still legibly the
 * Document Id when the owner is looking at the directory — which is the same
 * reason ADR 0019 gives for the Library being JSON. A colon is legal on APFS and
 * is displayed as a slash by Finder and by the Files app, which is a confusion
 * with nothing to gain.
 */
function fileNameOf(id: DocumentId, format: DocumentFormat): string {
  return `${id.replace(':', '-')}.${format}`;
}

function booksDirectory(): Directory {
  const directory = new Directory(Paths.document, BOOKS_DIRECTORY);
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** Where this Document's bytes are kept. A pure function of its identity, which is what keeps the Library file free of paths. */
export function documentFile(id: DocumentId, format: DocumentFormat): File {
  return new File(booksDirectory(), fileNameOf(id, format));
}

/**
 * Keep these bytes as the Document's own file, and say where they went.
 *
 * `overwrite` is on because the destination is named by the hash of what is
 * being written: a file already there has these very bytes, and refusing would
 * be refusing to add a book the owner has added twice from two places.
 */
export function keepDocument(id: DocumentId, format: DocumentFormat, source: File, options: { move: boolean }): File {
  const destination = documentFile(id, format);
  if (options.move) source.moveSync(destination, { overwrite: true });
  else source.copySync(destination, { overwrite: true });
  return destination;
}

/**
 * What reading the Library file produced, in the terms the screen needs.
 *
 * `frozen` is ADR 0003's rule, kept: a file written by a **newer** build is left
 * alone — not merged, not rewritten, not deleted. The Library is shown empty and
 * says why, and nothing this build does may write over it. That is the designed
 * behaviour and not a bug to route around, so it is a flag a caller has to
 * carry rather than an exception it can swallow.
 */
export interface LoadedLibrary {
  entries: LibraryEntry[];
  /** Entries or fields that could not be read, reported rather than dropped in silence (ADR 0003). */
  problems: LibraryProblem[];
  /** Keys in the file this build does not know. Non-empty means another writer knows more about it than this one. */
  ignored: string[];
  /** The file is from a newer build. Nothing may be written until it is gone. */
  frozen: boolean;
  /** What went wrong reading it at all, in the words whatever refused used. Never swallowed (philosophy rule 1). */
  note: string | null;
}

const EMPTY: LoadedLibrary = { entries: [], problems: [], ignored: [], frozen: false, note: null };

/**
 * Read the Library. Once, at launch (ADR 0019).
 *
 * No file is not a problem — it is the first launch — and is told apart from a
 * file that would not parse, which is.
 */
export function readLibrary(): LoadedLibrary {
  const file = new File(Paths.document, LIBRARY_FILE);
  if (!file.exists) return EMPTY;

  let text: string;
  try {
    text = file.textSync();
  } catch (problem) {
    return { ...EMPTY, note: `The Library file could not be read: ${describe(problem)}` };
  }

  const parsed = parseLibrary(text);
  if (!parsed.ok) {
    if (parsed.reason === 'newer') {
      return {
        ...EMPTY,
        frozen: true,
        note:
          `The Library file was written by a newer version of ${APP_NAME} (version ${parsed.version}), so this one is ` +
          'leaving it alone rather than rewriting it and destroying what it knows. Update the app to read it.',
      };
    }
    return {
      ...EMPTY,
      note:
        parsed.reason === 'not-json'
          ? 'The Library file is not JSON. Nothing has been changed; it is still there to look at.'
          : 'The Library file is JSON but is not a Library. Nothing has been changed; it is still there to look at.',
    };
  }

  return { entries: parsed.entries, problems: parsed.problems, ignored: parsed.ignored, frozen: false, note: null };
}

/**
 * Write the Library. After every change (ADR 0019).
 *
 * **Throws** when the file that is there knows more than this build does.
 * `ignored` non-empty means another writer put keys in it that this parser did
 * not recognise, and rewriting strips exactly those keys, for every device, with
 * nothing reported — the defect ADR 0003 found in the desktop plugin's positions
 * file. The owner prefers a failure to a warning, and this is the one place the
 * failure can still be prevented.
 */
export function writeLibrary(entries: readonly LibraryEntry[], loaded: LoadedLibrary): void {
  if (loaded.frozen) {
    throw new Error(`The Library file is from a newer build of ${APP_NAME} and must be left alone (ADR 0003). Nothing was written.`);
  }
  if (loaded.ignored.length > 0) {
    throw new Error(
      `The Library file carries ${loaded.ignored.length} key(s) this build does not know (${loaded.ignored.join(', ')}). ` +
        'Rewriting it would strip them in silence, which is the defect ADR 0003 exists to prevent. Nothing was written.',
    );
  }
  new File(Paths.document, LIBRARY_FILE).write(serializeLibrary(entries));
}

/**
 * The Document Id of the bytes stored under this entry's **current** id, or null
 * where they cannot be read.
 *
 * The same two ranges and the same digest as adding a book (`document.ts`), and
 * for the same reason it is not a whole-file read: ADR 0004's amendment makes an
 * id 220,092 bytes of the owner's 34 MB novel rather than all of it.
 *
 * Null covers both a file that is not there and one `documentIdOf` **refuses** —
 * a file that is not a ZIP, a ZIP64 archive, a short read. ADR 0004 refuses
 * rather than falling back, so a refusal is an answer: this entry is left exactly
 * as it is, and the plan says how many were.
 */
function identifyStored(entry: LibraryEntry): DocumentId | null {
  const file = documentFile(entry.id, entry.format);
  if (!file.exists) return null;
  const handle = file.open(FileMode.ReadOnly);
  try {
    return documentIdOf({
      size: file.size,
      read: (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    });
  } catch {
    return null;
  } finally {
    handle.close();
  }
}

/** What the migration did, for the caller that holds the entries. */
export interface IdMigration {
  entries: readonly LibraryEntry[];
  /** What the owner is told, or null where there was nothing to tell them. */
  note: string | null;
}

/**
 * Bring a Library written under an older **Document Id rule** up to this one
 * (ADR 0004).
 *
 * Runs at launch, before anything reads an entry, and does nothing at all on
 * every launch after the first: the rule file records which rule the files are
 * named under, and a match means not one byte is read.
 *
 * `planIdMigration` decides and this performs, in the order that file says:
 * identify everything, then move every file, then write the Library **once**.
 *
 * It refuses to run at all on a Library this build may not write — ADR 0003's
 * frozen file, or one carrying keys this parser does not know. Renaming the files
 * of a Library that cannot be rewritten would point every migrated entry at
 * nothing, which is the worst outcome available here; and the rule file is left
 * unwritten, so an updated build finds the work still to do.
 */
export function migrateDocumentIds(loaded: LoadedLibrary): IdMigration {
  const unchanged: IdMigration = { entries: loaded.entries, note: null };
  const rule = new File(Paths.document, ID_RULE_FILE);
  let recorded: string | null = null;
  try {
    if (rule.exists) recorded = rule.textSync().trim();
  } catch {
    // Unreadable is the same as absent: the migration is safe to run again, and
    // refusing to launch over a file whose whole job is to say "already done"
    // would be the wrong way round.
    recorded = null;
  }
  if (recorded === DOCUMENT_ID_RULE) return unchanged;
  if (loaded.frozen || loaded.ignored.length > 0) return unchanged;

  const plan = planIdMigration(loaded.entries, identifyStored);
  if (plan.entries === loaded.entries) {
    // Nothing was named by an older rule — a first launch, or a shelf that is
    // empty. The rule is recorded anyway, so this is the last launch that reads
    // a book to find out.
    writeIdRule(rule);
    return unchanged;
  }

  try {
    for (const rename of plan.renames) {
      documentFile(rename.from, rename.format).moveSync(documentFile(rename.to, rename.format), { overwrite: true });
    }
    writeLibrary(plan.entries, loaded);
  } catch (problem) {
    return {
      entries: plan.entries,
      note:
        `The books on the shelf were renamed to match the way a document is now recognised, and the Library file could ` +
        `not be written: ${describe(problem)} The Library on screen and the file on disk have stopped agreeing.`,
    };
  }
  writeIdRule(rule);
  return { entries: plan.entries, note: migrationSentence(plan) };
}

/** Last, and only after the Library has been written: this file is what says the work does not have to be done again. */
function writeIdRule(rule: File): void {
  try {
    rule.write(DOCUMENT_ID_RULE);
  } catch {
    // Not worth a sentence to the owner. The cost of failing to record it is that
    // the next launch reads the shelf's files again and finds nothing to do.
  }
}

/**
 * This device, for a Stamp.
 *
 * Opaque, and it only ever has to differ between devices (`core/document/library.ts`).
 * Written down on first use because a Stamp that changes every launch decides
 * nothing: it is there to say which of two copies of an entry wins.
 *
 * `Math.random` rather than a UUID API: `crypto.randomUUID` is not among the
 * globals measured on this Hermes (notes/NOTES_2026-09-19.md, 12:21 and 13:20),
 * and not measured means not assumed.
 */
export function thisDevice(): string {
  const file = new File(Paths.document, DEVICE_FILE);
  if (file.exists) {
    const held = file.textSync().trim();
    if (held) return held;
  }
  const made = `device-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  file.write(made);
  return made;
}

function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}
