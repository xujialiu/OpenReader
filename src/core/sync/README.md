# src/core/sync — ADR 0003

Reading positions and shared settings, over the owner's own WebDAV server, in
the **same folder** the Zotero-TTS desktop plugin already uses.

This is not a feature bolted on. ADR 0003 is blunt about it: sync is the reason
this app exists at all — the owner left Speechify specifically because it could
not keep a place across devices.

WebDAV over iCloud, which would exclude Android, and over a server of ours,
which ADR 0002 rules out. It also reuses work already done and already portable:
`core/webdav.ts` parses PROPFIND responses with regular expressions rather than
a DOM — a decision originally made so the plugin's tests could run under Node,
and which therefore works unchanged here.

## The folder is a contract between two products

Three properties of the existing format constrain how it can evolve. They were
verified in the plugin's code, not assumed:

- The shared-settings and positions parsers **reject a file whose `version` is
  higher than they know**, and the caller must leave it alone. A file written by
  a newer app stops every already-installed desktop copy from syncing that file
  until its owner updates.
- The three files do **not** share a version policy. The settings-backup parser
  never reads `version` at all and instead collects unknown keys into `ignored`.
  Harmless while one product wrote all three; not harmless now.
- The positions file is serialised canonically to **exactly four fields per
  entry**, so an older desktop build silently strips any field added to an entry
  on its next merge-and-upload — for every machine, with nothing reported.

**So new information belongs in a new file, never a new field.** The only two
places that read the folder listing filter it to names they already know, so
nothing enumerates, rewrites or deletes a file it does not recognise. An unknown
file name is free; a version bump is not.

Written up as issue #126 against the desktop plugin, which asks for a
`zotero-tts-documents.json` and a `docs/SYNC-FORMAT.md`.

## The three things that sync

**Reading Position** — where speech stopped in a document. One per document,
overwritten as the owner reads. Not a bookmark, not a list the owner sees. How
one is expressed is ADR 0008.

**Shared Settings** — merged setting by setting, so two devices changing
different settings both keep their change.

**Settings Backup** — one device's complete settings, written for that device
alone and never merged. Restoring one replaces settings rather than combining
them.

A **Stamp** — wall-clock time plus which device wrote it — decides which of two
copies of an entry wins.

## Injected, like everything in core

`fetch` comes in as a dependency. Nothing here imports `expo-file-system` or
anything else from the platform; `eslint.config.js` enforces that. It is what
lets the plugin's `test/core/webdav.test.ts` and the settings-sync tests come
across and run under Node.
