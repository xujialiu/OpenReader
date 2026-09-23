---
status: proposed
---

# A native stack, and a Library that is a file

The provider configuration UI, player eligibility and new-document voice default
are revised by [ADR 0026](0026-a-coherent-reading-interface.md). Historical
measurements below are retained unchanged.

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

**Read back** as `<Reader initialLocation>`, which the library applies inside its
own `onReady` by injecting `rendition.display(cfi)`, just before it injects the
highlighter. That moves the page, but a frame later than this paragraph used to
say. epub.js runs a display on its next animation frame, while the highlighter
installs at once and reports what the library's own opening `rendition.display()`
has already put on the page: the book's first sections, not the one the owner
was left in. Measured on 2026-09-23, #51: items 1, 2 and 3 of the owner's book
reported first, and the stored item 20 after them.

**Read back a second time, as the Utterance to read from.** This ADR recorded
that it was not: "playback does not resume *at* that Utterance. The page is where
it was; Play starts from the first Utterance of what has rendered." It now does,
and the join is three steps with no new coordinate system in it —
`resolveReadingPosition` turns the locator and the anchor into a place and an
offset into that place's text, and `utteranceAt` turns an offset in a Block into
an Utterance index, which is the same function a tapped word already goes
through. `resolveResume` in `src/renderer/cursor.ts` is the whole of it.

Four things about it that are decisions rather than plumbing:

- **The Blocks are the document it resolves against.** A `ReportedBlock` already
  carries the two halves of a `Place` — its element CFI and its verbatim text — so
  `reportedPlaces` is a view over them and nothing is asked of the WebView. A
  Block epub.js could give **no** CFI for is left out: two nameless Blocks would be
  one locator meaning either of them, and an answer that cannot be named cannot be
  reported back.
- **It is tried on every report until it lands.** It cannot be resolved at mount —
  the anchor is matched against Blocks and none has been reported yet — and the
  first section to render is not always the one the position names: a cover renders
  first and yields nothing, and the section `initialLocation` asked for arrives when
  epub.js has displayed it. On the 2,077-section novel that is twenty seconds away.
