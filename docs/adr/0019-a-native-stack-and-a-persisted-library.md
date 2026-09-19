---
status: proposed
---

# A native stack, and a Library that is a file

_The product argument — what the owner sees and what it costs — is
`docs/design/0019-four-screens-and-a-way-back.md`._

## The screens

```
Library ──┬─→ Reader ──→ (Appearance, a sheet over it)
          └─→ Settings ──┬─→ General
                         └─→ Providers ──→ Provider detail
```

`Library` is the initial route. `Reader` takes a Document Id, not a path or a
`Document` object: the route params of a native stack are serialised, and a
Document Id is already the content hash (ADR 0004), so the route survives a
state restore while a path would go stale the moment a file moved.

## `@react-navigation/native-stack`, not a hand-rolled switch

A `useState<Screen>` switch would need no dependency and would be about forty
lines. It was rejected on three counts, all of which it would have to reimplement
badly:

- **The back gesture.** `native-stack` renders a real `UINavigationController`,
  so the edge swipe, the interactive pop and the header are the platform's. A
  switch has to draw a header and either forgo the gesture or rebuild it.
- **The reader must not be rebuilt.** Going to Settings and back must not remount
  the WebView, reparse the EPUB or lose the highlight. A stack keeps the screen
  below mounted; a switch unmounts it by construction.
- **Android has to work too** (ADR 0001), and a back _button_ is not optional
  there.

This adds `@react-navigation/native`, `@react-navigation/native-stack`,
`react-native-screens` and `react-native-safe-area-context`. The last two are
native, so this is a `prebuild` and a `pod install`, not an `npm install`.

Appearance is **not** a route. It is a sheet presented over the reader, because
the page behind it must stay visible while a font size is being changed — the
change is judged by looking at the text, so covering the text defeats it.

## The Library is a file, and the file is the truth

One JSON file in the app's own documents directory, holding one entry per
Document: its Document Id, the name to show, the bookmarked file's location, and
the Reading Position (ADR 0008). It is written after every change, read once at
launch.

Not SQLite, and not `AsyncStorage`. A shelf of a few hundred entries is a few
tens of kilobytes; the whole of it is rewritten faster than a query would be
prepared, and the format is one a person can read when something is wrong —
which matters more here than it would elsewhere, because this file is the
candidate for what ADR 0003 syncs to the owner's own WebDAV folder, and a sync
format that is a binary database is a sync format nobody can repair by hand.

**The entry is not the file.** iOS gives an app a sandbox whose absolute path
changes between installs, and a document picked from Files lives outside it. The
Document Id is the identity regardless, so the same book added twice from two
places is one entry.

### The security-scoped bookmark was not built, and the reason is measured

This ADR said an entry would store "a security-scoped bookmark and re-resolve it
on use". It does not. Three facts, read out of the installed packages rather than
out of documentation, closed that route and then made it unnecessary:

1. **Expo SDK 57 has no API that makes one.** `expo-file-system` starts and stops
   access on a URL it was already handed —
   `let accessed = url.startAccessingSecurityScopedResource()` in
   `ios/FileSystemPath.swift:139` — and never calls `URL.bookmarkData`. The
   string `bookmarkData` appears in no installed `expo-*` or `@expo/*` package.
   Expo states the consequence itself, in the type for the directory picker
   (`expo-file-system/build/internal/NativeFileSystem.types.d.ts`): "On iOS, the
   selected directory grants temporary read and write access for the current app
   session only. After the app restarts, you must prompt the user again to regain
   access." A bookmark is a native module that does not exist.
2. **The picked file's own URL never reaches JavaScript.** The picker is
   constructed `UIDocumentPickerViewController(forOpeningContentTypes: utTypes,
   asCopy: true)` (`expo-file-system/ios/FilePickingUtils.swift:79`), so what
   arrives is already a copy in the app's temporary directory. There is nothing
   to bookmark: iOS has copied the book before a line of this app's code runs,
   and the only choice left is whether to keep that copy or let it be reaped.
3. **A bookmark is device-local, and this file is the sync candidate.** The
   paragraph above says the Library file is what ADR 0003 may sync to the owner's
   own WebDAV folder. A bookmark means nothing on any other device, so putting
   one in a synced record is putting a fact in it that is false everywhere but
   here.

**So the Document Id is the file name.** The bytes are kept at
`Documents/library/sha256-<64 hex>.epub`, which is a pure function of the entry's
own identity. That needs no field in the Library file, no sibling file and no
device to interpret it — so this build adds **no field** to the version-1 format,
which is what `src/core/document/README.md` says growth has to look like. A
resolve that fails is still surfaced on the entry rather than deleting it, per
the design file; it is now a `stat` rather than a bookmark resolution, and the
Library screen can therefore say so before the entry is tapped as well as after.

