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
| bytes actually digested           | 94,876 — **0.28%**                    |
| time, Node                        | 3.8 ms                                |
| time, the digest alone on Hermes  | ~40 ms, predicted                     |
| time, full-file SHA-256 on Hermes | 14,362 ms                             |

The 40 ms is a prediction and is marked as one: `sha256.ts` runs at 2.399 MB/s on
this Hermes (measured, 14,362 ms for the file) and at 275 MB/s under Node on the
same code, and 94,876 bytes comes out at 40 ms by the first rate and 40 ms by
scaling the Node measurement of the manifest by the ratio of the two. It is two
frames of jank where the old rule was a fourteen-second freeze. What is **not**
predicted is the two reads that precede it, which no measurement here covers.

**Because CRC-32 is over the uncompressed bytes, the id survives re-compression.**
Proven rather than argued — the same book repacked at two deflate levels:

|                     | bytes      | full-file SHA-256 | this id     |
| ------------------- | ---------- | ----------------- | ----------- |
| as the owner has it | 34,453,009 | `e933d9c4…`       | `5c3d4aee…` |
| repacked, level 1   | 35,309,536 | `d1b0c681…`       | `5c3d4aee…` |
| repacked, level 9   | 34,429,453 | `e535efea…`       | `5c3d4aee…` |

Three files, three sizes, three different file hashes, one id. This deletes the
weakness the section above admits — "a file hash … changes when a file is
re-saved or re-compressed" — instead of continuing to carry it.

Re-run against the shipped code rather than the sketch the first measurement was
taken with, on a second pair of repacks made the same way (notes, 23:56). The
sizes came back identical and the file hashes did not, because a repacker writes
the current time into every member's header — which is itself the point: two
files that differ in bytes the owner cannot see are one Document.

**The id in this table is over the manifest _sorted_, which is what ships.** The
first measurement digested the members in the order the directory happened to list
them and produced `5559b6de…`; the owner's book is not stored in name order, so
sorting changed it. `5559b6de…` appears in the 23:19 note and is the unsorted
value, recorded here so that neither number is a mystery later.

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
  from the OPF spine rather than from the archive. Measured rather than assumed:
  the owner's book repacked with its 2,106 members in the opposite order has a
  different digest unsorted (`11241dbf…` against `5559b6de…`) and the same id
  sorted.
- **Sorting by the name alone is not a total order.** A ZIP may legally hold two
  members with one name, and their two lines would then be ordered by whatever
  the packer did — the one thing the sort exists to remove. The order is
  therefore the name's bytes, then the CRC-32, then the size.
- **Sort by the name's _bytes_, and digest those bytes.** A member name is UTF-8
  only when the general-purpose flag says so, and a name that is not valid UTF-8
  decodes to replacement characters — so two different names could decode to one
  string and collapse into one line. For a conforming EPUB, whose names are UTF-8,
  this is the same manifest either way.

### What it refuses, loudly

A file with no end-of-central-directory record is not a ZIP and therefore not an
EPUB; a ZIP64 archive (more than 65,535 members, or past 4 GB) is not handled.
Both throw rather than falling back to a whole-file hash, because a silent
fallback would mean the same book has two possible ids depending on a code path
— which is the one thing an identity may not have.

Implementing those two turned up five more of the same kind, and they throw for
the same reason rather than being coped with:

- **A read that returns fewer bytes than it asked for.** The platform call this is
  built on is `FileHandle.readBytes`, which is `read(upToCount:)` in
  `expo-file-system/ios/FileSystemFileHandle.swift` and is documented to return
  fewer. A short read quietly digested is a second id for one book, arrived at by
  the most ordinary means there is.
- **A member whose uncompressed size is `0xffffffff`.** That is the per-member
  ZIP64 sentinel, and an archive can carry it while its end record looks ordinary.
  Digested, it would give every member over 4 GB the same size.
- **A split archive**, whose directory is on a volume that is not this file.
- **A directory that does not end where the end record says it begins.** This is
  what an archive with bytes prepended to it looks like: every offset points a
  constant distance short of its record, at another member's data.
- **A record count that does not match the records**, in either direction — more
  members declared than the directory holds, or bytes left over after the last
  one, which is a member the end record did not count.

And one that is about the digest rather than the archive: **a NUL in a member
name**, because a NUL is what separates a name from its numbers, so `a\0b` with
one set of numbers would frame identically to `a` with another.

### The seam is a byte-range reader, not a `Uint8Array`

_Amends "How it is computed, given a platform-free core" above, whose words were
"the identity function takes a `Uint8Array` and the caller reads the file"._

That seam is now wrong, and not because the boundary moved — `src/core/` still
imports no file system (ADR 0013) and the file system still lives in
`src/app/document.ts`. It is wrong because the whole benefit of this decision is
reading 220,092 bytes instead of 34,453,009, and a function taking the whole
file's bytes throws that away in the caller, one line before it is handed over.
The core would then be reading 0.64% of something the app had already paid 34 MB
for.

So the identity function takes a length and a `read(offset, length)` that returns
exactly that many bytes, and decides for itself which two ranges it wants. The
app implements that over `expo-file-system`'s `FileHandle` — about six lines — and
a test implements it over a `Uint8Array` in four, so the range arithmetic the
device runs is the range arithmetic the tests run.

Three other shapes were considered and each fails on something specific:

- **The caller reads the tail and passes that.** The cheap version, and it puts
  the one thing this must not delegate in the layer that must not know it: how
  much of a ZIP to read. The end record can sit 65,535 bytes from the end and the
  directory can be any size — 154,535 bytes in the owner's book — so "the tail" is
  a number the caller would be guessing, and a guess that is too small is not an
  error, it is a different id.
- **Two phases: the core says which ranges, the caller reads them, the core
  digests.** The second range is inside the first — the directory's offset is a
  field of the end record — so the plan cannot be computed before the first read.
  It would be two round trips and a piece of the core's state living in the app
  between them.
- **An asynchronous reader.** `FileHandle.readBytes` is synchronous, so a promise
  buys nothing real and makes naming a Document a promise — the same argument
  `sha256.ts` already gives for not wanting `crypto.subtle`. If a range ever comes
  from somewhere that is genuinely async, the caller reads it first; that is the
  one direction this shape does not close off.

What the caller must now do differently, since it cannot be done in `src/core/`:

```ts
const handle = source.open(FileMode.ReadOnly);
try {
  identity = identifyDocument(
    {
      size: source.size,
      read: (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    },
    'epub',
  );
} finally {
  handle.close();
}
```

`await source.bytes()` goes, and with it the only reason the 34 MB ever crossed
the bridge at add time. The handle is closed before the file is moved into the
Library, because `keepDocument` renames the file the handle is open on.

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

**The `sha256:` prefix stays, and it does not distinguish the two rules.** An id
from the old rule has exactly the shape of one from this rule, so an old entry in
the Library file parses, opens the file it names, and is simply never matched by a
freshly computed id — the owner sees the book, adds it again, and gets a second
entry. That is the migration above, visible rather than silent. What the prefix
names is the digest, and the digest has not changed; what names the rule is the
first line of what gets digested, `epub-zip-v1`, so replacing the rule changes
every id's hex rather than its prefix. Renaming the prefix to name the rule was
the louder signal and was not taken: it would also rename
`Documents/library/sha256-<64 hex>.epub` (ADR 0019), leaving the three books'
files orphaned on disk with nothing that would ever delete them.

One name changed with the rule. `matchIdentities` answered `'same-bytes'` for two
identities with one id, and that is now false in the case this decision exists
for — a repack has different bytes and the same id. It answers `'same-contents'`.
