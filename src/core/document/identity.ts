/**
 * What a **Document** is called, and how two copies of one are recognised as
 * the same (ADR 0004), together with which format it is (ADR 0007).
 *
 * The rule is one sentence: the name comes from the document's own contents, not
 * from a library that holds them. The phone has no Zotero library, so it cannot
 * produce the `{ libraryID, itemKey }` pair the desktop plugin uses, and content
 * addressing is what lets two of the owner's own devices agree on a document
 * with no catalogue between them.
 *
 * **The name is not a hash of the file.** ADR 0004's amendment: it is a SHA-256
 * over the archive's own central directory — `(name, CRC-32, uncompressed size)`
 * per member, members sorted by name, behind a version prefix. Two reasons, and
 * the second is the better one:
 *
 * - Hashing the owner's 34,453,009-byte novel on Hermes took **14,362 ms** with
 *   the JavaScript thread held for all of it. The manifest is 220,092 bytes.
 * - A ZIP's CRC-32 is over each member's **uncompressed** bytes, so the id
 *   survives re-compression. The same book repacked at another deflate level is
 *   the same Document, which a file hash said it was not.
 *
 * **Nothing here opens a file.** ADR 0013 keeps the file system above `core/`,
 * and the seam is `ArchiveBytes` in `zip.ts`: a length and a function returning
 * an exact range. It is not a `Uint8Array` any more, and that is the point —
 * handing this a whole file would put the 34 MB read back in the caller.
 *
 * Both identifiers are recorded, **with the manifest digest authoritative**,
 * because each covers the other's failure: the digest is unambiguous but changes
 * when any member's contents change, and `dc:identifier` survives an edit but is
 * often missing or duplicated in real EPUBs.
 */

import { sha256Hex } from './sha256';
import { readCentralDirectory, type ArchiveBytes, type ZipMember } from './zip';

/**
 * Every format that can be read. ADR 0007: only EPUB today, and **nothing may
 * assume it** — a Document records which format it is, so adding `'pdf'` here
 * is what adding PDF looks like from this directory's point of view.
 */
export const DOCUMENT_FORMATS = ['epub'] as const;

export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** `value` as a format this build knows, or null. Used by the store's parser, where the string came out of a file. */
export function asDocumentFormat(value: unknown): DocumentFormat | null {
  return typeof value === 'string' && (DOCUMENT_FORMATS as readonly string[]).includes(value) ? (value as DocumentFormat) : null;
}

declare const documentId: unique symbol;

/**
 * A **Document Id**: `sha256:` and 64 lowercase hex characters over the
 * document's own manifest.
 *
 * Self-describing on purpose. A bare hex string says nothing about what produced
 * it, so the day a stronger digest is wanted, an id written by the older build
 * is recognisable as one rather than silently compared against a
 * differently-computed string of the same length — the same reason ADR 0003
 * wants a `version` in a file.
 *
 * **What the prefix distinguishes, and what it does not.** It names the digest,
 * SHA-256, and nothing else. It does not name *what was digested*: an id from
 * the rule ADR 0004 replaced — SHA-256 of the whole file — has this exact shape
 * and cannot be told apart from one computed here. That is deliberate and it is
 * why the digest input carries `DOCUMENT_ID_RULE` as its first line instead:
 * changing the rule changes every id's hex, loudly, and the old ids are dealt
 * with by ADR 0004's migration, which is that the shelf's books are added again.
 * Renaming the prefix would have been the louder signal and would also have
 * renamed the file each Document's bytes are kept under (`src/app/library.ts`,
 * ADR 0019), which is a wider change than the three books it would protect.
 *
 * Branded so it cannot be crossed with a title, a file name or a
 * `dc:identifier`, all of which are also strings. `asDocumentId` is the only
 * way in from outside, and it validates.
 */
export type DocumentId = string & { readonly [documentId]: 'DocumentId' };

/** The prefix every Document Id carries, and the algorithm it names. */
export const DOCUMENT_ID_PREFIX = 'sha256:';

const DOCUMENT_ID = /^sha256:[0-9a-f]{64}$/;