`document.ts` used to say a Document is "read and never copied". That sentence
was true when there was nowhere to keep one and is not true now. What philosophy
rule 8 actually asks for is unchanged and is still kept: nothing is uploaded, the
owner's own file is untouched wherever they keep it, and removing the app removes
everything this app wrote.

### The Stamp needs a device, and the device is a third file

`Documents/this-device` holds one opaque string. It is not in the Library file
for the same reason the bookmark is not: it means nothing anywhere else. It is
written down rather than generated per session because a Stamp whose device
changes at every launch decides nothing, and deciding which of two copies of an
entry wins is the whole of what a Stamp is for.

## What the Reader does with a Reading Position

**Written** from the Utterance being spoken: the Block's CFI as the locator, the
Utterance's own characters quoted out of the Block's verbatim text as the anchor.
Both from one call to `readingPositionAt`, because they have to describe the same
place. The Block's CFI is an **element** CFI with no text step, which is the half
of the dialect ADR 0008 records that Zotero's generator and resolver agree on.

It is taken at a Clip boundary, where everything it needs is certainly in hand,
and written to the Library at most every ten seconds — plus once, unconditionally,
when the screen is left. Leaving therefore loses nothing; a force-quit mid-chapter
loses at most the last handful of sentences. It is read through a function rather
than held in React state: a Reading Position changes once an Utterance, and
re-rendering the reader at that rate is the cost ADR 0005 forbids for the same
reason it forbids a position in state.

**Read back** as `<Reader initialLocation>`, which the renderer applies inside its
own `onReady` and before it injects the highlighter — so the first section to
report its Blocks is the one the owner was left in rather than the cover.

**What is not done:** playback does not resume *at* that Utterance. The page is
where it was; Play starts from the first Utterance of what has rendered.
Resolving the anchor back to an index against freshly reported Blocks is
`resolveReadingPosition`'s job and it is not wired up, which is stated here rather
than left to be discovered by someone who expects it.

## The Library shows a quotation, not a percentage

"How far through the reading got" is the last Utterance spoken, quoted. A
percentage would need epub.js to index the whole book — the step that is already
the slow part of opening the 2,077-section novel — and a number arrived at any
other way is an estimate, which philosophy rule 1 forbids for the same reason it
forbids an estimated Word Timing.

## Settings is a screen, so the draft is committed by leaving

The sheet had a Done button; a screen has a back arrow and an edge swipe, and a
gesture that discarded what the owner typed would be a new way to lose an API
key. So what is typed is written back when the screen unmounts, however it was
left. It stays a **draft** rather than editing the live settings, and that is not
tidiness: `use-reading.ts` disposes the engine and hands back the audio session
whenever `engineIdentity(settings)` changes, so editing a Provider's address live
would tear the player down once per keystroke.

## Opening an EPUB from another app

Two Info.plist keys, written by `plugins/with-epub-document-types.ts` in the
house style of ADR 0018's plugin — every edit fails the prebuild if what it
expects is not there, because a prebuild prints hundreds of lines and the symptom
of getting this wrong is the app being **absent from a list**, which nothing logs.

- `CFBundleDocumentTypes` names the type by its UTI, `org.idpf.epub-container`.
  The system declares that type on Apple platforms —
  `UTType(mimeType: "application/epub+zip")` resolves to it, which is what the
  file picker already relies on — so no type declaration of our own is shipped.
  `LSHandlerRank` is `Alternate`: an EPUB is the platform's format, not this
  app's, and claiming to own it would put this app above Books for every book on
  the device.
- `LSSupportsOpeningDocumentsInPlace` decides what arrives. With it, a tap in
  Files hands over the owner's own file where it lives. Without it iOS copies
  into `Documents/Inbox/` first, for **every** open — a 34 MB book duplicated
  before any of this app's code runs.

The app must therefore handle both, and it tells them apart by **where the URL
is** rather than by asking iOS. iOS does know: `ExpoAppSceneDelegate` forwards
`UIScene.OpenURLOptions.openInPlace` into
`UIApplication.OpenURLOptionsKey.openInPlace`. React Native's `Linking` hands
JavaScript the URL string and drops the options, so the flag is not reachable. A
URL inside `Documents/Inbox/` is a copy iOS made and is moved into the Library;
anything else is the owner's file and is copied, leaving theirs alone.

The cold-launch case works only because ADR 0018's plugin is in place. Under the
UIScene life cycle UIKit puts the launch URL in the scene's connection options
rather than the app delegate's launch options, and `ExpoAppSceneDelegate` rebuilds
the launch options that `Linking.getInitialURL()` reads.

