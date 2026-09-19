/**
 * What a store persists about a Document, and how it reads it back.
 *
 * One **Library entry** per Document: its identity (ADR 0004), its format
 * (ADR 0007), what to call it, its Reading Position (ADR 0008) and its Voice
 * (ADR 0010). An entry *is* a `DocumentIdentity` plus the four things the
 * Library remembers, which is why it extends one rather than copying its fields.
 *
 * ## The version rule, and why it shapes this file
 *
 * No WebDAV is built here. But ADR 0003 verified three properties of the format
 * the desktop plugin already writes, and two of them constrain the record from
 * the first line:
 *
 * - **A parser rejects a file whose `version` is higher than it knows, and the
 *   caller leaves it alone.** `parseLibrary` returns `{ ok: false, reason:
 *   'newer' }` and no entries. Not "reads what it recognises" — a newer writer
 *   may have changed what the fields it *does* recognise mean.
 * - **New information goes in a new file, never a new field.** The plugin's
 *   positions file is serialised canonically to exactly four fields per entry,
 *   so an older build silently strips anything added to an entry, for every
 *   machine, with nothing reported. An unknown file name is free; a version bump
 *   is not.
 *
 * Two consequences are built in. The version lives on the **file** and nowhere
 * else — a second version policy per entry is the mistake ADR 0003 found, where
 * the plugin's three files do not agree on one. And every key this parser does
 * not know is **reported** in `ignored` rather than dropped in silence, because
 * silent stripping is the defect, not the parse. A caller that finds `ignored`
 * or `problems` non-empty is looking at a file some other writer knows more
 * about than this build does, and rewriting it is how that writer's data is
 * destroyed.
 *
 * A future version 2 therefore adds no field here. It adds a sibling file, keyed
 * by Document Id — which is what makes the Document Id of ADR 0004 the join, and
 * why it is a content hash rather than something only one device can mint.
 */

import { createLocator, readLocator, type ReadingPosition } from './position';
import { asDocumentFormat, asDocumentId, type DocumentFormat, type DocumentId, type DocumentIdentity, type PublicationIdSource } from './identity';
import type { TextAnchor } from './anchor';

/** The only version this build writes, and the highest it will read. */
export const LIBRARY_VERSION = 1;

/**
 * A **Stamp** (CONTEXT.md): when an entry was last written and which device
 * wrote it, used to decide which of two copies of an entry wins.
 *
 * Here from the start even though nothing merges yet, because under ADR 0003
 * adding it later is the expensive move — an older reader strips a field it does
 * not know, silently, on every machine.
 *
 * `at` is wall-clock milliseconds since the epoch. A number rather than a
 * formatted date because a number has one spelling and a date string has
 * several, and two devices comparing spellings is not a comparison.
 */
export interface Stamp {
  at: number;
  /** Which device wrote it. Opaque to this module: it only ever has to differ between devices. */
  device: string;
}

/**
 * The **Voice** a Document is read in (ADR 0010): a document keeps its own, and
 * changing the global default does not change a document already being read.
 *
 * `provider` is a string and not the provider layer's `ProviderId` on purpose.
 * An entry written by a build with one more provider than this one must still be
 * readable — losing a Reading Position because the Voice names something
 * unfamiliar would be the worst possible trade — so the pair is carried as
 * written and validated where a provider is actually created.
 */
export interface VoiceChoice {
  provider: string;
  voice: string;
}

/** One Library entry: the owner adds a Document once and this is what stays. */
export interface LibraryEntry extends DocumentIdentity {
  /** What to call the Document. The file's own name when the document does not say (`src/app/document.ts`). */
  title: string;
  /** Where speech stopped. Null until the owner has read some of it. */
  position: ReadingPosition | null;
  /** Null means this Document has not been opened yet and will inherit whatever the global default is at that moment (ADR 0010). */
  voice: VoiceChoice | null;
  stamp: Stamp;
}

/**
 * The entries as a file, canonically: fixed key order, fixed field set, every
 * field present even when null.
 *
 * Canonical so that two devices holding the same entries produce the same bytes,
 * which is what lets a sync compare files rather than parse and diff them. Fixed
 * field set because ADR 0003 says a new field is not how this format grows.
 *
 * **Throws** when an entry's position is in a different format from the entry —
 * a locator built for one format cannot be written into a record that claims
 * another. That is a programming error in this app rather than bad data from a
 * file, and a loud failure at the moment of writing is the only place it can be
 * noticed at all.
 */
