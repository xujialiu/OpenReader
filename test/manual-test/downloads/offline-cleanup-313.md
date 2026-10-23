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
  Document id and the fake's `text=` request count before anything else; every
  full re-download of those chapters is exactly one request per Clip, so the
  count arithmetic identifies every later requester.
- Consent: the first synthesis asks; check the recipient against the fake's
  address before answering (see `../voices-and-providers/consent-recovery.md`).

## `offline-audit.cjs` — catalog-vs-disk agreement

```sh
node test/manual-test/downloads/offline-audit.cjs UDID [--strict] [--json]
```

Snapshots `Documents/offline-narration-v2/catalog.sqlite` with the SQLite
online-backup API (`sqlite3 SRC ".backup DEST"` — consistent while the app
runs; a fallback to raw main/WAL copies is printed as NOT consistent), then
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

Arming stops any previous probe. The heartbeat records each fire's due time,
so summaries report callback-start lateness; the unrelated read loop records
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
   fixed iteration count. Both earlier mistakes (fixed iteration count;
   pre-confirm start) happened on 2026-10-23 and cost one run's early
   progression.
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
fresh download, terminate and relaunch (fresh process), remove the Document's
marker while the app is stopped if one exists, then arm, `mark before-audit`,
trigger `runtime.requestInventory(DOC)` through CDP (a handler probe), poll
the probe's own completedAt, `mark audit-observed`, `stop`, `raw > file`.
Check: fake request count unchanged across the window, `--strict` agreement
after, marker present after (only success records it). The same visitFiles
path serves both audit and deletion, but on the simulator an exists-check is
far cheaper than a delete — do not read the audit's duration as a device
storage claim.

## What a measurement cannot prove

- Ticks and reads are scheduling evidence, not frame rate and not audible
  playback.
- Compare every window to an idle baseline taken on the same boot, and record
  machine load around the window: on 2026-10-23 a parallel session's load spike
  (5-minute load average 76) produced one-off 249–335 ms heartbeat gaps in an
  otherwise clean audit window, all gone in a calm-load repeat (max 44 ms).
  Attribute outliers to the machine before attributing them to the app, and
  never extrapolate a duration from two polls — bound it.
- The exact repository interleavings stay with the host tests
  (`repository-races.test.ts`, `deletion-responsiveness.test.ts`); device
  staging proves overlap and post-state contracts.
