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
 * ## Both edits fail the prebuild if something else has written the key
 *
 * The house style of `plugins/with-ui-scene-lifecycle.ts`, for the same reason.
 * A prebuild prints hundreds of lines, so a warning is not a signal; and the way
 * this fails is that a book the owner taps in Files opens in some other app, or
 * in none, with nothing anywhere saying why. Nothing is merged and nothing is
 * overwritten: if a second writer of either key appears, the build stops and
 * names it, because guessing which of the two declarations should win is exactly
 * the guess that would be wrong silently.
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

    if (plist.CFBundleDocumentTypes) {
      throw new Error(
        '[with-epub-document-types] The generated Info.plist already contains ' +
          'CFBundleDocumentTypes, so something else is writing it now.\n\n' +
          'Two writers of one Info.plist key is the failure app.config.ts already warns ' +
          'about for UIBackgroundModes. This key decides whether the app appears in ' +
          "Files and in every share sheet, and the symptom of getting it wrong is the " +
          'app being absent from a list with no error anywhere. Find the other writer ' +
          'and delete either it or this plugin and its line in app.config.ts. Nothing ' +
          'is merged here on purpose.'
      );
    }

    if (plist.LSSupportsOpeningDocumentsInPlace !== undefined) {
      throw new Error(
        '[with-epub-document-types] The generated Info.plist already sets ' +
          `LSSupportsOpeningDocumentsInPlace (to ${String(plist.LSSupportsOpeningDocumentsInPlace)}), ` +
          'so something else is writing it now.\n\n' +
          'This key decides whether an opened book arrives as the owner’s own file or ' +
          'as a copy iOS has already made in Documents/Inbox, and src/app/opened-document.ts ' +
          'is written for both. It is not overwritten here because a second writer means ' +
          'two answers to that question and only one of them was reasoned about.'
      );
    }

    plist.CFBundleDocumentTypes = [EPUB_DOCUMENT_TYPE];
    plist.LSSupportsOpeningDocumentsInPlace = true;
    return infoPlistConfig;
  });

export default withEpubDocumentTypes;
