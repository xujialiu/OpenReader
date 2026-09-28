# A Reading paused and played with the phone locked, and the drawer beside a Reading (#75)

Four more tools, all against a running app (none relaunches it), with
`OPENREADER_METRO=http://127.0.0.1:PORT`:

```sh
node test/manual-test/downloads/download-sampler.cjs install DOCUMENT_ID       # in-app, once a second, until a relaunch
node test/manual-test/downloads/download-prepare.cjs DOCUMENT_ID fish VOICE nav.LAST nav.A nav.B …   # text only, no clip
node test/manual-test/downloads/download-lock-pause.cjs UDID DOCUMENT_ID fish VOICE 45 60 30 nav.F nav.A nav.B …
EXPIRE_AT=20 node test/manual-test/downloads/download-lock-pause.cjs UDID DOCUMENT_ID fish VOICE 45 30 30 nav.F nav.A …
node test/manual-test/downloads/download-sampler.cjs read SINCE_MS [UNTIL_MS [OUT.json]]
bash test/manual-test/downloads/download-drawer.sh UDID NEW_DIR testOpenDrawer
SCROLL_TO=nav.N bash test/manual-test/downloads/download-drawer.sh UDID NEW_DIR testReadDrawer
SCROLL_TO=nav.N bash test/manual-test/downloads/download-drawer.sh UDID NEW_DIR testRingThenPauseAllAndResumeAll
bash test/manual-test/kit/lock-device.sh UDID play|pause                # the lock screen's own centre button
```

- `download-sampler.cjs` records, inside the app, the Reading's `playing`,
  `buffering` and Utterance and the download's state once a second, every
  `AppState` change and every `expired` event of the offline module. It is the
  only thing here that shows whether the background time ended, and when; a
  gap in its samples is the app's JavaScript not running.
- `download-prepare.cjs` is set-up for runs away from the screen, where a
  chapter boundary blocks the download in the branch that has only #75 (#76;
  Pitfalls, verification-runs.md): it prepares chapters' text in the
  foreground by pausing each chapter while it reads `preparing`.
- `download-lock-pause.cjs` reads aloud, locks, pauses through the harness
  after `PAUSE_AFTER` s (the harness is answered while locked, because the
  Reading keeps the app running), watches `PAUSED_FOR` s, presses the lock
  screen's own Play (`lock-device.sh play`, a real XCTest tap on SpringBoard's
  `UIA.MediaControls.NowPlaying.CenterButton`, one Home press to wake a dark
  screen first), watches `PLAY_FOR` s, unlocks and pauses. It prints the task's
  state both through CDP and as last persisted in a copy of `catalog.sqlite`,
  which is readable while the app is suspended. `EXPIRE_AT` emits `expired`
  from JavaScript: a handler probe, needed because the simulator never ended
  the background time in a process whose Reading had played (Pitfalls,
  simulators.md).
- `download-drawer.sh` runs one method of `DownloadBesideReadingProbe` (real
  touches, built once into `/tmp/openreader-download-drawer`): open More
  actions › Download; read the state line and the rings and take two
  screenshots 3 s apart; or tap the first hittable `Pause download` ring, then
  Pause all, Resume all and Pause all again, checking each turns. `SCROLL_TO`
  brings a chapter's row into view first (a CDP handler), since the ring of a
  chapter far down a long book is not rendered until the list is scrolled.

Measured 2026-09-28 on `iPhone 17 download` (iOS 27.0), Debug `0.0.2-beta42`
(774a34b, 3d0857b), Fish `s2.1-pro-free` at five at once, `My Vampire System
1-250.epub`, times UTC:

| Run | What happened |
| --- | --- |
| `download-away.cjs play`, 60 s, fresh nav.172–175 | 99 clips during 62 s of reading (51 + 48), 53 in the 41 s after Pause; `downloading` at every 5 s sample; the Reading playing at all 12 samples and all 61 sampler samples, Utterance 112 → 135, one buffering of about 1 s at the first clip, no Utterance held longer than 3.0 s |
| `playlock`, 120 s, fresh nav.241–243 | clips until the chapter boundary 27.6 s after `background`, then `preparing` and `blocked` 60.7 s later (#76); never `interrupted`, no `expired` in 139.8 s in the background, the Reading playing at every sample |
| `playlock`, 120 s, fresh nav.192, prepared nav.193–194, fresh nav.195 | 140 clips after the first 30 s, the last 112.8 s after `background`; `preparing` at the fresh chapter from 113 s; no `expired` in 140.8 s; never `interrupted` |
| `download-lock-pause.cjs` 45/60/30, fresh nav.196, prepared nav.197–199 | paused through the harness while locked; the download went on through all 75 s paused (117 clips); no `expired` |
| the same, 45/240/20, prepared nav.215–222 | 399 clips in 256 s paused while locked; no `expired` in 341 s in the background |
| the same with `EXPIRE_AT=20`, fresh nav.211, prepared nav.212–214 | after the emitted `expired` the download went on (44 clips in 26 s); Pause while locked: `interrupted` in the same 1 s sample, 5 clips already asked for saved within 3.0 s, then none until the lock screen's Play, 40 s later: `downloading` again in the same sample as `playing`, first clip about 2 s after; unlocked, it went on |
| Reader (drawer opened), Library (harness `shut`), locked 61 s | 71 clips in 52.6 s in the Reader, 52 in 35.1 s in the Library, 97 in 61.1 s locked, `downloading` and playing at every sample, no `expired` |
| `download-drawer.sh` while a Reading played, about 16 s | `Downloading…` in both reads 3 s apart, 4 rings reading `Pause download` on screen, the ring of the chapter being written from about 44 % to 50 % of its circle |
| `home` 90 s, no Reading in the process | `expired` 25.5 s after `background`, `interrupted` 0.6 s later, clips stopped; `downloading` 0.1 s after coming back, first clip 10.3 s later (Fish's idle connection, Pitfalls) |

What these cannot show: a phone's own background time, whether a phone ends
it while a Reading plays or after one is paused (#77), and anything about
Speechify's queue, which is unit-tested and was not spent on.