/**
 * The first line of every manifest digested, and the only thing in an id that
 * says which rule produced it.
 *
 * ADR 0004 asks for "a version string so this rule can be replaced without
 * silently changing ids". It is inside the digest rather than beside it because
 * a version nobody hashes is a version a second implementation can forget: with
 * it here, any change to the framing below must change this line too or every id
 * in the owner's Library silently becomes a different one.
 */
export const DOCUMENT_ID_RULE = 'epub-zip-v1';

/**
 * The exact bytes a Document Id is a digest of: the version line, then one line
 * per member of the archive's central directory.
 *
 * ```
 * epub-zip-v1\n
 * <name>\0<crc32>\0<uncompressed size>\n     … once per member, sorted
 * ```
 *
 * Exported because it is the rule itself, and a digest is the worst place to
 * read one from: a test can compare these bytes and see the framing, the sort
 * and the version line separately, instead of watching one hex string change and
 * having to guess which of the three moved.
 *
 * Three decisions in that one line of framing, each of which would otherwise be
 * found out later:
 *
 * - **Sorted, because a repacker may emit members in another order** (ADR 0004).
 *   By the name's bytes, then by CRC-32, then by size — the tie-breaks are what
 *   make the order *total*. An archive can legally hold two members of the same
 *   name, and sorting on the name alone would leave their order to whatever the
 *   packer did, which is the one thing being sorted away.
 * - **The name is the archive's own bytes, not a decoded string.** A member name
 *   is UTF-8 only when general-purpose bit 11 says so; decoding a CP437 name
 *   yields U+FFFD, and two different names can decode to the same replacement
 *   characters and collapse into one line. For a conforming EPUB — whose names
 *   are UTF-8 — this is byte-for-byte the same manifest either way.
 * - **NUL separates, so a NUL in a name is refused** (`zip.ts`). Otherwise
 *   `a\0b` with one field would frame identically to `a` with another.
 *
 * The numbers are decimal, which is the shape the measurement in ADR 0004 was
 * taken with; any spelling would do, and changing this one means changing
 * `DOCUMENT_ID_RULE` with it.
 */
export function documentManifest(archive: ArchiveBytes): Uint8Array {
  const members = readCentralDirectory(archive).sort(byNameThenContents);
  const lines = members.map(manifestLine);
  const rule = asciiBytes(`${DOCUMENT_ID_RULE}\n`);
  const manifest = new Uint8Array(lines.reduce((total, line) => total + line.length, rule.length));
  manifest.set(rule);
  let at = rule.length;
  for (const line of lines) {
    manifest.set(line, at);
    at += line.length;
  }
  return manifest;
}

function manifestLine(member: ZipMember): Uint8Array {
  const numbers = asciiBytes(`\u0000${member.crc32}\u0000${member.uncompressedSize}\n`);
  const line = new Uint8Array(member.name.length + numbers.length);
  line.set(member.name);
  line.set(numbers, member.name.length);
  return line;
}

/** The archive's own byte order for names, so the sort does not depend on a decoder or on a locale. */
function byNameThenContents(a: ZipMember, b: ZipMember): number {
  const shorter = Math.min(a.name.length, b.name.length);
  for (let at = 0; at < shorter; at++) {
    if (a.name[at] !== b.name[at]) return a.name[at] - b.name[at];
  }
  if (a.name.length !== b.name.length) return a.name.length - b.name.length;
  if (a.crc32 !== b.crc32) return a.crc32 - b.crc32;
  return a.uncompressedSize - b.uncompressedSize;
}

/**
 * The version line and the numbers, as bytes. Both are ASCII by construction — a
 * decimal number, a NUL, a newline — so the characters *are* the encoding.
 * `TextEncoder` is on this Hermes (notes/NOTES_2026-09-19.md, 12:21) and would do
 * the same thing; this is one fewer allocation per member, on a path that runs
 * 2,106 times for the owner's book.
 */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let at = 0; at < text.length; at++) bytes[at] = text.charCodeAt(at);
  return bytes;
}

