---
status: accepted
---

# Identify documents by their content, not by a library's key

_The product argument — what this is for and what it gives up — is
`docs/design/0004-a-document-is-recognised-by-itself.md`._

A document is identified by an id derived from its own bytes and metadata — a
hash of the file, with the EPUB's `dc:identifier` as a secondary match — and
not by the Zotero `{ libraryID, itemKey }` pair the desktop plugin uses. The
phone has no Zotero library and therefore cannot produce that pair.

## Considered options

Reusing Zotero's item key would have required the phone to obtain its documents
from Zotero, either through Zotero's own WebDAV attachment sync or its web API.
That was rejected in favour of content addressing plus manual import, because
it would have made a Zotero library a precondition for reading anything.

## Consequences

Two phones recognise the same document with no shared catalogue at all, so
position sync between the owner's own devices needs nothing from Zotero. The
desktop plugin's `{ libraryID, itemKey } → document id` mapping becomes an
optional join, used when a document also happens to live in Zotero, rather than
a dependency.

The boundary this draws should be stated plainly rather than discovered: a
document imported by hand that is not also in Zotero has no desktop
counterpart, so cross-product position sync does nothing for it. That is the
design, not a defect.

A file hash is unambiguous but changes when a file is re-saved or re-compressed;
`dc:identifier` survives re-saving but is often missing or duplicated in real
EPUBs. Recording both, with the hash authoritative, is what makes each cover
the other's failure.

## How it is computed, given a platform-free core

A hash needs the file's bytes, and reading a file needs a platform API that
`src/core/` is forbidden to import (ADR 0013). It is resolved the same way the
provider layer resolves `fetch`: **the identity function takes a `Uint8Array` and
the caller reads the file.** So the identity rule stays pure and testable, and the
file system stays outside the core.

## The hash is over the ZIP central directory, not over the file

_Amends the two sections above: "a hash of the file" is now a hash of the
archive's own manifest. The product argument is in the design file._

Hashing 34 MB on Hermes froze the app for **14.4 seconds** (14,362 ms and
14,399 ms on two runs of the owner's `仙逆`, ~2.4 MB/s), and no spinner can render
during it because drawing one is JavaScript on the same thread. That is what
forced this, but it is not the whole reason it is better.

An EPUB is a ZIP, and a ZIP ends with a central directory: one record per member
carrying its name, its uncompressed size and **a CRC-32 of its uncompressed
bytes**. The identity is a SHA-256 over that manifest — `(name, crc32,
uncompressed size)` per member, members **sorted by name**, prefixed with a
version string so this rule can be replaced without silently changing ids.

Measured on the owner's book (34,453,009 bytes, 2,106 members):

|                                   |                                       |
| --------------------------------- | ------------------------------------- |
| central directory                 | 154,535 bytes — **0.45%** of the file |
| bytes read to compute an id       | 220,092 — **0.64%**                   |
| time, Node                        | 3.8 ms                                |
| time, full-file SHA-256 on Hermes | 14,362 ms                             |

**Because CRC-32 is over the uncompressed bytes, the id survives re-compression.**
Proven rather than argued — the same book repacked at two deflate levels:

|                     | bytes      | full-file SHA-256 | this id     |
| ------------------- | ---------- | ----------------- | ----------- |
| as the owner has it | 34,453,009 | `e933d9c4…`       | `5559b6de…` |
| repacked, level 1   | 35,309,536 | `d1b0c681…`       | `5559b6de…` |
| repacked, level 9   | 34,429,453 | `e535efea…`       | `5559b6de…` |

Three files, three sizes, three different file hashes, one id. This deletes the
weakness the section above admits — "a file hash … changes when a file is
re-saved or re-compressed" — instead of continuing to carry it.

### Traps, each of which would undo the property

- **Do not put the file's length in the id.** It is the obvious extra
  discriminator and it changes with the compression level, so including it
  reinstates exactly what this removes. The member count and each member's
  _uncompressed_ size are already in the manifest and are compression-invariant.
- **Do not hash the tail's raw bytes.** Reading the last N bytes is the cheap
  version of this and is not the same thing: those bytes carry each member's
  _compressed_ size and offset, so they change when the file is repacked.
- **Do not hash the head.** By EPUB's own packaging rule the first member is an
  uncompressed `mimetype`, so the first 38 bytes are byte-identical in every
  conforming EPUB.
- **Sort by name.** A repacker may emit members in a different order; document
  order is not part of what makes a book this book, and the reading order comes
  from the OPF spine rather than from the archive.

### What it refuses, loudly

A file with no end-of-central-directory record is not a ZIP and therefore not an
EPUB; a ZIP64 archive (more than 65,535 members, or past 4 GB) is not handled.
Both throw rather than falling back to a whole-file hash, because a silent
fallback would mean the same book has two possible ids depending on a code path
— which is the one thing an identity may not have.

### What is given up

CRC-32 is **not** a cryptographic hash: two different archives claiming identical
member names, sizes and CRCs can be constructed deliberately. Since the id is
also the file name under which the bytes are kept, a collision means one book
standing where another was. This is accepted: the threat model here is the
owner's own books, not hostile ones, and the alternative costs 14.4 seconds of
frozen UI on every first open. No second check runs when an id already exists —
a matching id _is_ the same book, which is the whole point of the decision.

`dc:identifier` remains the secondary match and gets cheaper: the central
directory gives `content.opf`'s offset and size, so reading it no longer means
scanning the archive.

### Migration

Ids computed by the old rule do not survive. At the time of the change the shelf
held three books and nothing was synced (`src/core/sync/` is empty), so they are
re-added. Doing this after positions have synced between devices would have cost
a great deal more, which is why it was done at once rather than scheduled.
