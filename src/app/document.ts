/**
 * Opening a **Document**: where one comes from, what it is called, and how it
 * is recognised again.
 *
 * Here, and not below. ADR 0004 settles it for the whole project — naming a
 * Document needs its bytes and `src/core/` may not import a file system, so the
 * identity function is handed a way to read ranges and the caller owns the file.
 * This is the caller. `src/core/` never learns that a file system exists, and
 * everything below this line receives content rather than a path.
 *
 * A Document arrives one of two ways, and what differs is only whether the file
 * it arrives as is **ours to take** or the owner's to leave alone.
 *
 * - **The owner picks it** (`pickDocument`). iOS has already copied the file
 *   into the app's temporary directory before JavaScript sees it — the picker
 *   is built `asCopy: true` in `expo-file-system/ios/FilePickingUtils.swift:79`
 *   — so that copy is **moved** into the Library rather than copied again.
 * - **Another app sends it** (`src/app/opened-document.ts`). Either iOS has put
 *   a copy in this app's own `Documents/Inbox/`, which is ours and is **moved**
 *   out (Apple requires an app to empty its Inbox), or it has handed over the
 *   owner's own file in place, which is **copied**. Moving someone's book out of
 *   their Files folder because they tapped it is not an app's decision to make.
 *
 * Either way the bytes end up in the Library's own directory under the Document
 * Id (`library.ts`), and the owner's file is untouched — philosophy rule 8, which
 * this file used to satisfy by keeping nothing at all. That changed when the
 * Library arrived (ADR 0019) and the reason it is still satisfied is narrower:
 * the copy is the app's, removing the app removes it, and the owner's file stays
 * exactly where it was.
 */

import { File, FileMode } from 'expo-file-system';

import { identifyDocument, type DocumentIdentity } from '../core/document';

import { documentFile, keepDocument } from './library';

/**
 * The media type of an EPUB, which on Apple platforms resolves through
 * `UTType(mimeType:)` to `org.idpf.epub-container`, so the picker offers EPUBs
 * and nothing else. PDF and HTML arrive later and through the same picker
 * (ADR 0007); this list is where they will be added.
 */
export const EPUB_MEDIA_TYPE = 'application/epub+zip';

/** A Document the owner has opened, with the bytes the renderer takes. */
export interface OpenDocument {
  identity: DocumentIdentity;
  /** What to call it: the EPUB's own title once it has opened, the file's name until then. */
  title: string;
  /**
   * The document's bytes, base64, which is the form `@epubjs-react-native/core`
   * takes a book in (`getSourceType` → `SourceType.BASE64`, and epub.js is given
   * `{ encoding: 'base64' }`).
   *
   * Base64 rather than the `file://` URI the same component would also accept,
   * for a reason read out of the installed package: for an fs URI it builds the
   * WebView's `allowingReadAccessToURL` as `` `${src}${jszipFileUri},…` `` — with
   * no separator between the book and the first script — and iOS is handed the
   * result as a single URL. The base64 path does not go near it.
   */
  base64: string;
}

/**
 * Ask the owner for an EPUB. `null` means the picker closed without one.
 *
 * It also means the pick failed, which is not a distinction this API can make:
 * `File.pickFileAsync` catches everything its native module throws and reports
 * it as `canceled` (expo-file-system's own `File.ts`). Worth knowing rather than
 * worth working around — the owner is looking at the picker either way.
 */
export async function pickDocument(): Promise<File | null> {
  const picked = await File.pickFileAsync({ mimeTypes: [EPUB_MEDIA_TYPE] });
  return picked.canceled ? null : picked.result;
}

/** A Document just added: who it is and what to call it. */
export interface AddedDocument {
  identity: DocumentIdentity;
  title: string;
}

