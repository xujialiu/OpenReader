# Downloads and offline narration

Each recipe is its own file. Read the one for what you are testing, or the one
that names the script or probe you are about to run.

## Before any recipe here

Current offline data lives in `Documents/offline-narration-v2`, including
`catalog.sqlite` and any SQLite WAL/SHM files. The unreleased JSON store was
discarded with the owner's approval; do not restore pre-SQLite backups. Create
fresh fixture downloads before testing persisted playback or management.
Terminate the app before taking or restoring a complete offline-directory
backup so an open database connection cannot keep writing to replaced files.
After restoration, launch the app again before testing.

## Recipes

- [offline-narration.md](offline-narration.md): the short fixture's actions
  drawer and rename, Manage downloads' deletion, a name kept across a restart,
  a real download, a second voice's progress without spending quota, saved
  audio played with every request refused, and leaving the app with a task
  queued. `OfflineProbe.swift` (`inspect`, `management`, `alias`, `download`,
  `background`), `second-voice-progress.sh` with `SecondVoiceProbe.swift`,
  `offline-playback.cjs`.
- [fresh-library-and-deletions.md](fresh-library-and-deletions.md) (#13, #14,
  #15): Fish configured from empty settings, which is how the other recipes
  stage the Fish key; the first download into a new voice directory; Delete all
  saved audio and Delete this book actually confirmed; a store the app cannot
  open. `OfflineFixProbe.swift`.
- [download-ring-and-pausing.md](download-ring-and-pausing.md) (#37, #38, #56):
  the ring, pausing one chapter or all of them, Manage downloads listing only
  saved chapters, and the order chapters are written in, across a restart.
  `DownloadRingProbe.swift`, `PauseOrderProbe.swift`.
- [download-away.md](download-away.md) (#75, #76, #77): a download with the app
  in the background, the device locked or a Reading playing; a lock at a chosen
  moment of it; how each chapter preparation ends; the stutter when a download
  starts. `download-away.cjs`, `download-lock-at.cjs`, `download-ahead.cjs`,
  and the kit's `lock-device.sh`, `cdp-rtt.cjs`, `cdp-profile.cjs`,
  `frame-gaps.py`.
- [download-beside-reading.md](download-beside-reading.md) (#75): a Reading
  paused and played again from the lock screen while a download goes on, the
  end of the background time, and the Download drawer while a Reading plays.
  `download-sampler.cjs`, `download-prepare.cjs`, `download-lock-pause.cjs`,
  `download-drawer.sh` with `DownloadBesideReadingProbe.swift`, the kit's
  `lock-device.sh play|pause`.
- [two-finger.md](two-finger.md) (#57, ADR 0045): two-finger sweeps in Files
  and in the Download drawer, holding at the list's edges, and what one finger
  does there. `two-finger.sh`, `TwoFingerProbe.swift`.
- [download-concurrency.md](download-concurrency.md) (#64, #65): how fast a
  provider answers several requests at once, measured from the Mac; timing a
  chapter download on the simulator; OpenAI Compatible's fallback to MP3 and
  Speechify's queue on the short fixture. `download-concurrency.ts`,
  `DownloadConcurrencyProbe.swift`, the kit's `download-chapter.cjs`.
