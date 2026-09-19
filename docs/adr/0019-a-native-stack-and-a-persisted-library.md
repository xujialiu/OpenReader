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
changes between installs, and a document picked from Files lives outside it. So
an entry stores a security-scoped bookmark and re-resolves it on use; a resolve
that fails is surfaced on the entry rather than deleting it, per the design file.
The Document Id is the identity regardless, so the same book added twice from two
places is one entry.

## What this does not decide

Where the Library file is _synced_ to. ADR 0003 owns that, and this ADR
deliberately picks a shape that ADR 0003 can adopt rather than picking the sync
itself.
