---
status: accepted
---

# Sync over the owner's WebDAV, in the desktop plugin's own folder

_Revised by [ADR 0031](0031-positions-cross-products-by-document-id.md): the
`zotero-tts-documents.json` asked for below is not built. Positions cross
products in `xujialiu-positions.json`, keyed by Document Id, and the contract
is the plugin's `docs/spec/SYNC-FORMAT.md`. The three properties verified
below still hold and still shape that file._

*The product argument — what this is for and what it gives up — is
`docs/design/0003-your-place-follows-you-on-storage-you-own.md`.*

Reading positions and shared settings sync through a WebDAV server the owner
already runs, in the same folder the Zotero-TTS desktop plugin uses, so that a
position reached on the desktop can be resumed on the phone and the reverse.

WebDAV is chosen over iCloud, which would exclude Android, and over a server
of ours, which ADR 0002 rules out. It also reuses work that is already done and
already portable: `core/webdav.ts` parses PROPFIND responses with regular
expressions rather than a DOM, a decision originally made so the plugin's tests
could run under Node, and which therefore works unchanged in React Native.

## Consequences

The files in that folder stop being one plugin's private storage and become a
contract between two products, so they need a written, versioned specification.
Three properties of the existing format constrain how it can evolve, and they
were verified in the code rather than assumed:

- The shared-settings and positions parsers reject a file whose `version` is
  higher than they know, and the caller must leave it alone. So a file written
  by a newer app stops every already-installed desktop copy from syncing that
  file until its owner updates.
- The three files do **not** share a version policy today. The settings-backup
  parser never reads `version` at all and instead collects keys it does not know
  into `ignored`. This was harmless while one product wrote all three files.
- The positions file is serialised canonically to exactly four fields per entry,
  so an older desktop build silently strips any field added to an entry on its
  next merge-and-upload — for every machine, with nothing reported.

New information therefore belongs in a **new file** rather than a new field: the
only two places that read the folder listing filter it to names they already
know, so nothing enumerates, rewrites or deletes a file it does not recognise.
An unknown file name is free; a version bump is not.

This was written up as issue #126 against the desktop plugin, which asks for a
`zotero-tts-documents.json` and a `docs/SYNC-FORMAT.md`.