**Which path a given open takes was measured, and it is not the one the key
implies.** Opening an EPUB on the simulator by `file:` URL went through
`Documents/Inbox/` **with `LSSupportsOpeningDocumentsInPlace` set**. It was
caught by a bug rather than by looking: `expo-file-system`'s move rewrites the
handle it is called on (`url = destinationUrl`, `ios/FileSystemPath.swift:91`)
and its copy does not, so a title read after the file was kept came out as the
destination's name — which only the move path produces. The name is now read
first. The consequence for a reader is that **the in-place half of
`opened-document.ts` has not run on a device**: it is reached by a real tap in
Files, and this machine cannot send one.

## ADR 0017 loses its eyeball check, and gains a test

`src/app/controls.tsx` could say "nothing in `src/app/` imports `Linking`", and
one could check it by looking. Reading an incoming URL ended that. The property
is now stated as **nothing in `src/` calls `openURL`, `canOpenURL` or
`sendIntent`** and is checked by `test/app/no-outgoing-links.test.ts`, because it
is no longer something an eye can check.

## The publication's own identifier is still not recorded

ADR 0004 wants `dc:identifier` beside the hash and `readPackageIdentifiers`
exists to produce it — from the package document, which is inside the zip, which
nothing outside the WebView can open. The obvious substitute does not work:
epub.js parses `e.identifier = this.getElementText(t, "identifier")`, the
**first** `dc:identifier` in document order, with no reference to the package's
`unique-identifier` attribute. So epub.js cannot tell `'unique-identifier'` from
`'first-of-several'` — and those are exactly the two `identifyDocument` treats
differently, because the second must never be matched on. Every entry this build
writes records `'none'`, which is honest, rather than a source it guessed.

## What the Library costs, measured

**Hashing.** `documentIdOf` is SHA-256 in plain JavaScript and on Hermes it runs
at about **2.4 MB a second**: 14,362 ms and 14,399 ms on two runs over the
owner's 34,453,009-byte novel, against 1 ms for a 2,567-byte fixture. The
JavaScript thread is held for all of it, so adding that book **freezes the app
for fourteen seconds** — not slows it, freezes it, because drawing a spinner is
also JavaScript. End-to-end from `simctl openurl` to the file on disk was
14,960 ms, so the hash is essentially the whole cost and everything else the
Library does is under 600 ms.

It is paid once per Document. This is not a cost this ADR introduces so much as
the first time ADR 0004 reaches a screen, and the ways out — another runtime
(`react-native-worklets` is already a dependency), an incremental digest, a
native one — are all changes to `core/document`, which is where that decision
lives. Recorded here, unfixed, because it is the largest number this work
produced.

**The round trip.** After pushing Settings and popping it, marks written onto the
section documents beforehand are still there, the `CSS.highlights` entry is still
registered and its `Range`'s `startContainer.isConnected` is still true. On the
34 MB novel the reader is back with the highlight painted, 108 Utterances still
known and the scroll still at 917 px **within one second of the pop**, against
14.4 s of hashing plus about twenty seconds of rendering for a fresh open. The
property this ADR chose a native stack for holds.

**A trap in how that is tested.** Editing a constant and letting Fast Refresh
carry it in rebuilds epub.js's views, which replaces the `Range`s and clears the
highlight — indistinguishable from the defect being hunted, and it produced a
false positive that took an hour to unpick. The sequence has to run from one edit
with no refresh inside it. `notes/NOTES_2026-09-19.md`, 22:02.

**The anchor's context is often empty.** `createTextAnchor` takes its prefix and
suffix from the text it is handed, and here that text is the **Block**. Where an
Utterance is the whole Block — most paragraphs of the Chinese novel — there is
nothing either side and the anchor is a bare quotation, with the locator doing
the work alone. ADR 0008 asks for "enough surrounding context to find it again";
against a one-sentence Block there is none to be had. Worth knowing before the
first time an anchor has to be matched in anger.

**Resuming, verified once and not reproducibly.** The Romanian fixture reopened
at its stored CFI. 仙逆 did on one open and showed its cover on another, same
build — which is the book and the build of the 20:44 note, where two opens in
three render nothing at all. Not separable from that with what was measured, and
recorded as such rather than explained away.

## The versions, which are the SDK's and not npm's

`react-native-screens` `~4.26.0` and `react-native-safe-area-context` `~5.7.0`,
from the installed Expo's own `bundledNativeModules.json` rather than from npm
latest. `test/app-config.test.ts` reads that same file, so it asserts the rule
rather than a number that would have to be edited at the next upgrade.

## What this does not decide

Where the Library file is _synced_ to. ADR 0003 owns that, and this ADR
deliberately picks a shape that ADR 0003 can adopt rather than picking the sync
itself.
