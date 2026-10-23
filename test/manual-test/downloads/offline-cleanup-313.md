# Offline cleanup races, the legacy audit, and #175's rekey on the device (#313, #176, #175)

Record of the independent device verification of 22f7957 (`fix: revalidate offline
cleanup inside the file queue`), 2026-10-23, on a session-created iPhone 17
(`iPhone 17 ver313`, iOS 26.5, `C12BBF13-BDDD-4CA2-B7C2-95FEA43AF106`), Debug app
1.0.1 (14)-beta4-debug built from that tree (guarded prebuild + `xcodebuild
RCT_METRO_PORT=8313`), Metro 8313 from the same worktree, and the kit's
`fake-kokoro-two-voices.cjs` on 127.0.0.1:8913. The Provider is Local Kokoro at
the fake; Consent was asked once and answered after the recipient was checked.
No audible playback ran (nothing was ever played; storage and scheduling were
the objects under test). No paid Provider was touched.

Two new kit scripts came out of the run; both live here:

## `offline-audit.cjs` — catalog-vs-disk agreement

```sh
node test/manual-test/downloads/offline-audit.cjs UDID [--strict] [--json]
```

Copies `Documents/offline-narration-v2/catalog.sqlite` (+WAL/SHM) to a temp
directory (read-only against a running app) and reports, per Document and Voice,
clip counts by state, and for every `ready` row whether its payload file exists
and matches the sidecar's recorded size. Lists `audio-verified:<document>`
markers from the `state` table. `--strict` exits 1 when any ready row's payload
is missing or short — the state #313 repairs. It reads the container, not the
app's memory, and a not-yet-flushed write shows its last committed state.

## `offline-delete-sampler.cjs` — heartbeat and unrelated reads during a sweep

```sh
node test/manual-test/downloads/offline-delete-sampler.cjs arm  METRO DEVICE UNRELATED_DOC_ID PROVIDER VOICE_ID 'ONE SAVED SENTENCE'
node test/manual-test/downloads/offline-delete-sampler.cjs mark METRO DEVICE LABEL
node test/manual-test/downloads/offline-delete-sampler.cjs read METRO DEVICE
```

Arms `globalThis.__or176` in the running app through CDP: a 25 ms `setInterval`
pushing `Date.now()` into `ticks` (the JS turn supply), and an async loop
re-reading one already-saved Clip of an unrelated Document through the
repository's `readClip` every 400 ms (pass a sentence you know is saved, or the
miss goes to the Provider). `mark` stamps labelled moments; `read` summarises
tick gaps (max/p99/over-100 ms), read counts and latencies. It injects no app
code and measures scheduling, not frame time; queue order inside the repository
remains the host tests' evidence.

## What the run measured (1.0.1 (14)-beta4-debug)

- **Working control.** Short fixture + Reverend Insanity part + stat-line
  fixture imported; Voice chosen with a real touch; Consent asked, recipient
  checked, allowed; 19 + 9 + 6 synthesis requests counted on the fake's log;
  Download/Manage deletions and re-download with real touches; catalog and disk
  agreed at every step (`offline-audit.cjs`).
- **#313 overlap, staged by relaunch (harness staging; the exact interleaving
  is the host tests').** With the app terminated, all 4,193 Reverend Insanity
  clips were marked `state='deleting'` directly in the catalog (the
  crash-after-mark shape). At launch the recovery sweep stepped **−64 rows per
  batch** (4193 → 4129 → 4065 → …, observed from a 0.5 s host poll of the
  catalog), and the first re-downloaded `ready` rows appeared at 09:01:21 while
  **2,784 rows were still deleting** — a real overlap running the final code.
  End state and a second relaunch: 4,193/4,193 payloads present, 40/40
  chapters complete, `occupied` 52,735,361 bytes, `--strict` clean. A smaller
  variant (one chapter's 9 rows staged deleting) behaved the same.
- **#176 bounded deletion through the UI.** `Delete all current voice audio`
  on the 4,193-clip Document (real touches, its confirmation alert): the sweep
  took ~57 s for 4,193 files+rows (~73/s), rows visibly stepping by ≤64. During
  the sweep the sampler counted **74/74 unrelated `readClip` reads resolved
  (2–3 ms each)** and ticks continued throughout (worst gap 879 ms, 23 gaps
  over 250 ms in a 44 s window — delayed by the file work and concurrent
  SQLite writes, but never starved for seconds the way the pre-fix host
  reproduction was). Another Voice's and another Document's audio stayed
  byte-identical; the UI showed 0 chapters downloaded after.
- **Legacy repair (first availability query).** With the app stopped, 9 ready
  rows' payload files were deleted from the fixture's voice directory and the
  fixture's `audio-verified` marker removed from `state`. At relaunch nothing
  was requested (fake's `text=` count unchanged); opening the Download drawer
  (first progress/inventory) dropped exactly the 9 rows, the Second Chapter
  lost its false `downloaded` mark in the UI, the marker was recorded only
  after success and survived a relaunch; the fake received **zero** requests;
  an explicit UI re-download refetched exactly 9 sentences (8424 → 8433) and
  restored `--strict`-clean agreement.
- **#175 rekey with a Document deleted mid-pass (harness staging; exact
  ordering is the host tests').** `stripBrackets` was flipped through the
  app's settings store and Reverend Insanity (254 prepared chapters) deleted
  2.6 s later, while the pass was over its 257-chapter workload. The pass
  finished, recorded the new keying (`[false]`), skipped the absent Document
  with no membership error in the Debug Log, and re-keyed the surviving
  Documents from current text — the stat fixture's keys changed for exactly
  its two bracketed sentences and nothing else. Toggling back with a **real
  touch** on Settings › General's switch restored the keys to byte-identical
  baselines, the 6 saved clips counted again, **zero** new synthesis requests,
  and the payload files never moved — "without a byte moving".
- **Delivery.** Settings shows `Version 1.0.1 (14)-beta4-debug`; the app is
  left open there with playback stopped and Metro 8313 alive.

## Limits

- The exact repository interleavings (a save overtaking a selected batch; a
  chapter read held across its Document's deletion) are the host tests'
  evidence; device staging reproduces the overlap and validates the post-state
  contract, not the instruction order.
- The audit-failure retry path (a failed audit stays unverified) is
  host-tested; on the device only the success path and persistence were
  reproducible without fault injection.
- Availability was proven by catalog/disk agreement and repository reads; no
  audible playback was started, so the speaker-level "plays" claim is not
  made here.
- A fresh-download Document shows no `audio-verified` marker until the next
  launch's first progress/inventory for it: the first query of the download
  itself lands on an empty ready set, takes the documented early return, and
  the per-process memo then serves later queries in that process. The next
  launch's first query audits and writes the marker (measured). Matches the
  ADR's "first availability query" design; noted here so a missing marker
  after a download is not read as a failure.
