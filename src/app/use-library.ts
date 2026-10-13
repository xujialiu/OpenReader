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
 *
 * "Recent" is recently **heard** (#228): an entry's Stamp moves when the
 * Document is added (`add`), when speech in it is heard (`heard`), and when a
 * place heard on another device is adopted (`adopt`), and at nothing else. A
 * Document opened, looked at and left without Play stays where it was, and so
 * does one renamed.
 *
 * A Document is called by the name of the file it was added from, without its
 * extension, until the owner renames it (#226). The EPUB's own `dc:title` never
 * names it: the owner knows a book by the file they chose.
 */

import type { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { documentNameProblem, freeDocumentName, type FolderId, type FolderSnapshot, type FolderStore, type FolderTree } from '../core/folders';
import { openFolderStore } from './folder-storage';

import { APP_NAME } from '../../app-name';
import { nextStamp, stampPlace, type DocumentId, type LibraryEntry, type ReadingPlace, type VoiceChoice } from '../core/document';
import type { PositionsItem } from '../core/sync/positions-file';

import { identifyFile, keepFile } from './document';
import { displayNames, forgetDisplayName, saveDisplayName } from './display-names';
import { migrateDocumentIds, readLibrary, thisDevice, writeLibrary, type LoadedLibrary } from './library';
import { itemsOf, planAdoption, samePlace } from './sync-items';

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
  /**
   * Read a file, name it by its bytes, and put it in the Library.
   *
   * When the Folder it goes to already holds a Document of its name (#227),
   * `nameTaken` is asked whether to keep both, the new one under `free`; it
   * resolves null when the owner cancels, and nothing is kept. Without
   * `nameTaken` such an import is refused.
   */
  add(source: File, options: AddOptions): Promise<{ entry: LibraryEntry; duplicate: boolean } | null>;
  folders: FolderStore;
  folderSnapshot: FolderSnapshot;
  /**
   * Speech in this Document is being heard: its Stamp moves to now, which is what
   * puts it at the top of the list (#228). Called as the Reading starts speaking
   * and again as it goes on, so a Document heard until 11:00 here stays above one
   * heard until 10:30 on the desktop.
   */
  heard(id: DocumentId): void;
  rename(id: DocumentId, title: string): void;
  remove(id: DocumentId): void;
  /**
   * Where speech stopped (ADR 0008). Written through to the file like every
   * other change, **stamped here**: the renderer knows where speech is and this
   * is what knows the time and the device, and the position's Stamp is written
   * above whatever it held (`nextStamp`), so a slow clock cannot lose the place
   * it is reading to one it adopted a moment ago.
   *
   * It does not move the entry's own Stamp: a place is also written while the
   * Reading is paused (#96), which is not the Document being heard (#228).
   */
  reached(id: DocumentId, place: ReadingPlace): void;
  /** This device's Device Name (CONTEXT.md), which every Stamp written here carries. */
  device: string;
  /**
   * The entry as it is **now**, not as of the last render: read from the ref
   * that `commit` writes synchronously, for a caller that has just waited on a
   * sync and needs the position that sync adopted before React has drawn it.
   */
  current(id: DocumentId): LibraryEntry | null;
  /**
   * The shelf's positions as items of the Positions File, for the transport.
   * Read at the moment of a sync, not held: a position written a second ago is
   * in it.
   */
  positionsItems(): PositionsItem[];
  /**
   * Take every item newer than what the shelf holds, in one write. Returns the
   * Document Ids whose position moved. Nothing is taken from a Library this
   * build may not write (`frozen`, `ignored`) — the write would be refused, and
   * a shelf that disagrees with its file is the worse state.
   */
  adopt(items: readonly PositionsItem[]): readonly DocumentId[];
  /**
   * When each Document's position was last taken from another device, for the
   * one screen that has to notice — the Reader with that book open.
   */
  adoptedAt: Readonly<Partial<Record<DocumentId, number>>>;
  /**
   * The Voice this Document is read in (ADR 0010).
   *
   * Written when the owner chooses one while the book is open, and once more when a
   * Document that remembers none inherits the global default — which is the whole of
   * "opening one for the first time gives it whatever the default is at that moment,
   * and from then on the document keeps it". Unchanged when the entry already holds
   * this pair, so an open costs no write of its own.
   *
   * It does **not** move the Stamp, which orders the shelf by when each Document
   * was last heard (#228): a Voice chosen or inherited is not the Document being
   * read aloud.
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

export interface AddOptions {
  move: boolean;
  folder?: FolderId | null;
  nameTaken?(taken: { name: string; free: string; folder: FolderId | null }): Promise<boolean>;
}

const byNewestFirst = (a: LibraryEntry, b: LibraryEntry): number => b.stamp.at - a.stamp.at;

const NOTHING_READ: LoadedLibrary = { entries: [], problems: [], ignored: [], frozen: false, note: null };

export function useLibrary(): Library {
  const [folders] = useState(openFolderStore);
  const folderSnapshot = useSyncExternalStore(folders.subscribe, folders.getSnapshot);
  const readyRef = useRef(false);
  const [entries, setEntries] = useState<readonly LibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [adoptedAt, setAdoptedAt] = useState<Partial<Record<DocumentId, number>>>({});
  const [device, setDevice] = useState('');

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
      setDevice(deviceRef.current);
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
      const names = displayNames();
      entriesRef.current = migration.entries.map((entry) => names[entry.id] ? { ...entry, title: names[entry.id] } : entry).sort(byNewestFirst);
      setEntries(entriesRef.current);
      setNote(migration.note ?? loaded.note ?? problemSentence(loaded));
    } catch (problem) {
      setNote(`The Library could not be opened: ${describe(problem)}`);
    } finally {
      readyRef.current = true;
      setLoading(false);
    }
  }, []);

  /** Change the entries and write the file, in that order and never one without the other. */
  const commit = useCallback((change: (was: readonly LibraryEntry[]) => readonly LibraryEntry[], durable = false) => {
    const next = [...change(entriesRef.current)].sort(byNewestFirst);
    // Import/deletion may drive another durable store. Never tell it an entry
    // changed if the Library could not be written.
    if (durable) writeLibrary(next, loadedRef.current);
    entriesRef.current = next;
    setEntries(next);
    try {
      if (!durable) writeLibrary(next, loadedRef.current);
      setNote(null);
    } catch (problem) {
      setNote(`${describe(problem)} The Library on screen and the file on disk have stopped agreeing.`);
    }
  }, []);

  const stamp = useCallback(() => ({ at: Date.now(), device: deviceRef.current }), []);

  const add = useCallback(
    async (source: File, options: AddOptions): Promise<{ entry: LibraryEntry; duplicate: boolean } | null> => {
      if (!readyRef.current) throw new Error('The Library is still loading. Try again.');
      folders.writable();
      const destination = options.folder === undefined ? folders.getSnapshot().tree.current : options.folder;
      const added = await identifyFile(source);
      // If its destination disappeared while the source was read, use root.
      const parentOf = (tree: FolderTree) => destination !== null && !tree.folders.some((folder) => folder.id === destination) ? null : destination;
      /**
       * The same book added twice from two places is one entry (ADR 0019), and
       * the one it is is the one already in the Library: its Reading Position, its
       * Voice and its name are each worth more than a second reading of a file
       * name. A duplicate now asks before opening;
       * cancelling that alert must not move the entry or its Stamp (#121).
       *
       * Its file is still kept over the one in the Library, which is how adding
       * a book again brings back a file that has gone (`openDocument`).
       */
      const duplicate = () => {
        const existing = entriesRef.current.find((one) => one.id === added.identity.id);
        if (existing) keepFile(added, source, options);
        return existing ? { entry: existing, duplicate: true } : null;
      };
      folders.writable();
      const held = duplicate();
      if (held) return held;
      /**
       * Two Documents in one Folder are not called alike (#227). The owner is
       * asked before a second of the name appears there, and Keep Both gives the
       * new one the first free "name 2", "name 3"…. The Library can change while
       * the alert is up, so everything is decided again after the answer.
       */
      let tree = folders.getSnapshot().tree;
      const taken = documentNameProblem(tree, entriesRef.current, added.title, parentOf(tree));
      if (taken) {
        if (!options.nameTaken) throw new Error(`“${added.title}”: ${taken}`);
        const parent = parentOf(tree);
        if (!await options.nameTaken({ name: added.title, free: freeDocumentName(tree, entriesRef.current, added.title, parent), folder: parent })) return null;
        folders.writable();
        const meanwhile = duplicate();
        if (meanwhile) return meanwhile;
        tree = folders.getSnapshot().tree;
      }
      const parent = parentOf(tree);
      const title = freeDocumentName(tree, entriesRef.current, added.title, parent);
      /**
       * A name given to this Document before it was deleted is not its name now
       * (#180): it would stay off the screen until the next launch, then come
       * back over the file's name, perhaps onto a namesake in the Folder. It is
       * dropped here rather than at the deletion, so a name left by a deletion
       * before this rule goes too, and before the file is kept, so a failed
       * write refuses the import and keeps nothing.
       */
      if (displayNames()[added.identity.id] !== undefined) forgetDisplayName(added.identity.id);
      keepFile(added, source, options);
      const entry: LibraryEntry = { ...added.identity, title, position: null, voice: null, stamp: stamp() };
      // Membership is saved first: an interrupted import may leave an unused
      // mapping, but can never expose a successfully imported book in the wrong folder.
      folders.place(entry.id, parent);
      commit((was) => [...was, entry], true);
      return { entry, duplicate: false };
    },
    [commit, stamp, folders],
  );

  const change = useCallback(
    (id: DocumentId, how: (entry: LibraryEntry) => LibraryEntry) => {
      commit((was) => was.map((one) => (one.id === id ? how(one) : one)));
    },
    [commit],
  );

  const heard = useCallback((id: DocumentId) => change(id, (entry) => ({ ...entry, stamp: stamp() })), [change, stamp]);

  const reached = useCallback(
    (id: DocumentId, place: ReadingPlace) => {
      // The sentence the entry already holds: nothing moved, nothing is written,
      // and the Stamp it carries — the desktop's, when the place came from
      // there — stands (`samePlace`).
      const held = entriesRef.current.find((one) => one.id === id);
      if (held?.position && samePlace(held.position, place, held.format)) return;
      change(id, (entry) => ({
        ...entry,
        position: stampPlace(place, nextStamp(Date.now(), deviceRef.current, entry.position?.stamp)),
      }));
    },
    [change],
  );

  const positionsItems = useCallback(() => itemsOf(entriesRef.current, deviceRef.current), []);
  const current = useCallback((id: DocumentId) => entriesRef.current.find((one) => one.id === id) ?? null, []);

  const adopt = useCallback(
    (items: readonly PositionsItem[]): readonly DocumentId[] => {
      if (loadedRef.current.frozen || loadedRef.current.ignored.length > 0) return [];
      const plan = planAdoption(entriesRef.current, items);
      if (plan.adopted.length === 0) return [];
      commit(() => plan.entries);
      const now = Date.now();
      setAdoptedAt((was) => {
        const next = { ...was };
        for (const id of plan.adopted) next[id] = now;
        return next;
      });
      return plan.adopted;
    },
    [commit],
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

  /** Refused, as a Folder's rename is, when the Document's Folder holds another of the name (#227). */
  const rename = useCallback((id: DocumentId, title: string) => {
    if (title.trim()) {
      const tree = folders.getSnapshot().tree;
      const problem = documentNameProblem(tree, entriesRef.current, title, tree.documents[id] ?? null, id);
      if (problem) throw new Error(problem);
      saveDisplayName(id, title.trim());
      change(id, (entry) => ({ ...entry, title: title.trim() }));
    }
  }, [change, folders]);
  const remove = useCallback((id: DocumentId) => commit((was) => was.filter((entry) => entry.id !== id), true), [commit]);
  return { folders, folderSnapshot, entries, loading, note, add, heard, rename, remove, reached, voiced, report, device, current, positionsItems, adopt, adoptedAt };
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
