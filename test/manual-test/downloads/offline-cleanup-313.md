# Offline cleanup, the legacy audit, and #175's rekey on the device (#313, #176, #175)

Current reusable steps for verifying the offline file-work fixes on a device,
with the bounded sampler this area now ships. The dated run records and their
numbers live in `notes/NOTES_2026-10-23.md`; this file only says how to measure
and what a measurement can and cannot prove.

## Preconditions

- A Debug app whose native side matches the tree (JS-only changes reload from
  Metro; check Settings' version line after a relaunch). One session-owned
  simulator, one Metro, one controlled fake (`fake-kokoro-two-voices.cjs`,
  `OPENREADER_FAKE_TTS_LOG` set) — no paid Provider.
- A large fixture: a real-book part with ~40 chapters downloaded through the
  app's own runtime (`kit/download-chapter.cjs`) gives ~4,000 Clips. Record the
  Document id and the fake's `text=` request count before each scenario. For
  request-count checks, remove the intended saved audio and relaunch to clear
  the in-memory cache; measure actual requests rather than assuming one per
  sentence (shared Clips, cached audio and retries can change the count).
- Consent: the first synthesis asks; check the recipient against the fake's
  address before answering (see `../voices-and-providers/consent-recovery.md`).

## `offline-audit.cjs` — catalog-vs-disk agreement

```sh
node test/manual-test/downloads/offline-audit.cjs UDID [--strict] [--json]
```

Snapshots `Documents/offline-narration-v2/catalog.sqlite` with the SQLite
online-backup API (`sqlite3 -readonly SRC ".backup DEST"` — consistent while
the app runs; a failed snapshot exits 2 rather than copying a racing WAL), then
reports per Document/Voice clip counts by state and every `ready` row's
payload presence/size, plus `audio-verified` markers. `--strict` exits 1 on
any missing/short payload and is only meaningful for a QUIESCENT store: during
an active sweep a snapshot can legitimately hold rows whose files are already
gone. Read intermediate sweep states from the non-strict counts. The snapshot
directory and handle are cleaned up on every exit.

## `offline-delete-sampler.cjs` — bounded heartbeat + unrelated reads

```sh
S="node test/manual-test/downloads/offline-delete-sampler.cjs"
$S arm  METRO DEVICE UNRELATED_DOC_ID PROVIDER VOICE_ID 'ONE SAVED SENTENCE' [SECONDS=90]
$S mark METRO DEVICE LABEL          # named phase markers (before-confirm, confirmed, ...)
$S stop METRO DEVICE [REASON]       # explicit stop; the probe also self-stops at SECONDS
$S read METRO DEVICE [SINCE] [UNTIL]  # per-window summary; bounds are marks, ms, or 'now'
$S raw  METRO DEVICE > RAW.json     # full tick/read/marks dump; save BEFORE any relaunch
```

Arming stops any previous probe. The current heartbeat records each fire's due
time relative to the preceding tick plus 25 ms; old v2 dumps used a different,
incorrect deadline reset, so compare their actual inter-tick gaps instead of
their `late` field. The unrelated read loop records
due/startedAt/resolvedAt. `read` counts only the requested window — always
summarise the confirmed→terminal window, never the armed aggregate. A
repository `readClip` miss returns `{clip:null}` and calls NO Provider (the
calling layer decides on refresh), so pass an already-saved sentence to keep
`ok` meaning "read". Relaunching the app clears the instrumentation; verify
with a `raw` call answering `null` if cleanliness matters.

## Measuring a deletion

1. Navigate to Manage downloads for the large fixture BEFORE arming.
2. Arm the sampler (bounded), `mark before-confirm`.
3. Touch `Delete all current voice audio`, touch the alert's Delete, then
   IMMEDIATELY `mark confirmed` and start the count poller in the same shell
   chain. Use `delete-count-poller.cjs`: a single process that polls on an
   interval, treats 0 deleting as terminal only AFTER positive deleting rows
   were seen (a poller started before its deletion, or against a quiescent
   store, must keep waiting, not exit), and stops at a deadline — never a
   fixed iteration count. Keep the last positive and first empty timestamps:
   together they bound completion. If the probe auto-stops before completion,
   the missing tail cannot be counted as responsive.
4. Optionally, mid-sweep, perform a real navigation touch and record the touch
   time and the first tree showing the destination — a response observation,
   not a latency measurement.
5. At the terminal poll, `mark terminal-observed`, `stop`, `raw > file`.
6. Compute per-window stats from the raw dump; report duration as the
   confirm→terminal bound, and heartbeat/read percentiles for the deletion
   window only, beside an idle baseline window measured the same way.

## Measuring the legacy audit

The first availability query audits a Document only when `audio-verified` is
absent and the process has not already memoised an empty-set answer. After a
fresh download, terminate the app, assert that the fixture still has its ready
rows and payloads, and remove only that Document's marker. Then relaunch for a
fresh process, arm, `mark before-audit`,
trigger `runtime.requestInventory(DOC)` through CDP (a handler probe), poll
a bounded probe's `inventoryReady(DOC)` until true and record `completedAt`,
then `mark audit-observed`, `stop`, `raw > file`. Use the actual request time
and readiness observation to bound the query; do not treat a later human
`audit-observed` marker as the completion time.
Check: fake request count unchanged across the window, `--strict` agreement
after, marker present after (only success records it). The same visitFiles
path serves both audit and deletion, but on the simulator an exists-check is
far cheaper than a delete — do not read the audit's duration as a device
storage claim.

## What a measurement cannot prove

- Ticks and reads are scheduling evidence, not frame rate and not audible
  playback.
- Compare every window to an idle baseline taken on the same boot, saving the
  baseline's raw data too. Record machine load and CPU idle around the window,
  but neither an elevated load average nor a passing repeat proves the cause
  of an outlier. Keep unexplained spikes as a limitation; use targeted probes
  to attribute them. Never extrapolate a duration from two polls — bound it.
- The exact repository interleavings stay with the host tests
  (`repository-races.test.ts`, `deletion-responsiveness.test.ts`); device
  staging proves overlap and post-state contracts.