export function serializeLibrary(entries: readonly LibraryEntry[]): string {
  return JSON.stringify(
    {
      version: LIBRARY_VERSION,
      entries: entries.map((entry) => ({
        id: entry.id,
        format: entry.format,
        publicationId: entry.publicationId,
        publicationIdSource: entry.publicationIdSource,
        title: entry.title,
        position: entry.position ? serializePosition(entry, entry.position) : null,
        voice: entry.voice ? { provider: entry.voice.provider, voice: entry.voice.voice } : null,
        stamp: { at: entry.stamp.at, device: entry.stamp.device },
      })),
    },
    null,
    2,
  );
}

function serializePosition(entry: LibraryEntry, position: ReadingPosition) {
  const locator = readLocator(position.locator, entry.format);
  if (locator === null) {
    throw new Error(`Library entry ${entry.id} is ${entry.format} but its Reading Position is a locator for another format.`);
  }
  return {
    locator,
    anchor: { exact: position.anchor.exact, prefix: position.anchor.prefix, suffix: position.anchor.suffix },
  };
}

/** Something in the file that could not be read, reported rather than dropped in silence (ADR 0003). */
export interface LibraryProblem {
  /** Index in the file's `entries`, so a report can name which one. */
  at: number;
  /** The entry's Document Id, when it had a well-formed one. */
  id: DocumentId | null;
  /**
   * What was lost. `'entry'` means the whole entry, because nothing about it
   * could be trusted; the others mean the entry was kept without that part,
   * which is the better trade — an unreadable Voice must not cost the owner a
   * Reading Position.
   */
  dropped: 'entry' | 'title' | 'position' | 'voice' | 'stamp';
  why: 'not-an-object' | 'id' | 'format' | 'malformed';
}

/**
 * What reading a Library file produced.
 *
 * `reason: 'newer'` is the one ADR 0003 cares about most: **the caller must
 * leave that file alone.** Not merge it, not rewrite it, not delete it. A file
 * written by a newer build stops this one from syncing it until its owner
 * updates, and that is the designed behaviour rather than a bug to route around.
 */
export type LibraryParse =
  | {
      ok: true;
      /** The version the file declared. Lower than `LIBRARY_VERSION` is fine and is read. */
      version: number;
      entries: LibraryEntry[];
      problems: LibraryProblem[];
      /**
       * Every key this build does not know, by path — `entries[2].readingSpeed`.
       *
       * Non-empty means another writer knows more about this file than this
       * build does. Rewriting it would strip exactly those keys, for every
       * device, with nothing reported: the defect ADR 0003 found in the existing
       * positions file.
       */
      ignored: string[];
    }
  | { ok: false; reason: 'not-json' | 'not-a-library' }
  | { ok: false; reason: 'newer'; version: number };

const FILE_KEYS = ['version', 'entries'];
const ENTRY_KEYS = ['id', 'format', 'publicationId', 'publicationIdSource', 'title', 'position', 'voice', 'stamp'];
const POSITION_KEYS = ['locator', 'anchor'];
const ANCHOR_KEYS = ['exact', 'prefix', 'suffix'];
const VOICE_KEYS = ['provider', 'voice'];
const STAMP_KEYS = ['at', 'device'];

const SOURCES: readonly PublicationIdSource[] = ['unique-identifier', 'only', 'first-of-several', 'none'];

/**
 * Read a Library file.
 *
 * Defensive throughout, and asymmetrically so: a malformed *file* is refused
 * whole, a malformed *entry* costs that entry, and a malformed field inside a
 * sound entry costs only that field. One corrupt entry must not take the owner's
 * other positions with it.
 */
export function parseLibrary(text: string): LibraryParse {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!isRecord(file) || !Array.isArray(file.entries)) return { ok: false, reason: 'not-a-library' };

  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, reason: 'not-a-library' };
  if (version > LIBRARY_VERSION) return { ok: false, reason: 'newer', version };

  const problems: LibraryProblem[] = [];
  const ignored: string[] = [];
  collectUnknown(file, FILE_KEYS, '', ignored);

  const entries: LibraryEntry[] = [];
  file.entries.forEach((raw: unknown, at: number) => {
    const entry = parseEntry(raw, at, problems, ignored);
    if (entry) entries.push(entry);
  });
  return { ok: true, version, entries, problems, ignored };
}

