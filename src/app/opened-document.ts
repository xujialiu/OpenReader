/**
 * A Document handed over by another app — Files, Mail, a messaging app.
 *
 * iOS delivers it as a `file:` URL, twice over: once in the scene's connection
 * options when the tap launched the app cold, and again as a `url` event when
 * the app was already running. Both arrive here as the same thing, because to
 * the owner they are the same act.
 *
 * ## `Linking` is imported here, and only for what arrives
 *
 * `src/app/controls.tsx` used to be able to say that **nothing in `src/app/`
 * imports `Linking`**, which was ADR 0017's ban on a tappable route to a
 * Provider's signup, checkable by eye. That sentence is no longer true and the
 * decision has not changed, so the property is now stated the way it will stay:
 * **nothing in `src/` calls `Linking.openURL` or `Linking.canOpenURL`** except
 * `src/app/own-site.ts`, which opens only the project's own privacy policy
 * (#110), and `test/app/no-outgoing-links.test.ts` fails if that stops being
 * true. This file
 * reads two things — the URL the app was opened with, and the URLs it is handed
 * afterwards — and opens none.
 *
 * ## What the URL is, and the one thing that cannot be told from it
 *
 * With `LSSupportsOpeningDocumentsInPlace` (`plugins/with-epub-document-types.ts`)
 * iOS may give the owner's **own file, in place**, outside this app's sandbox;
 * otherwise it puts a copy in `Documents/Inbox/` first. The two need opposite
 * treatment — the first must be copied and left alone, the second is ours and
 * must be taken out of the Inbox, which Apple requires of every app that has one.
 * Which of the two happens is **not** a property of the sending app: opening the
 * same EPUB by `file:` URL on the simulator went through the Inbox, with the
 * key set, so both halves are live code and neither is the "normal" one.
 *
 * They can be told apart by where the URL is and **not** by asking iOS, even
 * though iOS knows: `UIScene.OpenURLOptions.openInPlace` is set and forwarded by
 * `ExpoAppSceneDelegate` into `UIApplication.OpenURLOptionsKey.openInPlace`, and
 * React Native's `Linking` hands JavaScript the URL string and nothing else. So
 * the test below is the path, which is a fact about this app's own sandbox and
 * is therefore reliable, rather than a guess about the sender.
 *
 * Reading the bytes needs no permission dance either way. `expo-file-system`
 * wraps every read in `startAccessingSecurityScopedResource` /
 * `stopAccessingSecurityScopedResource` (`ios/FileSystemPath.swift:139`), and a
 * path outside the sandbox is given `[.read, .write]` with the check deferred to
 * the OS (`expo-modules-core/ios/FileSystemUtilities/FileSystemUtilities.swift`,
 * `getExternalPathPermissions`). What it does **not** give is a way to come back
 * to that file later, which is why `library.ts` keeps the bytes instead.
 */

import { File, Paths } from 'expo-file-system';
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { EPUB_MEDIA_TYPE } from './document';

/** A file another app has handed over, and whether it is ours to move. */
export interface HandedOverFile {
  file: File;
  /**
   * True when iOS put the file in this app's own `Documents/Inbox/`, which it
   * does for a share rather than an open-in-place. Those are the app's to clear
   * out; everything else is the owner's file where the owner keeps it.
   */
  move: boolean;
}

/** The directory iOS copies a shared document into. Apple requires the app to empty it; that is what `move` does. */
const INBOX = 'Inbox/';

/**
 * Hand every EPUB another app sends to `onFile`, starting with the one that
 * launched the app.
 *
 * This subscribes **once** and never again: `Linking.getInitialURL()` answers
 * with the launch URL every time it is asked, so re-running this effect replays
 * it — which means the same book added to the Library twice and a second Reader
 * pushed over the first. `onFile` is therefore kept in a ref and read at call
 * time, the way `renderer/reader-bridge.ts` keeps its callbacks: current without
 * making the subscription depend on them.
 */
export function useHandedOverDocuments(onFile: (handed: HandedOverFile) => void): void {
  const onFileRef = useRef(onFile);
  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  useEffect(() => {
    let alive = true;

    const take = (url: string | null | undefined): void => {
      if (!alive || !url) return;
      const handed = handedOver(url);
      if (handed) onFileRef.current(handed);
    };

    // The cold-launch URL. Under the UIScene life cycle UIKit puts it in the
    // scene's connection options rather than the app delegate's launch options,
    // and `ExpoAppSceneDelegate` rebuilds the launch options React Native reads
    // — so this works only because ADR 0018's plugin is in place.
    void Linking.getInitialURL().then(take, () => {});

    const subscription = Linking.addEventListener('url', (event) => take(event.url));
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
}

/**
 * The URL as a file this app should take, or null.
 *
 * Null for anything that is not a `file:` URL and anything that is not an EPUB.
 * A custom scheme is not an error here — it is a deep link nothing in this app
 * claims yet — and neither is a file of another type: iOS only sends what
 * `CFBundleDocumentTypes` declared, so a `.pdf` arriving means the declaration
 * and this function have drifted apart, which is worth seeing as "nothing
 * happened for a PDF" rather than as a crash.
 */
function handedOver(url: string): HandedOverFile | null {
  if (!url.startsWith('file://')) return null;

  const file = new File(url);
  if (!file.exists) return null;
  // `type` is the file's own UTI-derived media type from the OS, and the
  // extension is the fallback for a file the OS will not type — a document that
  // arrived through a share sheet sometimes has neither a quarantine record nor
  // an extended attribute to go on.
  if (file.type !== EPUB_MEDIA_TYPE && file.extension.toLowerCase() !== '.epub') return null;

  const inbox = `${Paths.document.uri.replace(/\/+$/, '')}/${INBOX}`;
  return { file, move: file.uri.startsWith(inbox) };
}