- **Until the section its locator names has reported, it is looked for nowhere
  else** (#51). `resolveResume` takes the spine's length and the set of items that
  have reported, including an item that reported no Block, and answers `waiting`
  while the locator's own item is missing. Before this, a missing section read as
  a locator that did not resolve, and the anchor was searched for in whatever had
  reported. For a place on a chapter heading that was the contents page. The
  heading is a Block of its own, so its anchor has no context either side, and the
  contents line matched it exactly and uniquely. The reading resumed there with
  "The paragraph this book was left in is not where it was", and the next place
  written over the stored one would have been the contents page (measured
  2026-09-23, `notes/NOTES_2026-09-23.md` 19:24). Once the section is in, nothing
  is different: the locator is verified, or the anchor is searched for everywhere
  reported, now including that section. A locator with no spine step, or one past
  the end of the spine, names nothing that will ever report and is searched for at
  once. The opening place's section is asked for by `initialLocation` alone. A
  second `goTo` would be a second `rendition.display()` of the same section. While
  the first is still loading, that clears the half-built view and starts again,
  because `Views.find` matches only displayed views. Once the section is there, it
  scrolls the Block back to the top of the screen, under the centring the resume's
  own `show` has just done. An adopted place still asks on each report
  (`revealPendingPlace`), because nothing else would.
- **Anything else deciding where to read ends the bookmark's claim.** A press of
  Play, a tapped word, a skip, a contents row. Without that, a position resolving
  late would take the reading away from wherever the owner had just put it — which
  is ADR 0008's "silent landing three paragraphs away" arriving by the back door,
  late instead of wrong. The sentence it would have said is kept and shown at the
  moment it is given up on, rather than shown on the first failed attempt: a book
  that has rendered its cover and nothing else has not failed yet, and saying so
  would be false for a second and then replaced.
- **There is no fourth outcome.** `resolveResume` answers with an Utterance or
  with why there is none, and the "why" carries no number at all — so no caller can
  read a best guess off it. Starting at the first Utterance of what has rendered is
  then a decision the screen makes openly, and says: `ReadingStatus.resume` is one
  sentence, its own field rather than a second meaning for `note`, changing at most
  twice in a Document's life.

**What it cost, measured** (notes/NOTES_2026-09-20.md, 03:01–03:04). The fixture
came back on Utterance 4 of 18 with the stored sentence painted and the voice
starting on it; 仙逆 came back on Utterance 166 of 234, which is 第492章贪狼之行,
the same index the 01:13 contents measurement reached by tapping. With the join
mutated out, both fall back to exactly what this ADR recorded: the page in the
right place, `utterance` null, "18 Utterances ready. Tap a word to read from
there."

**One thing this makes worse, and it is not new.** The cleanup on
`engineIdentity(settings)` clears `atRef`, so choosing a different Provider or
Voice discards where the reading had been pointed — including a place it had just
resumed to. That was true of a tapped word before today and is simply worth more
now. Not changed here: the cleanup is the one place the audio session is given
back, and moving what it clears belongs to whoever next touches it.

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

## Settings is three routes, and choosing a Provider is not a side effect of looking at one

`Settings` is a list of two rows. `General` holds what is true of the whole app;
it held nothing and said so, and it now holds the **theme** (ADR 0022) — the one
setting that is a fact about the room the owner is in rather than about a book.
`Providers` lists every Provider and opens one per route, `Provider: { id }`,
whose title is that Provider's own name.

Three decisions inside that, each of which could have gone the other way:

- **The Providers list does not select.** Tapping a row opens it; making it the
  one that reads is a press on the Provider's own screen, where what it needs is
  visible at the moment of choosing. A list that selected on tap would make
  "look at what Fish Audio wants" and "stop reading with Kokoro" the same
  gesture, and the second is the one the owner would not notice having made.
- **The Voice section appears only on the Provider in use.** What that screen
  holds is the **default** Voice — a Document keeps its own (ADR 0010), and the
  default belongs to the Provider that is reading (CONTEXT.md) — and
  `providerSettings` puts a credential in the section of the Provider the
  settings name and in no other (philosophy rule 3) — so asking a Provider that
  is not in use for its Voices would be asking with an empty key. The address,
  the model and the credentials of a Provider that is not in use are all still
  editable, and are kept for when it is.
- **A row says what is behind it, not just its name.** `providerFields` derives
  that sentence from the same predicates the screen asks — `keyIsOffered`,
  `headersAreOffered` — so a Provider that gains a field cannot end up with a row
  that does not mention it. The row for the Provider in use carries `readiness`
  instead, which is the only row that can: it is the only one whose key has been
  looked up.

The draft still commits on unmount, and it now lives on the Provider screen
rather than on the Settings screen, because that is the screen that edits.
Nothing on the list screens is editable, so nothing on them is a draft.

## The gateway headers are a credential, so they are in the Keychain and not in the settings

`ProviderSettings['local']` is `{ engine, baseURL, headers? }` and `factory.ts`
has passed `parseHeaderList(settings.local.headers)` to the engine since the
layer was ported. **No settings field held it.** That one gap is why the owner's
own Kokoro answered 403 (notes/NOTES_2026-09-19.md, 22:48), and why no highlight
this app had ever painted on a device had been following a real voice — the
19:05 and 23:24 entries ran real timings through the real consumers, but under
Node, with no screen and no audio hardware at the end of them.

The field exists now, on `local` and on `compatible` — exactly the two sections
`ProviderSettings` declares `headers?` on, which is exactly where the factory
parses it. Not on the other three: a field there would be typed into and do
nothing, which philosophy rule 6 forbids. `compatible` gets one rather than only
the local engine because the thing a gateway sits in front of is a *server*, and
an address that speaks OpenAI's API is as likely to be the owner's own as one
that speaks an engine's — the owner's desktop export settles that as a fact
rather than a guess, since it carries the same header text under three separate
service keys.

**Where the value lives was the decision, and it is the Keychain.** ADR 0002 puts
an API key there; this is not an API key, so the argument has to be made again
rather than inherited. It is made on ADR 0002's own three grounds, each of which
holds:

1. **It is a bearer credential.** A Cloudflare Access service token is a client
   id and a secret, and it opens everything behind that Access application, not
   only a speech server.
2. **It is needed on the synthesis path with the screen locked.** Same as a key,
   so the same accessibility: `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, readable
   during locked background playback, never migrated to another device.
3. **The alternative destination is not "a settings file", it is ADR 0003's Sync
   Folder.** `AppSettings` says in its own comment that its eventual home is the
   owner's own sync folder. Philosophy rule 3 is that a credential goes to the
   Provider it belongs to and to nowhere else, and a sync server is somewhere
   else. The desktop plugin does put this text in its exported settings, and its
   settings export is what its WebDAV upload sends — which is precisely the shape
   ADR 0002 already declined to copy for API keys.

Size is not the argument but is worth recording: the owner's header text is 151
characters, against the roughly 2 KB above which Keychain values have
historically been refused.

**What ADR 0002 does not cover, and this adds.** A key is one opaque string; this
is several `Name: value` pairs, and the names are not secret. They go into the
entry with the values anyway, because the owner pastes the pairs as one thing and
splitting the secret half out would mean two fields for one paste. So a second
entry *kind* beside `provider-key.<id>`: `gateway-headers.<id>`, one per
Provider, through the same `SecureStoreOptions` object — two option objects would
be two places for the service name to drift, and `test/keys/provider-key.test.ts`
asserts that exactly one accessibility is named in the file. One entry per
Provider is what makes philosophy rule 3 true of headers as well as of keys: the
text typed on one Provider's screen cannot reach another's, which is not true of
the desktop export's one copy under three keys. The price is that an owner behind
one gateway with two services pastes the same token twice, and that is the same
price ADR 0002's "one key per entry" already charges.

The field is **not** `secure`. That is deliberate and it is the one place the two
credentials are treated differently: a dotted line over `Name: value` pairs tells
the owner nothing about whether they pasted a client id where a secret belonged,
and the name half has to be readable for the field to be checkable at all. What
is stored is never read back out to the screen, so the field is empty unless it
is being typed into — the same rule the key field already follows.

## A credential written on one screen has to reach two others

The Library, the Reader beneath the stack and the Provider screen being typed
into are all mounted at once, and only the last of them writes. Two consequences,
and the second is worse than the first:

- The Reader's `keyPresence` was looked up when it mounted, so pasting a key and
  coming back left Play disabled for a key that was saved. The ADR chose a native
  stack precisely so that Reader → Settings → back does not remount the Reader,
  which is what makes this reachable.
- An engine already built around a credential that has since been replaced goes
  on using the old one. Pasting the right gateway token and still being refused
  looks exactly like pasting the wrong one, and nothing on the screen separates
  them.

So the shell holds `secretsWritten`, a count of writes — not a credential, and
not even whether there is one. `use-provider-secrets.ts` re-looks when it
changes and bumps it after every save and forget; `use-reading.ts` folds it into
the engine identity beside `engineIdentity(settings)`. It is coarser than
comparing values, since a save that changes nothing still rebuilds, and that is
the right way round: the cost is one rebuild of an engine whose Clips are already
in the memory cache, against a refusal the owner has just fixed and cannot clear.

## What the device said

Measured on the simulator against the owner's own servers and 仙逆, and written
up in full at notes/NOTES_2026-09-19.md, 00:00 and 00:05.

- **The mutation.** Gateway headers removed from the Keychain, nothing else
  changed: `Kokoro speech: the server rejected the credentials (403)`, and no
  Clip arrives. Saved: 68 voices, 8 of them `zh`, and audio.
- **Kokoro's Chinese voices report no Word Timings** and the screen says so —
  `w=0/0`, the whole Utterance painted, nothing estimated (ADR 0005). Exactly the
  empty `timestamps` array of the 22:48 entry, now arriving through the app.
- **Fish Audio highlights per character on Chinese.** Six samples across 89 s:
  the painted character was the one the audio clock named in four of them, one
  character early in one and two characters early in one — worst case 0.31 s,
  never late. About one character of that is the instrument: the expected
  character was printed by a text node refreshed 10 times a second against a
  highlight repainting at 60.
- **The anchor does not drift.** The Clip's audio position against wall clock
  since its cue stayed within ±6 ms over 65 s (Kokoro) and within +12…+28 ms over
  89 s (Fish), with no trend in either.
- **The clock is the audio's.** Content position advanced at **1.4999×** in both
  runs against a playback rate of 1.5 — which is what ADR 0012 asks for and what
  `AudioContext.currentTime` could not have produced.

One thing seen and left: `The highlight could not be drawn: Block 1.1 is in
section 7, which is not on the page` appeared once during the Fish run, and the
highlight went on being correct for another minute. The note is sticky, so the
screen says it happened rather than that it is still true. `src/renderer/` was not
this task's to edit.

## What this does not decide

Where the Library file is _synced_ to. ADR 0003 owns that, and this ADR
deliberately picks a shape that ADR 0003 can adopt rather than picking the sync
itself.
