/**
 * The **Library** while the app is running: read once at launch, written after
 * every change (ADR 0019).
 *
 * The file is the truth and this is a copy of it held for the length of a
 * session, which is the shape ADR 0019 picked over a database. Every mutation
 * below does the same two things in the same order — change the entries, write
 * the file — because a Library that is right in memory and stale on disk is a
 * Reading Position the owner loses to a force-quit, and losing a place is the
 * one failure this project is named after.
 *
 * The entries live in a **ref** and React state is a mirror of it. That is not a
 * style choice: writing the file is a side effect, a state updater must not have
 * one (React 19 calls updaters twice in development to catch exactly this), and
 * two changes can be in flight at once — a Reading Position arriving while a
 * book is still being hashed. One array, changed in one place, written in one
 * place.
 *
 * Nothing here sorts by anything but the **Stamp**. ADR 0019's "most recent
 * first" is `stamp.at` descending, and the Stamp is already the field
 * `core/document/library.ts` keeps for deciding which of two copies of an entry
 * wins — so there is no second notion of recency to disagree with it.
 */

import type { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { APP_NAME } from '../../app-name';
import type { DocumentId, LibraryEntry, ReadingPosition, VoiceChoice } from '../core/document';

import { addDocument } from './document';
import { migrateDocumentIds, readLibrary, thisDevice, writeLibrary, type LoadedLibrary } from './library';

/** What the Library screen shows and what the Reader route resolves a Document Id against. */
export interface Library {
  /** Most recent first. */
  entries: readonly LibraryEntry[];
  /** True until the file has been read. The screen says so rather than showing an empty Library that is a lie. */
  loading: boolean;
  /**
   * The last thing that went wrong, in the words whatever refused used.
   *
   * Shown, never swallowed (philosophy rule 1). A failed write is the one that
   * matters most: it means the file on disk and the list on the screen have
   * stopped agreeing, and the owner is entitled to know that before they close
   * the app.
   */
  note: string | null;
  /** Read a file, name it by its bytes, and put it in the Library. */
  add(source: File, options: { move: boolean }): Promise<LibraryEntry>;
  /** This Document is being opened: its Stamp moves to now, which is what puts it at the top of the list. */
  opened(id: DocumentId): void;
  /** What the document turned out to call itself, once epub.js has read its metadata. Ignored when it is empty or unchanged. */
  retitled(id: DocumentId, title: string): void;
  /** Where speech stopped (ADR 0008). Written through to the file like every other change. */
  reached(id: DocumentId, position: ReadingPosition): void;
  /**
   * The Voice this Document is read in (ADR 0010).
   *
   * Written when the owner chooses one while the book is open, and once more when a
   * Document that remembers none inherits the global default — which is the whole of
   * "opening one for the first time gives it whatever the default is at that moment,
   * and from then on the document keeps it". Unchanged when the entry already holds
   * this pair, so an open costs no write of its own.
   *
   * It does **not** move the Stamp. A Stamp is when this Document was last touched
   * by the owner, which is what orders the shelf, and `opened` has already moved it
   * a moment earlier; moving it again for a value the owner inherited rather than
   * chose would reorder the shelf for an open that already did.
   */
  voiced(id: DocumentId, voice: VoiceChoice): void;
  /**
   * Something went wrong out here rather than in the file — a book handed over
   * by another app that would not open, say.
   *
   * It shares the one note channel on purpose: the Library screen has one place
   * to put a sentence the owner has to read, and two would mean one of them is
   * the one nobody looks at.
   */
  report(note: string): void;
}

const byNewestFirst = (a: LibraryEntry, b: LibraryEntry): number => b.stamp.at - a.stamp.at;

const NOTHING_READ: LoadedLibrary = { entries: [], problems: [], ignored: [], frozen: false, note: null };

export function useLibrary(): Library {
  const [entries, setEntries] = useState<readonly LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  const entriesRef = useRef<readonly LibraryEntry[]>([]);
  /**
   * What the file said when it was read, kept for the whole session.
   *
   * `writeLibrary` needs it on every write and not just the first: `frozen` and
   * `ignored` are facts about the file this build is about to overwrite, and a
   * build that checks them once and then forgets is one that strips another
   * writer's keys on the second change rather than the first.
   */
  const loadedRef = useRef<LoadedLibrary>(NOTHING_READ);
  const deviceRef = useRef<string>('');

  /** Once, at launch (ADR 0019). */
  useEffect(() => {
    try {
      const loaded = readLibrary();
      loadedRef.current = loaded;
      deviceRef.current = thisDevice();
      /**
       * Before anything reads an entry, because an entry named under the rule ADR
       * 0004 replaced points at a file this build will not find by name — and the
       * owner's answer to that would be to add the book again, which costs them
       * the Reading Position that is the whole point of the entry (`document-ids.ts`).
       *
       * It reads nothing on any launch after the first: `library-id-rule` records
       * which rule the files are named under, and a match returns at once.
       */
      const migration = migrateDocumentIds(loaded);
      entriesRef.current = [...migration.entries].sort(byNewestFirst);
      setEntries(entriesRef.current);
      setNote(migration.note ?? loaded.note ?? problemSentence(loaded));
    } catch (problem) {
      setNote(`The Library could not be opened: ${describe(problem)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Change the entries and write the file, in that order and never one without the other. */
  const commit = useCallback((change: (was: readonly LibraryEntry[]) => readonly LibraryEntry[]) => {
    const next = [...change(entriesRef.current)].sort(byNewestFirst);
    entriesRef.current = next;
    setEntries(next);
    try {
      writeLibrary(next, loadedRef.current);
      setNote(null);
    } catch (problem) {
      setNote(`${describe(problem)} The Library on screen and the file on disk have stopped agreeing.`);
    }
  }, []);

  const stamp = useCallback(() => ({ at: Date.now(), device: deviceRef.current }), []);

  const add = useCallback(
    async (source: File, options: { move: boolean }): Promise<LibraryEntry> => {
      const added = await addDocument(source, options);
      /**
       * The same book added twice from two places is one entry (ADR 0019), and
       * the one it is is the one already in the Library: its Reading Position, its
       * Voice and the title epub.js gave it are each worth more than a second
       * reading of the same file name. Only the Stamp moves, which is what
       * brings it back to the top.
       */
      const existing = entriesRef.current.find((one) => one.id === added.identity.id);
      const entry: LibraryEntry = existing
        ? { ...existing, stamp: stamp() }
        : { ...added.identity, title: added.title, position: null, voice: null, stamp: stamp() };
      commit((was) => (existing ? was.map((one) => (one.id === entry.id ? entry : one)) : [...was, entry]));
      return entry;
    },
    [commit, stamp],
  );

  const change = useCallback(
    (id: DocumentId, how: (entry: LibraryEntry) => LibraryEntry) => {
      commit((was) => was.map((one) => (one.id === id ? how(one) : one)));
    },
    [commit],
  );

  const opened = useCallback((id: DocumentId) => change(id, (entry) => ({ ...entry, stamp: stamp() })), [change, stamp]);

  const retitled = useCallback(
    (id: DocumentId, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      if (entriesRef.current.find((one) => one.id === id)?.title === trimmed) return;
      change(id, (entry) => ({ ...entry, title: trimmed, stamp: stamp() }));
    },
    [change, stamp],
  );

  const reached = useCallback(
    (id: DocumentId, position: ReadingPosition) => change(id, (entry) => ({ ...entry, position, stamp: stamp() })),
    [change, stamp],
  );

  const voiced = useCallback(
    (id: DocumentId, voice: VoiceChoice) => {
      const held = entriesRef.current.find((one) => one.id === id)?.voice;
      if (held && held.provider === voice.provider && held.voice === voice.voice) return;
      change(id, (entry) => ({ ...entry, voice }));
    },
    [change],
  );

  const report = useCallback((said: string) => setNote(said), []);

  return { entries, loading, note, add, opened, retitled, reached, voiced, report };
}

/**
 * What a read that succeeded still has to say.
 *
 * `problems` and `ignored` are both ADR 0003's "report it, never drop it in
 * silence", and they mean different things: a problem is something this build
 * could not read, an ignored key is something another build knows and this one
 * does not. The second also stops the file being rewritten at all — in
 * `writeLibrary`, loudly — so it is said first and in those terms.
 */
function problemSentence(loaded: LoadedLibrary): string | null {
  if (loaded.ignored.length > 0) {
    return (
      `The Library file carries ${loaded.ignored.length} thing(s) this version of ${APP_NAME} does not understand ` +
      `(${loaded.ignored.join(', ')}), so it will not be rewritten — rewriting it would throw them away. ` +
      'Nothing in the Library can be changed until the app is updated.'
    );
  }
  if (loaded.problems.length > 0) {
    const lost = loaded.problems.filter((one) => one.dropped === 'entry').length;
    return lost > 0
      ? `${lost} entr${lost === 1 ? 'y' : 'ies'} in the Library file could not be read and ${lost === 1 ? 'is' : 'are'} not shown.`
      : `${loaded.problems.length} part(s) of the Library file could not be read. The entries they belong to are shown without them.`;
  }
  return null;
}

function describe(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}
