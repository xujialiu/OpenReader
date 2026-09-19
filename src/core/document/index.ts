/**
 * The public surface of `core/document`: what a Document is called, which format
 * it is, where the owner stopped reading, what a store keeps, and what parts the
 * Document says it has.
 *
 * Five questions, five files, and the order they appear in is the order they
 * depend on each other.
 *
 * - `identity.ts` — ADR 0004. A Document Id from the bytes, `dc:identifier`
 *   beside it as a secondary match, and the format recorded rather than assumed
 *   (ADR 0007). Nothing here opens a file: the identity function takes a
 *   `Uint8Array` and the caller reads the file.
 * - `sha256.ts` — the digest that makes the above computable with no platform
 *   API and no dependency, so a test under Node hashes what the app hashes.
 * - `anchor.ts` — ADR 0008's text anchor, and the matching that decides whether
 *   a locator landed where it claims. Unicode normalisation is load-bearing and
 *   the file says why.
 * - `position.ts` — ADR 0008's Reading Position, an opaque locator (ADR 0007)
 *   plus that anchor, and the fixed resolution order: locator, then verify,
 *   then search.
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
  asDocumentFormat,
  asDocumentId,
  documentIdOf,
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
  readingPositionAt,
  resolveReadingPosition,
  sameLocator,
  type AnchorSearch,
  type Locator,
  type LocatorProblem,
  type Place,
  type PlaceReader,
  type PositionResolution,
  type ReadingPosition,
  type SearchProblem,
} from './position';

export {
  LIBRARY_VERSION,
  parseLibrary,
  serializeLibrary,
  type LibraryEntry,
  type LibraryParse,
  type LibraryProblem,
  type Stamp,
  type VoiceChoice,
} from './library';

export {
  EMPTY_CONTENTS,
  contentsOf,
  currentRow,
  type Contents,
  type ContentsRow,
  type ContentsSection,
  type CurrentRow,
  type NavigationEntry,
  type ReadingSpineItem,
  type RowPrecision,
} from './contents';