/**
 * The Document Id of this archive.
 *
 * The whole of identity that is authoritative. Everything else on a
 * `DocumentIdentity` is evidence about a document whose contents have changed.
 *
 * Reads two ranges of the archive and digests what they say, rather than reading
 * and digesting the file: 220,092 bytes read and 94,876 digested on the owner's
 * 34,453,009-byte book (ADR 0004). Throws when the archive is not one this
 * build can read — it does not fall back to hashing the file, because a book
 * with two possible ids depending on which path ran is the one thing an identity
 * may not be.
 */
export function documentIdOf(archive: ArchiveBytes): DocumentId {
  return `${DOCUMENT_ID_PREFIX}${sha256Hex(documentManifest(archive))}` as DocumentId;
}

/** `value` as a Document Id, or null when it is not one. The store's parser reads ids out of a file, where anything could be. */
export function asDocumentId(value: unknown): DocumentId | null {
  return typeof value === 'string' && DOCUMENT_ID.test(value) ? (value as DocumentId) : null;
}

/**
 * How a document's own `dc:identifier` was arrived at — which is not
 * decoration, because ADR 0004 records that the field is "often missing or
 * duplicated in real EPUBs" and those two failures are different.
 *
 * - `unique-identifier` — the package element named which of its identifiers is
 *   the publication's. This is the one EPUB actually specifies, and the only
 *   one worth matching two files on.
 * - `only` — one identifier declared and no `unique-identifier` attribute. As
 *   good as the above, since there is nothing to choose between.
 * - `first-of-several` — several declared and none named. The first in document
 *   order is recorded so the fact is not lost, but it is **not** matched on: a
 *   list of identifiers is as likely to hold a series ISBN or a publisher's
 *   internal number as the book's own.
 * - `none` — no identifier at all. The manifest digest is the only name the
 *   document has.
 */
export type PublicationIdSource = 'unique-identifier' | 'only' | 'first-of-several' | 'none';

/** Every `dc:identifier` a package document declares, and which of them it names as the publication's own. */
export interface PackageIdentifiers {
  /** In document order, entity-decoded and trimmed. Empty elements are left out: an empty identifier is an absent one. */
  all: readonly string[];
  /** The identifier the package's `unique-identifier` attribute points at, when it points at one that exists. */
  unique: string | null;
}

/** A Document's name, as the Library records it. */
export interface DocumentIdentity {
  /** The digest over the archive's manifest. Authoritative (ADR 0004). */
  id: DocumentId;
  /** Which format this is, recorded rather than assumed (ADR 0007). */
  format: DocumentFormat;
  /**
   * The document's own identifier — an EPUB's `dc:identifier` — or null.
   *
   * Secondary. It is what survives a change to the contents that changes `id` —
   * a converter that re-splits the chapters, a shop that ships a different
   * edition of the same book — and it never decides identity by itself; see
   * `matchIdentities`. Re-compression alone no longer needs it: that does not
   * change `id` any more.
   */
  publicationId: string | null;
  publicationIdSource: PublicationIdSource;
}

/**
 * Identity from an archive, a format, and whatever the format's own metadata
 * said.
 *
 * `publication` is optional because it can genuinely be unavailable — a
 * document whose package document would not parse still has a digest, and a
 * digest is enough to name it. Absent metadata and metadata with no identifier
 * in it both come out as `publicationIdSource: 'none'`, because from here they
 * are the same fact: the document did not say.
 */
export function identifyDocument(archive: ArchiveBytes, format: DocumentFormat, publication?: PackageIdentifiers | null): DocumentIdentity {
  const [publicationId, publicationIdSource] = choosePublicationId(publication);
  return { id: documentIdOf(archive), format, publicationId, publicationIdSource };
}

function choosePublicationId(publication?: PackageIdentifiers | null): [string | null, PublicationIdSource] {
  if (!publication || !publication.all.length) return [null, 'none'];
  if (publication.unique) return [publication.unique, 'unique-identifier'];
  if (publication.all.length === 1) return [publication.all[0], 'only'];
  return [publication.all[0], 'first-of-several'];
}