function parseEntry(raw: unknown, at: number, problems: LibraryProblem[], ignored: string[]): LibraryEntry | null {
  if (!isRecord(raw)) {
    problems.push({ at, id: null, dropped: 'entry', why: 'not-an-object' });
    return null;
  }
  collectUnknown(raw, ENTRY_KEYS, `entries[${at}].`, ignored);

  const id = asDocumentId(raw.id);
  if (!id) {
    problems.push({ at, id: null, dropped: 'entry', why: 'id' });
    return null;
  }
  // An unrecognised format is a Document this build cannot render — a PDF entry
  // written by a later one (ADR 0007). The entry goes, because nothing here
  // could act on it, and it is reported, because writing the file back without
  // it is how that entry is destroyed.
  const format = asDocumentFormat(raw.format);
  if (!format) {
    problems.push({ at, id, dropped: 'entry', why: 'format' });
    return null;
  }

  let title = '';
  if (typeof raw.title === 'string') title = raw.title;
  else problems.push({ at, id, dropped: 'title', why: 'malformed' });

  return {
    id,
    format,
    publicationId: typeof raw.publicationId === 'string' && raw.publicationId ? raw.publicationId : null,
    publicationIdSource: SOURCES.includes(raw.publicationIdSource as PublicationIdSource) ? (raw.publicationIdSource as PublicationIdSource) : 'none',
    title,
    position: parsePosition(raw.position, format, at, id, problems, ignored),
    voice: parseVoice(raw.voice, at, id, problems, ignored),
    stamp: parseStamp(raw.stamp, at, id, problems, ignored),
  };
}

/**
 * A position out of a file.
 *
 * The locator is rebuilt in the **entry's own format**, which is the only format
 * it could be in: the file records the string, and what dialect that string is
 * written in is the Document's format and nothing else. That is also why the
 * file does not store a format per locator — it would be a second copy of one
 * fact, free to disagree with the first.
 */
function parsePosition(
  raw: unknown,
  format: DocumentFormat,
  at: number,
  id: DocumentId,
  problems: LibraryProblem[],
  ignored: string[],
): ReadingPosition | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    problems.push({ at, id, dropped: 'position', why: 'malformed' });
    return null;
  }
  collectUnknown(raw, POSITION_KEYS, `entries[${at}].position.`, ignored);
  const anchorRaw = raw.anchor;
  if (typeof raw.locator !== 'string' || !raw.locator || !isRecord(anchorRaw)) {
    problems.push({ at, id, dropped: 'position', why: 'malformed' });
    return null;
  }
  collectUnknown(anchorRaw, ANCHOR_KEYS, `entries[${at}].position.anchor.`, ignored);
  // A position with no quotation is a bare locator, and ADR 0008 exists because
  // a bare locator resolves silently to the wrong node. It is refused rather
  // than resolved unverified.
  if (typeof anchorRaw.exact !== 'string' || !anchorRaw.exact) {
    problems.push({ at, id, dropped: 'position', why: 'malformed' });
    return null;
  }
  const anchor: TextAnchor = {
    exact: anchorRaw.exact,
    prefix: typeof anchorRaw.prefix === 'string' ? anchorRaw.prefix : '',
    suffix: typeof anchorRaw.suffix === 'string' ? anchorRaw.suffix : '',
  };
  return { locator: createLocator(format, raw.locator), anchor };
}

function parseVoice(raw: unknown, at: number, id: DocumentId, problems: LibraryProblem[], ignored: string[]): VoiceChoice | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    problems.push({ at, id, dropped: 'voice', why: 'malformed' });
    return null;
  }
  collectUnknown(raw, VOICE_KEYS, `entries[${at}].voice.`, ignored);
  if (typeof raw.provider !== 'string' || !raw.provider || typeof raw.voice !== 'string' || !raw.voice) {
    problems.push({ at, id, dropped: 'voice', why: 'malformed' });
    return null;
  }
  return { provider: raw.provider, voice: raw.voice };
}

/**
 * A Stamp out of a file, or the oldest possible one.
 *
 * `at: 0` rather than "now": a Stamp decides which of two copies of an entry
 * wins, and an entry whose own Stamp could not be read must lose that comparison
 * rather than win it by accident of when it was parsed.
 */
function parseStamp(raw: unknown, at: number, id: DocumentId, problems: LibraryProblem[], ignored: string[]): Stamp {
  if (isRecord(raw)) {
    collectUnknown(raw, STAMP_KEYS, `entries[${at}].stamp.`, ignored);
    if (typeof raw.at === 'number' && Number.isFinite(raw.at) && typeof raw.device === 'string') {
      return { at: raw.at, device: raw.device };
    }
  }
  problems.push({ at, id, dropped: 'stamp', why: 'malformed' });
  return { at: 0, device: '' };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function collectUnknown(value: Record<string, unknown>, known: readonly string[], path: string, into: string[]): void {
  for (const key of Object.keys(value)) if (!known.includes(key)) into.push(`${path}${key}`);
}
