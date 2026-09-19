---
status: accepted
---

# Identify documents by their content, not by a library's key

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
