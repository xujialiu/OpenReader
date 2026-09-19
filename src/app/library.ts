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
 * ## Three things in this directory, and only one of them is shared
 *
 * - `library.json` — the Library, exactly as `serializeLibrary` writes it. This
 *   is the file ADR 0003 may one day sync, and it holds nothing device-local.
 * - `library/<document-id>.epub` — a Document's bytes, named by its Document Id.
 * - `this-device` — an opaque string that differs between devices, for the
 *   **Stamp** (CONTEXT.md). It is in its own file for the same reason the
 *   bookmark is not in the Library file: it means nothing anywhere else. It must
 *   survive a relaunch or the Stamp says nothing, which is why it is written
 *   down rather than generated per session.
 */

import { Directory, File, Paths } from 'expo-file-system';

import { APP_NAME } from '../../app-name';

import { serializeLibrary, parseLibrary, type DocumentId, type DocumentFormat, type LibraryEntry, type LibraryProblem } from '../core/document';

/** The Library itself. One file, rewritten whole (ADR 0019). */
const LIBRARY_FILE = 'library.json';

/** Where the Documents' bytes go. A subdirectory, so the Library file is not sitting among books. */
const BOOKS_DIRECTORY = 'library';

/** The device half of a Stamp. */
const DEVICE_FILE = 'this-device';

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