/**
 * Read a file, name it, and keep it.
 *
 * The bytes are read once, here, and hashed here: `documentIdOf` is the only
 * thing that decides what a Document *is* (ADR 0004), and inventing a second
 * identity — a path, a name, a row id — is the mistake that makes two devices
 * disagree about which book they are holding.
 *
 * The title is the file's own name with its extension taken off. It is a
 * placeholder and is replaced the moment the book opens and epub.js reports the
 * EPUB's `dc:title`; a file named `9780571364039.epub` is not a title.
 *
 * ## The publication's own `dc:identifier` is not filled in
 *
 * Recorded here rather than left to be discovered. ADR 0004 wants it beside the
 * hash and `readPackageIdentifiers` exists to produce it — from the package
 * document, which is inside the zip, which nothing outside the WebView can open.
 * The obvious substitute does not work: epub.js reports
 * `metadata.identifier = this.getElementText(t, "identifier")`, the **first**
 * `dc:identifier` in document order, with no reference to the package's
 * `unique-identifier` attribute. So epub.js cannot tell `'unique-identifier'`
 * from `'first-of-several'` — and those are exactly the two `identifyDocument`
 * treats differently, because the second must never be matched on. Leaving it
 * `'none'` is the honest answer until a zip reader lands on this side of the
 * bridge; a guessed source would make `matchIdentities` confident about the one
 * case ADR 0004 says it must not be.
 */
export async function addDocument(source: File, options: { move: boolean }): Promise<AddedDocument> {
  /**
   * The name is read **before** the file is kept, and that is a bug that was
   * found on the device rather than a precaution.
   *
   * `expo-file-system`'s move rewrites the handle it was called on —
   * `url = destinationUrl` in `ios/FileSystemPath.swift:91`, which its own type
   * describes as "Updates the `uri` property that now points to the new
   * location" — while its copy does not. So reading `source.name` afterwards
   * gives the file's *new* name on the move path and its real one on the copy
   * path, and the Library ends up calling a book
   * `sha256-e933d9c41d9db4d9…`. It did, for the 34 MB novel, whose title also
   * takes long enough to arrive from epub.js that the placeholder is what the
   * owner reads in the meantime.
   */
  const named = titleFromFileName(source.name);

  /**
   * **The file is read in ranges, and never whole.** ADR 0004's amendment: a
   * Document Id is a digest of the archive's own central directory, which for
   * the owner's 34,453,009-byte novel is 220,092 bytes. Reading the whole file
   * here would throw that away at the caller — it is the line that held the
   * JavaScript thread for 14,362 ms and froze the app while a book was added.
   *
   * Three things about the handle, each of which fails as something else:
   *
   * - `FileMode.ReadOnly` explicitly, because the default for a `file://` path
   *   is `ReadWrite`, and that demands write access to a file the owner may have
   *   opened in place — theirs, not ours (philosophy rule 8).
   * - The length comes from the `File` and not the handle: `File.size` is a
   *   `number`, while `FileHandle.size` and `.offset` are `number | null`.
   * - The handle is closed **before** `keepDocument`, which moves or copies over
   *   the very file it is open on.
   */
  const handle = source.open(FileMode.ReadOnly);
  let identity;
  try {
    identity = identifyDocument(
      {
        size: source.size,
        read: (offset, length) => {
          handle.offset = offset;
          return handle.readBytes(length);
        },
      },
      'epub',
    );
  } finally {
    handle.close();
  }

  keepDocument(identity.id, identity.format, source, options);
  return { identity, title: named };
}

/**
 * The bytes of a Document the Library already holds.
 *
 * Throws when the file is gone, in those words. The design file says an entry
 * that no longer points at a file "says so when it is tapped rather than
 * pretending"; this is where the saying happens, and it is deliberately not a
 * silent `null` that a caller could render as an empty reader.
 */
export async function openDocument(identity: DocumentIdentity, title: string): Promise<OpenDocument> {
  const file = documentFile(identity.id, identity.format);
  if (!file.exists) {
    throw new Error(`${title} is in the Library but its file is not on this device any more. The entry is kept; add the book again to read it.`);
  }
  return { identity, title, base64: await file.base64() };
}

/** The file's name without its extension. What a Document is called until the EPUB says otherwise. */
function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