/**
 * What two identities say about each other.
 *
 * - `same-contents` — the same Document Id. Definitive, and the only answer that
 *   is. **Not** "the same bytes": since ADR 0004's amendment the id is over the
 *   archive's manifest, so a copy repacked at another compression level is this
 *   answer and not the next one. That is the amendment's point, and calling this
 *   `same-bytes` would tell a reader the opposite.
 * - `same-publication` — different contents, but both documents name the same
 *   publication **unambiguously** (`unique-identifier` or `only`). That is a
 *   copy whose members are genuinely not the same — a converter that re-split
 *   the chapters, another shop's edition — which is the failure ADR 0004 records
 *   the second identifier to cover. It is a candidate, not a verdict: the caller
 *   decides whether to carry a Reading Position across, and nothing here does it
 *   silently.
 * - `different` — everything else, including two documents that share a
 *   `first-of-several` identifier. Attaching one book's position to another
 *   book is the drift this project exists to prevent (philosophy rule 1), so
 *   the ambiguous case is refused rather than guessed.
 */
export type IdentityMatch = 'same-contents' | 'same-publication' | 'different';

export function matchIdentities(a: DocumentIdentity, b: DocumentIdentity): IdentityMatch {
  if (a.id === b.id) return 'same-contents';
  if (a.format !== b.format) return 'different';
  if (!a.publicationId || a.publicationId !== b.publicationId) return 'different';
  return unambiguous(a) && unambiguous(b) ? 'same-publication' : 'different';
}

const unambiguous = (identity: DocumentIdentity): boolean =>
  identity.publicationIdSource === 'unique-identifier' || identity.publicationIdSource === 'only';

/**
 * The `dc:identifier`s of an EPUB package document, read out of its text with
 * regular expressions.
 *
 * Regular expressions and not a DOM, for the reason `core/webdav.ts` parses
 * PROPFIND replies the same way (ADR 0003, and `src/core/README.md` names it
 * the house pattern): there is no DOM under `src/core/`, and an XML parser
 * would be a dependency and a platform question for four attributes.
 *
 * The cost is stated rather than hidden: an attribute value containing a `>`
 * would defeat the element scan. Nothing in EPUB's metadata has a reason to
 * carry one, and the failure is a missing secondary identifier — the hash still
 * names the document — rather than a wrong one.
 *
 * The caller may not have this text at all. Where the bytes are handed to
 * epub.js and it reports the identifier already parsed, build a
 * `PackageIdentifiers` from what it says; this function is for a caller holding
 * the OPF itself.
 */
export function readPackageIdentifiers(opf: string): PackageIdentifiers {
  // Comments first, so a commented-out identifier is not read as one. That is
  // a real shape in hand-edited EPUBs, and it would otherwise win on document
  // order.
  const text = opf.replace(/<!--[\s\S]*?-->/g, '');

  const unique = /<(?:[\w.-]+:)?package\b[^>]*\bunique-identifier\s*=\s*(["'])([\s\S]*?)\1/i.exec(text);
  const uniqueRef = unique ? decodeXml(unique[2]).trim() : null;

  const all: string[] = [];
  let uniqueValue: string | null = null;
  // The self-closing form is the **first** alternative, and that order is the
  // whole correctness of this regex. Tried second, the paired form matches
  // `<dc:identifier id="a"/>` as an opening tag, swallows everything up to the
  // next closing tag, and the identifier after the empty one is lost.
  const element = /<(?:[\w.-]+:)?identifier\b([^>]*?)\/>|<(?:[\w.-]+:)?identifier\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?identifier\s*>/gi;
  for (let found = element.exec(text); found; found = element.exec(text)) {
    if (found[1] !== undefined) continue; // self-closing: no text, so no value
    const attrs = found[2] ?? '';
    const value = decodeXml(uncdata(found[3] ?? '')).trim();
    if (!value) continue;
    all.push(value);
    const id = /\bid\s*=\s*(["'])([\s\S]*?)\1/i.exec(attrs);
    if (uniqueRef && id && decodeXml(id[2]).trim() === uniqueRef) uniqueValue ??= value;
  }
  return { all, unique: uniqueValue };
}

const uncdata = (text: string): string => text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** The five predefined XML entities and numeric character references. An identifier is a URN or a URL, and both can hold an `&`. */
function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
