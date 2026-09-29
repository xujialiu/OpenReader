---
status: accepted
---

# Sharing copies the kept file under its Library name and hands it to expo-sharing

_The product argument is [design 0059](../design/0059-a-book-can-be-shared-as-it-was-added.md).
Issue #95. **Share** is in CONTEXT.md._

## What was done

- `src/app/reader-actions.tsx` passes `Sheet` an `action` on its `menu` page
  only: `{ icon: 'share', label: 'Share', onPress, disabled: sharing }`.
  `Sheet` draws it at the right end of the title row in the back button's own
  style (`styles.back`: 34 pt, `INK.line`, radius 17) with `marginLeft: 'auto'`.
  Without `onBack`, the row is `alignItems: 'flex-start'`, and the title gets
  `lineHeight: 22` and `paddingTop: 6`, which puts the first line's centre on the
  button's centre. The icon is `share` in `src/app/icon.tsx`, the
  `square.and.arrow.up` shape in the set's 1.7 stroke, drawn at 20 in the circle.
- `src/app/share-document.ts`'s `shareDocument(entry)`:
  1. rejects if `documentFile(id, format)` does not exist, with the sentence the
     drawer shows;
  2. deletes `Paths.cache/share/` if it exists, creates it again, and
     `copySync`s the kept `library/sha256-<hex>.epub` to
     `share/<sharedFileName(title, format)>`;
  3. `await Sharing.shareAsync(copy.uri, { mimeType: 'application/epub+zip', dialogTitle: title })`.

  Any throw is rethrown as `This book could not be shared: <message>`. The
  drawer shows the message in a `SheetNote attention` above its rows, and
  clears it on the next tap.
- Debug Log, category `document`: `share <id8> as <name>: copied in N ms`,
  `share <id8>: sheet closed after N ms`, `share <id8> failed: <problem>` and
  `share <id8>: no file`.

## Why expo-sharing, and why without its plugin

React Native's `Share.share({ url })` needs no new native module. But on Android
it sends only a text message, and design 0001 is one app for both phones.
`expo-sharing` 57.0.22 shares a local file on both.

Its config plugin is not in `app.config.ts`. `npx expo install` asks for it
because it cannot edit a TypeScript config, but every option it sets
(`ios.enabled`, `activationRule`, `appGroupId`, Android intent filters) is for
**receiving** shares: a share extension target, an App Group, and
`ExpoShareIntoAppGroupId` in Info.plist. `shareAsync` reads none of them. Only
`getSharedPayloads` and its relatives read `ExpoShareIntoAppGroupId`, and they
throw without it. Nothing here calls them.

Read from `node_modules/expo-sharing/ios/SharingModule.swift` in 57.0.22:

- `shareAsync` builds a `UIActivityViewController` with the file URL and
  presents it from `appContext.utilities.currentViewController()`. That walks
  `keyWindow.rootViewController.presentedViewController` to the top, so the
  sheet is presented **over** the drawer's React Native `Modal` rather than
  refused. This is why the drawer does not have to close first.
- `completionWithItemsHandler` resolves the promise on every dismissal:
  sent, cancelled, or an activity picked and its own dialog cancelled. So
  `sharing` always returns to `false`, and the button is enabled again.
- `UTI` is accepted and never read. `mimeType` and `dialogTitle` are
  Android's. On iOS the sheet takes the type from the file's extension.
- On iPad (`supportsTablet: true`), with no `anchor`, the popover's
  `sourceRect` is the presenting view's bottom centre. That is acceptable for
  a phone-first app, and no anchor is passed.
- `FileSystemUtilities.isReadableFile` must pass for the URL. The cache
  directory is the app's own.

## Why a copy, and why it is left behind

`UIActivityViewController` names a shared file after the URL's last path
component. The kept file is named by its Document Id (`library.ts`,
`fileNameOf`), so without a copy the recipient sees `sha256-<64 hex>.epub`. The
copy exists only to carry the name.

It stays in `Caches/share/` until the next share empties the folder, rather than
being deleted when `shareAsync` settles. The sheet's completion handler runs
when the sheet is dismissed, and nothing in UIKit's contract says that an
AirDrop or a Mail compose sheet has finished reading the file by then. Caches
may be purged by the system under storage pressure, and the folder never holds
more than one book.

`copySync` is expo-file-system's `FileManager.copyItem`. On APFS it may be a
clone rather than a byte copy. For a 1 MB book it took 4–13 ms. A 34 MB book
was not measured.

## The name

`src/app/share-name.ts`, `sharedFileName(title, format)`, is pinned by
`test/app/share-name.test.ts`:

- U+0000–U+001F and U+007F become spaces, and runs of whitespace become one
  space. A `dc:title` can carry line breaks.
- `/`, `\` and `:` become `-`, or ` - ` when whitespace touches them:
  `Volume Three: The Long Road` → `Volume Three - The Long Road`. A slash cannot
  be in a POSIX name. A colon is displayed as a slash by Finder and Files
  (the same fact as `fileNameOf`). A backslash is a separator on Windows.
- Leading dots and spaces go, because a dot-file is hidden on the recipient's
  Mac.
- The whole name, extension included, is at most 255 UTF-8 bytes, the limit
  of APFS, ext4 and f2fs. The cut falls between grapheme clusters
  (`unicode-segmenter`, as in `core/segmenter/graphemes.ts`), and the length
  is counted without `TextEncoder`, so Node and Hermes agree.
- Nothing left gives `Untitled`.

## Measured

On the simulator, 2026-09-30 (notes/NOTES_2026-09-30.md, 02:44):

- The sheet rose over the drawer's `Modal`, and the drawer was still open
  when the sheet closed. While the sheet was up, the button was `Disabled`.
- The sheet named the file after the Library title.
- The `Caches/share/` copy was byte-identical to the kept file.
- The long rename produced the name `test/app/share-name.test.ts` predicts.
- The missing-file note appeared, and no sheet rose.

The sheet's own actions, Save to Files and AirDrop, could not be driven from
the Mac, so no end-to-end delivery was recorded. That is for the owner's phone.

## What was turned down

- **Hiding the button when the file is missing.** Every entry is kept file-first
  (`document.ts` keeps the bytes before `library.add` commits the entry), sync
  never creates entries (`sync-items.ts`, `planAdoption`), and the Documents
  folder is not exposed to Files (`UIFileSharingEnabled` is unset). The two
  known ways to lose the file are a `migrateDocumentIds` whose Library write
  failed after its renames, and changes to the container from a Mac. One
  failure note covers those and every other failure. A `stat` on every drawer
  opening would cover only these two.
- **Closing the drawer before presenting.** Cancelling would lose the drawer,
  and the sheet would have to wait for the `Modal`'s dismissal to finish,
  because `currentViewController` skips a controller that `isBeingDismissed`.
