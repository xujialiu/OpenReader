/**
 * Opening a **Document**: the owner picks an EPUB and the file is read here.
 *
 * Here, and not below. ADR 0004 settles it for the whole project — a hash needs
 * the file's bytes, `src/core/` may not import a file system, so "the identity
 * function takes a `Uint8Array` and the caller reads the file". This is the
 * caller. `src/core/` never learns that a file system exists, and everything
 * below this line receives content rather than a path.
 *
 * It is also the whole of the app's import: one file at a time, from the
 * owner's own device, into memory. There is no library, no catalogue and no
 * store (`docs/PHILOSOPHY.md`, "What stays out"), so there is nowhere for a
 * document to be *kept* — opening one is the only thing that happens to it, and
 * removing the app leaves it exactly where it was (philosophy rule 8).
 */

import { File } from 'expo-file-system';

/**
 * The media type of an EPUB, which on Apple platforms resolves through
 * `UTType(mimeType:)` to `org.idpf.epub-container`, so the picker offers EPUBs
 * and nothing else. PDF and HTML arrive later and through the same picker
 * (ADR 0007); this list is where they will be added.
 */
export const EPUB_MEDIA_TYPE = 'application/epub+zip';

/** A Document the owner has opened. */
export interface OpenDocument {
  /** The file's own name, which is all the app knows to call it: there is no catalogue to look a title up in. */
  name: string;
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
   *
   * When Document Id arrives (ADR 0004) it wants a `Uint8Array`, which
   * `file.bytes()` returns from this very call site. It is not read today
   * because nothing yet consumes it and a second full read of a book is not
   * free.
   */
  base64: string;
}

/**
 * Ask the owner for an EPUB.
 *
 * `null` means the picker closed without one. It also means the pick failed,
 * which is not a distinction this API can make: `File.pickFileAsync` catches
 * everything its native module throws and reports it as `canceled`
 * (expo-file-system's own `File.ts`). Worth knowing rather than worth working
 * around — the owner is looking at the picker either way.
 *
 * On iOS the picker copies the chosen file into the app's own temporary
 * directory (`asCopy: true` in `FilePickingUtils.swift`), so the URI is readable
 * without asking for access to anything else, and the original is untouched.
 */
export async function pickDocument(): Promise<OpenDocument | null> {
  const picked = await File.pickFileAsync({ mimeTypes: [EPUB_MEDIA_TYPE] });
  if (picked.canceled) return null;

  const file = picked.result;
  return { name: file.name, base64: await file.base64() };
}
