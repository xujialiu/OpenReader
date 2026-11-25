import { isDeepStrictEqual } from 'node:util';

import { withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Tell iOS that this app opens EPUBs, so that Files, Mail and every share sheet
 * offer it (ADR 0019).
 *
 * Two Info.plist keys, and they do different jobs:
 *
 * - **`CFBundleDocumentTypes`** is the declaration that the app handles a type
 *   at all. Without it the app is absent from "Open in" everywhere, and there is
 *   no error anywhere to explain the absence — the app simply is not in the
 *   list.
 * - **`LSSupportsOpeningDocumentsInPlace`** decides *what arrives*. With it, a
 *   tap in Files hands over the owner's own file where it lives, outside this
 *   app's sandbox. Without it, iOS copies the file into `Documents/Inbox/`
 *   first — for **every** open, including one from Files, so a 34 MB book is
 *   duplicated before a line of JavaScript runs. `src/app/opened-document.ts`
 *   handles both, and tells them apart by whether the URL is inside the sandbox,
 *   because React Native's `Linking` hands JavaScript the URL string and drops
 *   the `openInPlace` flag that iOS did send.
 *
 * The type is named by its UTI rather than by an extension or a media type.
 * `org.idpf.epub-container` is declared by the system on Apple platforms —
 * `UTType(mimeType: "application/epub+zip")` resolves to it, which is what
 * `src/app/document.ts` relies on for the picker — so nothing here has to import
 * a type declaration of its own, and an app that did would be a second
 * declaration of one fact.
 *
 * `LSHandlerRank: 'Alternate'` and not `'Owner'`: an EPUB is not this app's
 * format, it is the platform's, and claiming to own it would put this app above
 * Books in every list on the device for a file it did not create.
 *
 * Reapplying these declarations to an existing project is safe. A different
 * value for either key stops prebuild before either declaration is changed.
 */

/** ADR 0007's list, in Apple's terms. A second format is a second entry here and one more line in `DOCUMENT_FORMATS`. */
const EPUB_DOCUMENT_TYPE = {
  CFBundleTypeName: 'EPUB',
  /** The app displays the document and does not edit it. */
  CFBundleTypeRole: 'Viewer',
  /** Not 'Owner'. See above. */
  LSHandlerRank: 'Alternate',
  LSItemContentTypes: ['org.idpf.epub-container'],
};

const withEpubDocumentTypes: ConfigPlugin = (config) =>
  withInfoPlist(config, (infoPlistConfig) => {
    const plist = infoPlistConfig.modResults;

    const types = [EPUB_DOCUMENT_TYPE];
    // Expo reads plist dictionaries into objects with a null prototype. Compare their data.
    if (plist.CFBundleDocumentTypes !== undefined && !isDeepStrictEqual(structuredClone(plist.CFBundleDocumentTypes), types)) {
      throw new Error('[with-epub-document-types] Info.plist already contains CFBundleDocumentTypes with a different declaration. Expected the EPUB Viewer declaration.');
    }
    if (plist.LSSupportsOpeningDocumentsInPlace !== undefined && plist.LSSupportsOpeningDocumentsInPlace !== true) {
      throw new Error(`[with-epub-document-types] Info.plist already sets LSSupportsOpeningDocumentsInPlace to ${plist.LSSupportsOpeningDocumentsInPlace}. Expected true.`);
    }
    plist.CFBundleDocumentTypes = types;
    plist.LSSupportsOpeningDocumentsInPlace = true;
    return infoPlistConfig;
  });

export default withEpubDocumentTypes;
