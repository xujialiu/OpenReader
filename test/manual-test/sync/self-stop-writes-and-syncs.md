# A Reading that stops by itself writes its place and syncs (#155, #216, #154, #160)

Verified on the simulator, 2026-10-13, against `1.0.0 (8)-beta6` at d7759d3 on
`xujialiu/fix--ios-test`. Simulator: a dedicated iPhone 17 Pro on iOS 27.0
(UDID in the run's report), Debug build from the worktree, JavaScript from its
own Metro. Everything here is this run's measurement, not a general recipe.

## Setup

- **Speech**: the kit's fake OpenAI-compatible server
  (`../player-and-reading-held/fake-kokoro.cjs` — this run used a
  /tmp forerunner of its `OPENREADER_FAKE_TTS_REFUSE` knob) on 127.0.0.1,
  configured with the harness settings patch (`provider: compatible`,
  `enabledProviders`, `compatible.baseURL`, `voice: alloy`). The first Play
  opens the Voice sheet on a fresh Document — pick the row, then close the
  sheet with an `axe drag` down its title, or nothing else on the page answers.
  The first synthesis raises the consent alert (#109): answer it with
  `kit/ax.py alert-touch Allow`, or the engine waits with nothing on screen.
- **Sync**: the test folder in `~/.secrets/openreader/`. `sync.url` and
  `sync.username` go in with the harness settings patch; only the password is
  typed, by `SyncSetupProbe` (`testTypePasswordAndSwitchOn`), which turns the
  switch on and leaves it on. For the late-sync scenarios the app was pointed
  at `../delaying-webdav.cjs 8722 4000` instead (same settings patch; the
  Keychain password is kept, the local server accepts anything).
- **Evidence**: `HX` lines in Metro's log, the app's Debug Log
  (`[reading]`, `[sync]`, `[provider]`, `[app]`), the server side read from
  the host with `webdav-poller.py` (folder reachable, `Last-Modified`, every
  item's exact/device/stamp), the harness `shelf` (the Library's place), and
  screenshots. The `shelf` line's `stamp=` is the entry's stamp; the position's
  own stamp is read from `library.json` on disk when it matters.

## What was measured

- **End of the Document** (`A Short Test of Reading Aloud`, 17 speakable
  Utterances, one 0.3–3 s fake clip per sentence): played to the last sentence
  with no Pause. The stop wrote the last sentence to the Library and uploaded
  it: Debug Log `engine event=pause.request … utterance=18` → note "That was
  the last of this document…" → `[sync] run` → `[sync] pause: ok … uploaded`
  0.46 s later; the folder's `Last-Modified` moved at the same second and the
  file held the last sentence under this device's stamp.
- **The same stop with the phone locked**: the reading ran on after the lock
  (the app backgrounded at `01:49:05 [app] app background`), stopped at the end
  of the Document in the background, and its sync reached the server from
  there — the folder's PUT completed 8 s after the stop, while the app was
  still away from the screen. The simulator does not suspend the app the way a
  locked phone is, so the true suspension remains a device question.
- **A refused Clip** (`Pause Gap Fixture`, the fake refusing from the third
  request): the title heading (utterance 0, "Pause Gap Fixture") and Alpha
  (utterance 1) played, and Beta (utterance 2), the third request, was refused.
  The engine stopped itself on Beta (`pause.engine ... utterance=2` at
  01:43:38.984), the Player showed the Provider's message, and the stop wrote
  the Library and uploaded: the place written was **Beta**, the refused
  sentence, stamped 01:43:39.010, the sentence the regression test pins. The
  run's first report counted Alpha and Beta as played and Gamma as refused,
  leaving out the heading; the app's Debug Log corrects it.
- **#216, the lookup with the Player collapsed**: played, collapsed the Player
  (the Reading Button), long-pressed a word (AXe `touch --delay 2.0`, points).
  The drawer opened, the Reading paused through the screen's pause
  (`[reading] pause at utterance 13` mid-clip), the Library took the sentence
  (`A reader moving from one chapter to the next hears a new voice cue.`) and
  the upload left at once (`Last-Modified` = the pause second). Closing the
  drawer left the Reading paused, the Player expanded and the navigation bar
  shown. A lookup made while already paused, Player collapsed, behaves the same
  (the pause re-opens the Player even then).
- **The Player's own Pause** (real touch) wrote and uploaded as before, and
  Play resumed from the paused sentence (8 → 9 → 10 → 11 observed). A Pause
  from the lock screen's Now Playing (`LockScreenProbe --mode tap`, twice)
  played and paused through the app's own handlers; a lock-screen Pause re-opened
  a collapsed Player.
- **#160**: Play pressed with the sync held 4 s (the delaying server), Pause
  sent from the pause handler while the wait ran. When the sync answered,
  nothing started: no `play.request` after the answer, transport still Play.
- **#154**: the phone played its own sentence with the sync held; the host PUT
  a newer place (a later sentence, a later stamp, device `fix8-desktop`) into
  the delaying server before the held GET answered. The late answer adopted it
  while playing (`[sync] play: ok, 1 places taken`), the pause inside that
  sentence took it: the Library's entry on disk held the desktop's exact,
  locator and stamp unchanged, the folder kept the desktop's item, and the
  stop's sync uploaded nothing over it. Play then resumed at the desktop's
  sentence (utterance 17).

## What the run cannot prove

- The output-lost stop (#152's route change) — no headphone jack on a
  simulator; covered by the regression tests only.
- A stop's sync surviving iOS suspending the process (the simulator
  backgrounds without suspending).
- Word Lookup against a service that is down, and the Pronunciation
  interruption's non-re-open (design 0051) — not exercised this run.

## Pitfalls met on the way

Are in `../../README.md`'s **Pitfalls** under this run's dated entry: the
Sync screen's URL field losing characters to chunked `typeText`, the Voice
sheet standing over the Play button while the AX tree still lists it, the
consent alert holding the first Play invisibly, the simulator volume's
repeated resets, and AXe's `touch` argument style.
