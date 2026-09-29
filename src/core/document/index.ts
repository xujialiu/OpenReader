/**
 * The public surface of `core/document`: what a Document is called, which format
 * it is, where the owner stopped reading, what a store keeps, and what parts the
 * Document says it has.
 *
 * Five questions, five files, and the order they appear in is the order they
 * depend on each other.
 *
 * - `identity.ts` — ADR 0004. A Document Id over the archive's own manifest,
 *   `dc:identifier` beside it as a secondary match, and the format recorded
 *   rather than assumed (ADR 0007).
 * - `zip.ts` — the manifest: a ZIP's central directory, and the seam that gets
 *   at it. Nothing here opens a file — the caller passes `ArchiveBytes`, a
 *   length and a function returning one range, so the 220,092 bytes an id needs
 *   are the only bytes anyone reads.
 * - `sha256.ts` — the digest that makes the above computable with no platform
 *   API and no dependency, so a test under Node hashes what the app hashes.
 * - `anchor.ts` — ADR 0008's text anchor, and the matching that decides whether
 *   a locator landed where it claims. Unicode normalisation is load-bearing and
 *   the file says why.
 * - `position.ts` — ADR 0008's Reading Position, an opaque locator (ADR 0007)
 *   plus that anchor, and the fixed resolution order: locator, then verify,
 *   then search.
 * - `stamp.ts` — the Stamp a position and an entry each carry, and the rule
 *   for writing the next one above whatever was held.
 * - `library.ts` — one entry per Document as a store persists it: a versioned
 *   file, parsed defensively, with ADR 0003's "reject a newer version and leave
 *   it alone" and "new information goes in a new file" designed in.
 * - `contents.ts` — ADR 0020's contents list: the Document's own navigation
 *   flattened into rows and sections, each row resolved to the spine item
 *   `goToSection` takes, and the rule that says which row the reading is in —
 *   together with what that rule cannot resolve, which is the part that matters.
 *
 * Nothing in here imports the platform, and nothing imports from the layers
 * above `core/`. `eslint.config.js` enforces both.
 */

export {
  DOCUMENT_FORMATS,
  DOCUMENT_ID_PREFIX,
  DOCUMENT_ID_RULE,
  asDocumentFormat,
  asDocumentId,
  documentIdOf,
  documentManifest,
  identifyDocument,
  matchIdentities,
  readPackageIdentifiers,
  type DocumentFormat,
  type DocumentId,
  type DocumentIdentity,
  type IdentityMatch,
  type PackageIdentifiers,
  type PublicationIdSource,
} from './identity';

export { ARCHIVE_TAIL, bytesAsArchive, readCentralDirectory, type ArchiveBytes, type ZipMember } from './zip';

export { sha256Hex } from './sha256';

export {
  ANCHOR_CONTEXT,
  anchorHasWords,
  compareMatches,
  createTextAnchor,
  matchAnchor,
  normalizeAnchorText,
  type AnchorAgreement,
  type AnchorMatch,
  type TextAnchor,
} from './anchor';

export {
  createLocator,
  findAnchor,
  readLocator,
  readingPlaceAt,
  readingPositionAt,
  resolveReadingPosition,
  sameLocator,
  stampPlace,
  type AnchorSearch,
  type Locator,
  type LocatorProblem,
  type Place,
  type PlaceReader,
  type PositionResolution,
  type ReadingPlace,
  type ReadingPosition,
  type SearchProblem,
} from './position';

export { OLDEST_STAMP, newerThan, nextStamp, type Stamp } from './stamp';

export {
  LIBRARY_VERSION,
  parseLibrary,
  serializeLibrary,
  type LibraryEntry,
  type LibraryParse,
  type LibraryProblem,
  type VoiceChoice,
} from './library';

export {
  EMPTY_CONTENTS,
  contentsOf,
  currentRow,
  rowOfSection,
  type Contents,
  type ContentsRow,
  type ContentsSection,
  type CurrentRow,
  type NavigationEntry,
  type ReadingSpineItem,
  type RowPrecision,
} from './contents';
