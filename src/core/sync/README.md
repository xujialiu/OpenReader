# src/core/sync — ADR 0003, ADR 0031

Reading positions over the owner's own WebDAV server, in the **same folder**
Zotero-OpenReader already uses.

This is not a feature bolted on. ADR 0003 is blunt about it: sync is the reason
this app exists at all — the owner left Speechify specifically because it could
not keep a place across devices.

## The contract is the plugin's `docs/spec/SYNC-FORMAT.md`

The folder became a contract between two products on 2026-09-21, and the
contract is written down in the plugin repository, not here. This directory
implements section 6 of it — the **Positions File**, `xujialiu-positions.json`
— and adds nothing. Where a rule below looks arbitrary, the spec says why.

Three files:

- `webdav.ts` — the plugin's client, **copied** (ADR 0013's rule), with its test
  brought across. `fetch` is injected; `btoa` and `TextEncoder`, which it rests
  on, are both on this Hermes (notes/NOTES_2026-09-19.md, 12:21).
- `positions-file.ts` — parse, canonical serialise, merge. Canonical bytes so the
  transport can compare text; **carry through, never drop** an item this build
  cannot use, because a phone that dropped the desktop's PDF positions on its way
  through would erase them for every machine; a newer `version` is left alone; a
  malformed file is treated as absent and healed by the next upload.
- `transport.ts` — download, merge, adopt, conditional upload, single-flight,
  one report per retry window. The Library enters through `local()` and
  `adopt()`; nothing here imports the platform.

## What is decided here, and what is not

The **merge** is the spec's: union by Document Id, the greater `stamp.at` wins,
an equal one keeps this device's, nothing is ever removed. The Stamp compared is
the **position's own** (`core/document/stamp.ts`), which moves only when speech
stops somewhere new — not the Library entry's, which moves whenever the owner
touches the book and would let a glance at the shelf beat a chapter read on the
desktop.

**When** a sync runs is not decided here. `src/app/use-sync.ts` pokes the
transport at launch, on returning to the foreground, on entering the background,
on opening a book, on adding one, on a pause, and when a Reading ends (leaving the
reader while it is paused, opening another book, or deleting it; #68); never on
a timer while reading. It also waits on one, bounded, before Play.

**What the shelf does** with an adopted item is `src/app/sync-items.ts`: an item
newer than the entry's position replaces it, the shelf Stamp follows when the
item is newer still, and a Document this device does not hold is not its to
keep.

## The other three files in the folder

`zotero-tts-settings_<machine>.json`, `zotero-tts-shared-settings.json` and
`zotero-tts-positions.json` are the plugin's own and are neither read nor written
here. The last is keyed by Zotero's `{lib, key}`, which a phone cannot produce,
and is serialised to exactly four fields, so a document id or a text anchor could
not be added to it without a version bump that stops every installed desktop
copy from syncing — which is why the Positions File is a new file (ADR 0003,
plugin issue #126).
