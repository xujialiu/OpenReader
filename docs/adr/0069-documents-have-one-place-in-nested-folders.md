---
status: accepted
---

# Documents have one place in nested folders

Device-local organization lives in `library-folders.json`, keyed by stable Folder ids and Document ids, rather than in the shared Positions File or filesystem paths. The owner explicitly chose local-only folders (#121, design 0069); adding folder fields to the shared format would couple ordinary organization to Zotero compatibility. Existing Library entries have implicit root membership, so no Document identity, position or audio migration is required.

The folder store validates the entire hierarchy and refuses unknown versions, unknown fields, missing parents and cycles without rewriting the file. A stale remembered browsing location alone falls back to root. Writes stage through a pending file and complete before a new snapshot is published. This is not a cross-file transaction: new imports persist membership before adding the Library entry; an interruption can leave an unused membership, which a later new import replaces, but cannot report a successful import in the wrong Folder.

Recursive deletion locks organization, removes each Document's offline narration and Library entry, and removes the Folder subtree last. Library import and deletion use write-before-publish commits. A failed deletion keeps the remaining subtree reachable for retry; already deleted Documents are not promised to return. Membership left by an individually removed Document is unused until a new import explicitly assigns its location. Folder changes do not stamp Library entries or touch the position-sync projection.

The owner selected prototype B (local branch `xujialiu/folder--density-prototype`, commit `7ddfeea`) after simulator review: a shared 84-point row at the default system text size, 40×56 Covers inside a 56-point illustration column, and 44×38 layered blue Folder artwork. The shared row scales with `fontScale`, so Folder/Document types and title lengths cannot choose different row heights. Direct child counts use live Library Document ids rather than all stored memberships, since an individually removed entry can leave an unused membership.

Picker and external imports share duplicate handling. Cold external arrivals wait for Library loading and navigation readiness, and external arrivals are processed serially so two duplicate alerts cannot replace one another. The add Drawer waits for native dismissal before opening the system picker; it remains mounted for that dismissal callback.
