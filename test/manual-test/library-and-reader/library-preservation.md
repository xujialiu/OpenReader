# Library data preservation under storage failure (#260, #233, #261)

Record of the combined simulator verification of 1.0.0 (9)-beta17 at `1be7d8a`
(branch `xujialiu/fix_1--ios-library`, 2026-10-20). The commits under test:
c63b682 (#260, Library saves reuse the native atomic `writeJson`),
4fe025f (#233, frozen loads and shared write guard), 0e05c82 (#261, staged
import committed by native `replaceFile`/Darwin rename). ADR 0019 documents
the contract.

## Setup

- Session-owned device **iPhone 17 libfix**, UDID
  `7E774225-BFD8-455C-9BA4-6E108BC8F9FB`, iOS 26.5 runtime, created and booted
  for this run. Native build: `npx expo prebuild --platform ios` +
  `xcodebuild -workspace ios/OpenReader.xcworkspace -scheme OpenReader
  -configuration Debug -sdk iphonesimulator -destination id=…` → exit 0; the
  app's `OpenReader.debug.dylib` exports
  `_$s17OpenReaderOffline21replaceFileAtomically…`, so the #261 helper is in
  the binary. `version.txt` and the Settings line both read
  **1.0.0 (9)-beta17(-debug)**. Metro on 8081 served from the parent
  worktree; the app's `RCT_jsLocation` pinned to it.
- Admission by `kit/ios_guard.py run` (phase record
  `/tmp/openreader-libfix-01/phase1.json`); readiness by `kit/ios_ready.py`
  with `--metro` (first attempt 69: CDP answered 0 targets because the check
  ran before the app's first bundle finished; same-attempt recheck passed).
- Real books: disposable **copies** of `Cultivation Online 2001-2044.epub`
  (360 KB) and `The Innkeeper 2001-2153.epub` (560 KB) from
  `~/Works/epub_books`; originals' sha256 recorded before and after —
  unchanged. Nothing from the books' text is quoted here.

## Control: a healthy Library round-trip (all real app paths)

1. Harness `add` of the CO copy → `HX added sha256:f8fbd467…`; kept file
   `Documents/library/sha256-f8fbd467….epub` byte-identical to the source
   (sha256 `fa610f74…`); `library.json` written with the entry (native
   `writeJson`).
2. Harness `open` → the book renders in the reader (screenshot).
3. UI rename (drawer → Rename, typed with native readback "CO control 2044",
   Save) → `library.json` and `display-names.json` both updated.
4. Relaunch → shelf lists the entry under the renamed title; the book opens
   and renders again.
5. Re-add the same file → same Document Id, still exactly one entry, kept
   file replaced in place and byte-identical, book opens.
6. Deliberately deleted kept file, relaunch, re-add the same copy → file
   restored byte-identical (md5 `088c00ca…`), entry intact, opens.

A reading position is **not** written while paused (`reached` writes only
while speech is heard, #228/#96), and no provider was enabled, so position
persistence is not part of this record.

## Failure checks (injected, not a real full device)

Baseline hashes of `library.json`, `display-names.json`,
`library-folders.json`, `library-id-rule` and a listing of `library/` were
recorded before each attempt and diffed after (`/tmp/openreader-libfix-01/fixture/pre-*`
vs `post-*`).

1. **Truncated `library.json` (#233).** App stopped, file cut to 100 of 396
   bytes. Launch: shelf note "The Library file is not JSON. Nothing has been
   changed; it is still there to look at.", Library screen empty with the red
   note (screenshot). Harness `add` of the INK copy: `HX add refused: Error:
   The Library file is not JSON…`. Every store byte-identical, no new kept
   file, no `.import-*` leftovers.
2. **Newer version without `entries` (#233).** App stopped, file replaced
   with `{"version":3,…}` and no entries key. Launch: note "…written by a
   newer version of OpenReader (version 3)… leaving it alone…" — the version
   is judged before the entries layout, no crash. `add` refused with the same
   sentence; no mutation.
3. **Kept-files directory unwritable (#261 commit path).** Control library
   restored; `chmod 555 Documents/library`; harness `add` INK: refused at the
   real staging step — native log: `UnableToCreateException … ".import-…"
   in the folder "library"`. The existing CO kept file and every store
   byte-identical (and `library.json`'s mtime unchanged — no write attempt).
4. **Documents unwritable (#260/#233 side).** `chmod 555 Documents`; the app
   still launched and the shelf stayed healthy. UI rename → Save: the drawer
   showed "You don't have permission to save the file 'display-names.json'…"
   and the row kept its old name. `library.json`, `display-names.json`,
   `library-folders.json` byte- and mtime-identical. A rename's
   `saveDisplayName` refuses before the Library write, so the two stores stay
   consistent. A host `chmod` refusal fails before any byte moves, so it
   cannot tell the old in-place writer from `writeJson` — truncation
   behaviour itself stays with `test/app/library-storage-failure.test.ts`.

All permissions were restored to 755 and the container's Documents restored
from the pre-failure backup (with `harness.json` removed — see pitfalls)
before delivery.

## Finding (pre-existing, outside this batch's claims)

During check 4's launch, the **leftover harness command replayed**
(`harness.json` still held `add INK`) and — `library/` being writable again —
the import **kept the INK file into `library/` and then refused** at the
Folder store (`library-folders.pending.json`, Documents read-only), leaving a
committed orphan kept file with **no** Library entry. Root cause: `add` runs
`keepFile` before `folders.place`, identical at base 77a0b91 — a refusal
after the file is kept but before the entry commit leaves an orphan. This is
not one of the batch's three guarantees (the frozen-Library preflight of
#233 held in checks 1–2, and the saved Library was never damaged), but ADR
0019's "import … refuse before changing document files" is narrower than the
code's behaviour when the **Folder** store fails late. Reported to the
parent; not fixed here.

## What this cannot prove

- No refusal was produced by a full iPhone's storage exhaustion; every
  failure here is an injected filesystem state on a simulator container
  (chmod) or a seeded corrupt file. `test/native-storage/run.sh` compiles the
  real helper on the host; this record adds the native module running inside
  the app on a simulator.
- The #261 source-side cases (Expo scoped-access move of a Files handover,
  EXDEV) were not exercised; the harness `add` reads from the app's own
  Documents/Inbox.
- Rename's refusal under a frozen Library cannot be reached from the UI (a
  frozen Library shows no rows); it is covered by
  `test/app/library-protection.test.ts` only.
- Playback was not used; position/voice writes are untested here.
