/**
 * What a **Document** is called, and how two copies of one are recognised as
 * the same (ADR 0004), together with which format it is (ADR 0007).
 *
 * The rule is one sentence: the name comes from the bytes, not from a library
 * that holds them. The phone has no Zotero library, so it cannot produce the
 * `{ libraryID, itemKey }` pair the desktop plugin uses, and content addressing
 * is what lets two of the owner's own devices agree on a document with no
 * catalogue between them.
 *
 * **Nothing here opens a file.** ADR 0004 settles how, in its own words: "the
 * identity function takes a `Uint8Array` and the caller reads the file". That
 * caller is `src/app/document.ts`, which has `expo-file-system`; this directory
 * never learns that a file system exists, which is also what makes hashing
 * testable under Node.
 *
 * Both identifiers are recorded, **with the hash authoritative**, because each
 * covers the other's failure: a hash is unambiguous but changes when a file is
 * re-saved or re-compressed, and `dc:identifier` survives re-saving but is
 * often missing or duplicated in real EPUBs.
 */

import { sha256Hex } from './sha256';

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
 * A **Document Id**: `sha256:` and 64 lowercase hex characters of the
 * document's own bytes.
 *
 * Self-describing on purpose. A bare hex string says nothing about what
 * produced it, so the day a stronger digest is wanted, an id written by the
 * older build is recognisable as one rather than silently compared against a
 * differently-computed string of the same length — the same reason ADR 0003
 * wants a `version` in a file. Changing the algorithm renames every document,
 * which is a migration; the prefix is what makes it a visible one.
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
 * The Document Id of these bytes.
 *
 * The whole of identity that is authoritative. Everything else on a
 * `DocumentIdentity` is evidence about a document that has been re-saved.
 */
export function documentIdOf(bytes: Uint8Array): DocumentId {
  return `${DOCUMENT_ID_PREFIX}${sha256Hex(bytes)}` as DocumentId;
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
 * - `none` — no identifier at all. The hash is the only name the document has.
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
  /** The hash. Authoritative (ADR 0004). */
  id: DocumentId;
  /** Which format this is, recorded rather than assumed (ADR 0007). */
  format: DocumentFormat;
  /**
   * The document's own identifier — an EPUB's `dc:identifier` — or null.
   *
   * Secondary. It is what survives the re-save that changes `id`, and it never
   * decides identity by itself; see `matchIdentities`.
   */
  publicationId: string | null;
  publicationIdSource: PublicationIdSource;
}

/**
 * Identity from bytes, a format, and whatever the format's own metadata said.
 *
 * `publication` is optional because it can genuinely be unavailable — a
 * document whose package document would not parse still has a hash, and a hash
 * is enough to name it. Absent metadata and metadata with no identifier in it
 * both come out as `publicationIdSource: 'none'`, because from here they are
 * the same fact: the document did not say.
 */
export function identifyDocument(bytes: Uint8Array, format: DocumentFormat, publication?: PackageIdentifiers | null): DocumentIdentity {
  const [publicationId, publicationIdSource] = choosePublicationId(publication);
  return { id: documentIdOf(bytes), format, publicationId, publicationIdSource };
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
 * - `same-bytes` — the same Document Id. Definitive, and the only answer that
 *   is.
 * - `same-publication` — different bytes, but both documents name the same
 *   publication **unambiguously** (`unique-identifier` or `only`). That is a
 *   re-saved or re-compressed copy of one book, which is exactly the failure
 *   ADR 0004 records the second identifier to cover. It is a candidate, not a
 *   verdict: the caller decides whether to carry a Reading Position across, and
 *   nothing here does it silently.
 * - `different` — everything else, including two documents that share a
 *   `first-of-several` identifier. Attaching one book's position to another
 *   book is the drift this project exists to prevent (philosophy rule 1), so
 *   the ambiguous case is refused rather than guessed.
 */
export type IdentityMatch = 'same-bytes' | 'same-publication' | 'different';

export function matchIdentities(a: DocumentIdentity, b: DocumentIdentity): IdentityMatch {
  if (a.id === b.id) return 'same-bytes';
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
