# Merges, seeding and past verification runs

## Verifying #136: Select from an entry's own actions (2026-10-07)

- `mobilebuildmcp build_sim` hit the known 60 s MCP transport timeout again
  (see **#125 Release verification tooling** in `../README.md`) while its `xcodebuild` ran
  on; the process exited on its own after about 245 s with the Debug products
  written. Same handling as #125: never start a competing build, poll for that
  exact `xcodebuild` to exit, then check `Build/Products`.
- A simulator that lists no app can still come back with old data. `simctl
  listapps` on a previously used test device showed no OpenReader, yet `simctl
  install` re-adopted the device's week-old data container: the Library came
  back already seeded, and a leftover `harness.json` replayed its last `settings`
  patch at first launch (`HX settings patched {"theme":"light"}` in the Metro
  log). The replay was benign here, but a leftover `add` would have imported a
  book mid-run. Before trusting a "fresh" device, read
  `simctl get_app_container UDID top.xujialiu.openreader data/Documents` and
  `harness.json` first, or erase the device.

## Verifying #134: Contents' Downloaded check (2026-10-05)

- **A chapter deleted in Manage and downloaded again in the same process came
  back at once, without a request.** Delete hid the chapter and Contents lost
  its check, but `Download selected` on it then finished instantly: the fake
  speech server's log gained no `text=` line, and the database and Contents
  showed the chapter Downloaded again. The runtime's in-memory clip cache
  still held its sentences, and a download fetches through it, so nothing
  was sent. That is the app saving a request, not a fault in the check, but
  it makes such a run worthless as evidence of a live download. Fix: after a
  deletion, terminate and relaunch the app before downloading again, and
  confirm in the provider's log that the sentences were asked for.
- **After a cold relaunch, an exact-label touch on `The Second Chapter, being
  read` found no element.** While the plan loads, the Download drawer can mark
  another chapter as the one being read, so the `, being read` suffix moves.
  Fix: read the tree again after a relaunch and touch the label as it is now.

## Verifying #115: Play in the middle of the transport row (2026-10-01)

- **On a fresh install the collapse arrow seems dead, and so does every way
  of pressing it.** A fresh Library has no Provider enabled, so the player
  carries `No provider is enabled. Enable one in Settings to listen.`, and a
  note keeps the player open (ADR 0048; `collapsed && notes.length === 0`).
  The tester tried `ax.py touch`, `mobilebuildmcp_tap`, a raw `axe tap` and
  the harness's `collapse`, and put the misses down to eaten taps; all of
  them had landed. Fix: clear the note first, by enabling a Provider (below),
  then collapse. The same rule caught `line-follow.cjs` (#71, further down).
- **`{"do":"settings","patch":{"local":{"baseURL":…}}}` drops the local
  engine, and Play then does nothing that reaches the fake server.** The
  harness's patch is the shallow merge described under #71 batches 3 and 4
  below: naming only `local.baseURL` replaces the whole `local` object, so
  `engine` became `undefined`, the Voice sheet said `Unknown local engine:
  undefined`, the `voice` command left the Voice empty, and three real Play
  touches opened the sheet instead of asking `fake-kokoro.cjs` for a clip
  (its log held only `GET /v1/models`). Fix: send the whole object,
  `{"local":{"engine":"kokoro","baseURL":"http://127.0.0.1:8791"}}`, then
  `{"do":"voice","provider":"local","voice":"af_bella"}` and
  `{"enabledProviders":["local"]}`; `say` then logs `voice=af_bella` and
  `ready=true`, and the first Play asks the consent question (#109).
- **Restarting `fake-kokoro.cjs` with the PID its launch printed left the old
  server running.** `FAKE_PID=$!` from a `nohup … &` in a `bash -c` named the
  wrapper (88831), not the `node` holding port 8791 (88834); the kill missed,
  the new server could not bind, and the 1.5 s `OPENREADER_FAKE_TTS_DELAY_MS`
  it was started for never applied. Fix: stop whatever listens there,
  `kill $(lsof -t -iTCP:8791 -sTCP:LISTEN)`, and read the same `lsof` back
  before starting the next one.

## Verifying #113: the renderer log and the probe channel (2026-10-01)

- **`{"do":"ask","provider":…}` puts no note on the player, even when the ask
  fails.** Verifying that a `js` probe leaves the player's note unchanged
  needs a note first; `breakfetch` + `ask` logged `[provider] … failed` and
  `[hx] fetch refused` but the status line stayed `note=null` — the voices
  ask reports on the Voices sheet, not through the reading's `status.note`.
  The reliable recipe is the play refusal: patch
  `{"do":"settings","patch":{"enabledProviders":[]}}`, send `play` (readiness
  refuses before any audio and sets the note, e.g. "No provider is enabled.
  Enable one in Settings to listen."), `pause`, then patch
  `enabledProviders` back. The note stays while paused and the probe does not
  touch it.
- **`download-chapter.cjs` can finish without printing a `preparing`/
  `prepared` line, because an earlier run already prepared the chapter.**
  After an aborted run, a rerun of the same chapter id shows only
  `[download] continued task submitted … 1 of 1 chapter` and goes straight to
  `state=done` — the preparation lines (`[download] preparing …` /
  `prepared … in NNN ms`) belong to the earlier run. To watch the preparation
  itself, download a chapter id that has not been prepared in this
  install's Debug Log yet.
- **The LogBox banner is not dismissible through `mobilebuildmcp`'s snapshot**
  — see pitfalls/screenshots.md.

## Merging main's #67 and #68 into #71 (2026-09-26)

- **Metro kept "Unable to resolve react-native-teleport" after the merge, even
  once `npm install` had added it.** The merge brought #68's new dependency; the
  running Metro (started before) rebuilt on the file changes, failed to resolve
  it, and did not pick up the package when it appeared in `node_modules`. Fix:
  after a merge that changes `package.json`, run `npm install`, then stop and
  restart this tree's Metro on the same port (`npx expo start --port PORT <
  /dev/null`) and relaunch the app. The native side needed nothing here: the
  installed Debug app already held teleport's `PortalHostView` and
  `PortalRegistry` (checked with `strings` on the app binary); check that before
  rebuilding.
- **`line-follow.cjs`'s collapse did not collapse, so no `bar` message reached
  its recorder.** Its own `ask` answers stay on the player as a note while
  paused, a note keeps the player open, and since #67 it keeps the bar too, so
  the collapse and expand before Play changed nothing and sent nothing. The
  target then missed #67's 54 px of room, and every line read `rest 27.8`
  against a line that was 0.8 px from the program's own target. Fix, in the
  probe: the target is `bar room + (h - bar room - open player) * share`, and the
  bar room is read from the `openreader-bar` rule in the top document when no
  `bar` message was heard. `DURING=collapse` still collapses, because Play clears
  the note first.

## Verifying #71 batch 2

- **A stray `var` inside a comma-separated declaration list is a `SyntaxError`,
  silently — until the code path that holds it runs.** `line-follow.cjs`'s
  `--tap` code read `var h = m.container.clientHeight, var share = R.share
  === null ? 0.5 : R.share, under = …`, added when `--tap`'s target grew the
  same `share`/`open` arithmetic the batch 2 `analyse` code already had. Every
  other run (plain, `--skips`, `--whole`, the new `arm`/`analyse`) never
  evaluates the `tap` string, so this shipped and passed review unnoticed;
  only `--tap` itself would have hit `new Function(...)` throwing `Unexpected
  token 'var'`. Confirmed with `node -e` against the extracted line before
  fixing it. Fix: one `var`, comma-separated declarations, `hit` included in
  the same list rather than a bare `hit = null;` after a stray semicolon.
- **`/tmp/openreader-*` is shared by every worktree on the machine, not just
  this one, and an existing `ManualTests.xcodeproj` there is reused as-is.**
  `player-touch.sh` (like `kit/run-probe.sh`) only regenerates the project
  when `ManualTests.xcodeproj` does not already exist at the given path, so it
  can reuse one across runs for faster incremental builds. `/tmp/openreader-player-touch-02`
  already held a project from a same-named directory an unrelated `ui`
  worktree's session had used earlier that day; the build failed with `Build
  input file cannot be found:
  '/Users/xujialiu/orca/workspaces/openreader/ui/test/manual-test/ios/PlayerTouchProbe.swift'`
  — a different worktree's absolute path, baked into that project by
  `Xcodeproj::Project.new(...).new_target(...).add_file_references([project.main_group.new_file(File.expand_path(source, __dir__))])`
  at the time it was generated. Give every generated project a path that
  includes the worktree's own name (`/tmp/openreader-player-touch-feat-scroll-01`,
  not `-02`) rather than trusting a short numeric suffix to be free.
  `kit/run-probe.sh` records the probe and the tree in `probe.txt` and refuses
  a directory generated for another of either; the scripts with their own
  build step do not.
- **A `section` command sent while playing can take much longer than a few
  seconds to turn into an actual seek, if the target section has not rendered
  yet.** `goToSection` (`use-reading.ts`) calls `bridge.goToSection` at once
  (the page starts moving) but only seeks once that section has reported its
  Blocks; until then the seek sits in `pendingSectionRef`. Jumping from
  section 9 to section 20 (11 sections, several screens each) this way: a
  `say` 3 s after `play` then `section:20` still read back `section=9`
  (unresolved); the same check about 15 s later read `section=20
  utterance=296`. Getting a fresh reading position for a new run needs a wait
  proportional to how far the jump is and how long the intervening sections
  are, not a fixed few seconds — poll `say` until `section` changes rather
  than assuming a short sleep was enough.

## Seeding a real book's place through the harness (#68)

Building `reading-held-book.sh`, which uses the harness's `open`/`say`/`seek`
to position "Shadow Slave — Chapters 1–250" without hundreds of real taps
(README, "Real books"):

- **`date +%s%3N` on macOS prints the seconds followed by a literal `N`**, not
  milliseconds — `%N` is a GNU `date` extension this BSD `date` does not have.
  A harness command built from it, `{"seq":1790354339N,"do":"say"}`, fails
  `JSON.parse` with `Unexpected character: N` and every later `harness.json`
  write with that same broken `seq` template repeats the same throw
  (`HX harness threw: SyntaxError…`) until a plain incrementing counter
  replaces it.
- **Two `harness.json` writes inside the app's own 250ms poll window drop the
  first one.** The poller only reads the file when it ticks, and a `seek`
  immediately followed by a `say` (no delay) can overwrite the file before the
  app ever reads the `seek` — the `say`'s answer then reports the *pre-seek*
  state, silently. Sleep at least 0.5s between a state-changing command and
  the next `send`.
- **A fresh mount of a long book briefly answers `known=0`.** Right after
  `{"do":"open"}`, the harness `say` can report `known=0, section=null` for a
  few seconds while the first sections are still laying out — a real value,
  not a dropped command — so poll for `known > 0` rather than trusting one
  snapshot a few seconds after `open`.
- **A real book's Utterance index (`known`, from `say`) is session-relative,
  not book-absolute.** A fresh mount's initial render window sits around
  wherever the saved place resolves to, not always from the book's true
  start, so the same absolute number (`utterance: 619`, say) lands in a
  different chapter after a different resume anchor — confirmed by seeding
  the same number twice, once landing near "Chapter 3" and once, after the
  saved place had moved, near "Chapter 19". Always compute the seek target
  from *this* session's own fresh `known`, never a number left over from an
  earlier run.
- **`field() { echo "$1" | grep -oE … }` with no `|| true`, under `set -e -o
  pipefail`, silently kills the whole script with no message** the moment the
  pattern is absent (a blank status line from a `say_status` timeout, in
  particular) — `pipefail` makes the unmatched `grep`'s exit status the
  pipeline's own, and with nothing to catch it, `set -e` exits immediately.
  The failure looks like the script simply stopped after its first line of
  output. Every pipeline ending in a `grep` that can legitimately find
  nothing needs its own `|| true` (or an equivalent fallback), not just the
  call site's.
- **Leaving a real book's reader while paused, right after a harness `seek`,
  did not reliably persist the seeked place** to the Library's saved
  position — `shut` (the same `goBack` the back arrow calls) sometimes left
  the entry's stamped anchor exactly as it was before the `seek`, even
  several seconds later. Root cause not isolated. Workaround: do not leave
  and reopen to seed a position; seek the already-open, live reader and hand
  it straight to the real-touch suite paused there — the probe's first touch
  is Play, never a tap that assumes the seeded place was saved.
- **`silence.sh check … && echo ok` on its own line, followed by unrelated
  commands on later lines, does not gate those later commands** — only `echo
  ok` is conditional on the check. A `bash silence.sh check … && echo ok`
  whose check actually failed (volume had drifted to 60, most likely an
  output-device change per the rule above) still let a `send '"do":"play"'`
  a few lines later run and play audibly for a few seconds (2026-09-26,
  verifying #68's provider-change check). The `&&` has to chain every command
  that plays anything, in the same statement, not just the first one after
  the check.
- **`sim_volume` going back to 60 with no boot correlates with the app being
  terminated and relaunched.** Seen again 2026-09-26, twice in one session,
  independently verifying #67: `check` failed right after a plain `simctl
  terminate`/`launch` cycle between test runs, with no other simulator or app
  activity in between either time. Consistent with, and narrowing, the
  2026-09-22 note above ("only the app had been terminated and relaunched in
  between, several times") — still not root-caused, but `check` (chained to
  the play, on one line) right after
  any relaunch, not only after a boot, is confirmed necessary again.

## Independent verification of the collapsed player and its edge swipe (#67)

Beyond the implementer's own `reading-button.sh` run: `ReadingButtonProbe`'s
`testEdgeSwipeReliabilityMeasurement`, `testReadingButtonDuringBufferingAndWaveform`,
`testCollapseRestoreAcrossUtteranceChange` and `testContentsRowLandsBelowBar`,
plus harness sequences for the failure-note and dark-theme checks.

- **`ReadingButtonProbe.openPaused`'s own "Expected the bar shown" can fail
  for a reason that has nothing to do with the test method it is reported
  against.** A `-only-testing:testContentsRowLandsBelowBar` run that itself
  left the fixture's Contents sheet open (its first version tapped an
  `unreachable` row, below) meant the *next* `-only-testing` invocation's
  first `openPaused` inherited that open sheet; its own back-button recovery
  loop could not close it, and it failed at its own `barShown` assertion.
  XCTest reports the failure against the calling test's name but the source
  line is the helper's own (`openPaused`, not the caller) — read the line
  number, not just the test name, before concluding the *caller's* logic is
  what broke. Fix here matches "The harness's `open` pushes the Reader over
  whatever the stack holds" above: relaunch the app (a clean `.activate()`
  onto a stuck sheet does not clear it) before the next run, every time a run
  might have left the screen somewhere unexpected.
- **The fixture's own Contents rows are all `unreachable`.** `A Short Test of
  Reading Aloud`'s `nav.xhtml` (`short-test-fixture.ts`) does not match
  `contentsOf`'s own comparison against the spine hrefs the document message
  reports — `contents-sheet.tsx` shows its dedicated note, "None of these
  rows names a file in this book… so the list can be read but not followed",
  and a tap on a row does nothing (measured: the sheet stayed open on the row
  tapped, 2026-09-26). Pre-existing, unrelated to #67. Use a real book (Shadow
  Slave — Chapters 1–250, or another `~/Works/epub_books` part) for anything
  that taps a Contents row to navigate; the fixture is fine for everything
  that only opens the sheet and reads it.
- **A long, tight loop of taps needs the LogBox-banner guard on every tap, not
  only ones "near the bottom of the screen."** `testEdgeSwipeReliabilityMeasurement`
  (40 trials, several minutes, repeatedly pressing Play/Collapse/the Reading
  Button/"Return to the reading") lost the rest of a run to `Failed to tap
  "Return to the reading" Button: No matches found`, immediately after an
  `.exists` check on that same element had just returned true — a stale
  reference from a navigation transition still in flight, not the banner
  this time, but the fix is the same shape: clear the banner and tolerate one
  stale element with a short settle-and-retry before tapping
  (`ReadingButtonProbe.safeTap`), rather than a bare `.tap()`, anywhere a
  probe taps the same handful of controls dozens of times in a row.
- **Comparing ink against a baseline taken before the page has settled reports
  "the text moved" for a move the test caused, not the app.** Measured
  2026-09-26: skipping forward from wherever the fixture was left (not the
  first sentence, deliberately, to give the voice's own centring something to
  scroll) and capturing ink 0.6 s after Play, then again right after
  Collapse, read `rows-differing=394 of 580` and the first line 14 points
  higher — Play's own centring (ADR 0011) was still settling into the new
  Utterance when the "before" sample was taken, and the difference measured
  was that settling, not the collapse. Replacing the fixed 0.6 s wait with
  `settledInk` (already in `ReadingButtonProbe`, built for exactly this) before
  the instant-of-collapse comparison read `rows-differing=0 of 580` both ways.
  Any before/after ink comparison taken less than a few seconds after a Play,
  a skip, or a seek needs `settledInk`, not a fixed sleep, for the "before".
- **A duplicate note in the player, and a React "two children with the same
  key" warning to go with it, is reachable by disabling the only enabled
  Provider while the reading is actively trying to speak.** Not an XCTest or
  simulator pitfall — an application observation, kept here because it was
  found via the harness technique "Disabling the active Provider while a
  Reading is held (#68)" above, extended to an actively-playing reading
  rather than one parked in the Library: `status.note` and the separate
  `sayWhatIsMissing`/`readinessSentence` check both independently produced
  the sentence "Fish Audio is disabled. Choose an enabled provider.", and
  `player.tsx` keys its notes list on the note's own text
  (`key={note.said}`), so the identical string twice is both a visible
  doubled line and a React key collision. Reported to the implementing agent
  separately from this verification's PASS/FAIL; #67's own chrome/bar
  behaviour (bringing both back for the note) was correct throughout.

## Verifying #71 batches 3 and 4 (2026-09-26)

- **`line-follow.cjs`'s own `arm` calibration silently dropped `Scrolling`
  back to `undefined`, and General then showed the row with no value at
  all.** Symptom: `Scrolling` (General) rendered as a bare label with nothing
  after it — no "By line", no "Continuous" — while `Line position` on the
  row below it still read "50%" correctly. `FollowingProbe`'s own
  `testScrollingMenuRealTouches` then failed two different ways in a row:
  first `XCTAssertEqual` comparing `[]` (no menu item read as selected)
  against `[""]` (the row's own label, sliced past "Scrolling, ", was
  empty), then (after the row's label came back once the settings were
  fixed) a second, unrelated timing failure. Cause: `arm`'s calibration sent
  `{"do":"settings","patch":{"following":{"linePosition":POSITION}}}` — and
  the harness's `settings` command is `setSettings(was => ({...was,
  ...patch}))`, a **shallow** merge (`shell.tsx`). A patch naming only
  `following.linePosition` replaces the **whole** `following` object, so
  `scrolling` silently becomes `undefined`; `ChoiceMenu`'s own accessibility
  label is built as `` `${label}, ${current}` `` with `current = choices.find(c
  => c.value === chosen)?.label ?? ''`, so an unmatched `chosen` renders (and
  reads back) as `"Scrolling, "` — a real, if empty, value, which is why the
  row still matched `label BEGINSWITH 'Scrolling,'` and the failure looked
  like a menu problem rather than a clobbered setting. This is the same
  shallow-merge hazard the app's own bridge code was written to avoid
  (`setLinePosition`/`setScrolling` "each send the pair, so the program never
  holds half of an old choice" — ADR 0050 batch 4) — the *test harness's*
  settings patch needed the identical fix. `line-follow.cjs` now takes a
  `SCROLLING` env var (default `'line'`) and always sends `{scrolling,
  linePosition}` together; any script or ad hoc `hx.cjs` call that patches
  `following` for any reason must send both fields, never one alone. A
  patched setting has no code-level guard against this — reading
  `saysettings` after any such patch and checking `following` has both keys
  is the only way to catch a repeat.
- **A `press(forDuration:thenDragTo:)` with no `withVelocity`/
  `thenHoldForDuration` intermittently read as a tap-to-seek instead of a
  drag, on this Mac, under this session's load (many `xcodebuild` processes
  across two-plus hours).** Symptom: a drag meant to move the page ~70 px
  instead jumped it ~600 px to a specific sentence, with the Following mark
  staying `A` (not turning to `M`) — exactly what a real tap on that sentence
  does (design 0050: a tap "moves the reading and brings the page with it"),
  not what a drag does. The **same** gesture code, run minutes earlier in the
  same session, had correctly produced a small drag and `M`. `GlideTouchProbe`'s
  own already-proven shape — `press(forDuration: 0.05, thenDragTo:,
  withVelocity: XCUIGestureVelocity(250), thenHoldForDuration: 0.1)` — did
  not reproduce this once it was adopted everywhere in `FollowingProbe.swift`
  in its place. Prefer that exact shape (or `FlingProbe`'s own, for a fast
  fling) over a bare `press(forDuration:thenDragTo:)`; treat a page that
  moved much further than the drag's own on-screen travel, with the
  Following mark not changing, as a sign the gesture read as a tap.
- **One enormous, very fast `press(forDuration:thenDragTo:)` (0.85 → 0.15,
  3500 pt/s) also read as a tap, not a fling.** `FlingProbe.testFlicks`'s own
  proven shape is different in every dimension: a *shorter* travel (0.70 →
  0.30), a *shorter* press (0.01 s, not 0.03), and it is repeated three to
  ten times with a small gap rather than issued once. Reusing that exact
  shape (`fastFling`, `FollowingProbe.swift`) reliably moved the page hundreds
  of points past the visible screen; the single-mega-drag version measured
  above did not reliably do so. Prefer several `FlingProbe`-shaped flicks
  over one large, fast `press(forDuration:thenDragTo:)` whenever a real
  fling — not a controlled drag — is what a step needs.
- **A playing drag after collapse/reopen can enter M and recover to A before the XCTest taps Return.** Measured 2026-09-27 with a raw WebView capture: the final drag delivered 42 `touchmove` events and moved `scrollTop` 2192→2357 while `overflowY=scroll`; the test printed `FOLLOWING drag reached M`, then the raw stream recorded a new `speak … recover` 870 ms after `touchend`, and the following Return tap found no M button. A paused three-drag repeat passed with `A=false M=true`. This is the design's visible-sentence recovery timing, not a swallowed drag; a playing probe must inspect the raw A/M/recover timeline before asserting that M remains. Raw capture: `/private/tmp/openreader-collapse-raw-capture3/collapse-playing-raw.json`.
- **A named Metro log can be stale even while the server is healthy.** During the 2026-09-27 trace, `/private/tmp/openreader-main-beta39-metro.log` had stopped on the prior day while port 8086 served the current bundle; `lsof -a -p PID -d 1,2` showed the live stdout/stderr at the session scratchpad's `metro-8086.log`. Read the descriptor target from the current Metro PID before concluding that a trace or `HX` command was not received.
- **A Metro log that stops changing can mean the reader unmounted, not that
  Metro stopped relaying console output.** `say`/`play`/`pause`/`collapse`/
  `seek`/`section`/`skip`/`js` are only registered by `useHarnessCommands`
  inside `reading-view.tsx`, which exists only while a reader is on screen;
  `shelf`/`settings`/`saysettings`/`open`/`navstate`/`back` live in
  `shell.tsx` and always answer. Symptom: after a run that ended by leaving
  the reader (here, apparently a spontaneous JS reload — Metro logged `iOS
  Bundled Nms index.ts (1 module)` with no source edited — dropped the app
  back to the Library), repeated `{"do":"say"}`/`{"do":"pause"}` sends
  produced no new `HX` lines at all, and the tail looked exactly like the
  already-documented "Metro stopped receiving the app's console lines"
  pitfall. It was not that: `{"do":"shelf"}` (a `shell.tsx` handler) answered
  immediately, proving Metro was relaying fine. A screenshot showed the
  Library, not the reader. Before suspecting Metro itself, send a
  shell-level command (`shelf` costs nothing) or take a screenshot; only
  treat it as the earlier, real Metro-relay pitfall once a shell-level
  command also gets no answer.
- **A spontaneous JS reload (`iOS Bundled Nms index.ts (1 module)` in
  Metro's log, no source file touched) can happen mid-session with no
  action that obviously caused it**, dropping the app back to the Library
  (ending any held reading the way a real relaunch would) and resetting the
  simulator's volume to 60 (the existing "sim_volume can go back to 60…"
  pitfall's list of triggers — "only the app had been terminated and
  relaunched" — should be read to include this). Measured 2026-09-26 across
  a long `FollowingProbe` session: at least three such reloads, roughly one
  per 15-20 minutes of mixed `xcodebuild`/harness activity, cause not
  isolated. `silence.sh check` before every play catches the volume half;
  a shell-level harness command or a screenshot catches the navigation half
  — check both after any gap of more than a couple of minutes between steps,
  not only after an explicit `terminate`/`launch`.
- **`PlayerTouchProbe.testCollapseAndReopenDuringPlaybackRealTouch`'s own doc
  comment ("a real Pause is what reopens the player… so reopening here also
  pauses") is stale against this merge.** It predates `reading-button.tsx`
  becoming its own component, shared with the Library's held-reading button
  (#67/#68), whose doc comment is explicit and current: "never plays or
  pauses… stopping from collapsed now takes two presses instead of one."
  Measured here: tapping the collapsed pill while playing shows the expanded
  player still playing (`Pause` exists, not `Play`); a *second*, separate
  tap on the now-visible `Pause` is what actually stops it. A test (or a
  reading of this file) that assumes reopening pauses will misread "still
  playing" as a failure. Not re-run to confirm whether the older probe
  itself still passes today — its own query, `app.buttons["Pause"]" while
  collapsed`, looks for a label the collapsed control no longer carries
  (`"Show the player"`, fixed, `player.tsx`), so it likely no longer finds
  what it expects either; flagged here rather than fixed, since batches 3/4
  verification is this session's scope, not batch 2's probe.
- **The Library's held-reading button and the in-Reader `M` mark share the
  exact accessibility label `"Return to the reading"`.** `library-screen.tsx`
  gives its `ReadingButton` that label; `player.tsx`'s `FollowingMark` gives
  its own `M` `Pressable` the same string, independently. Harmless in
  practice — the two screens are never shown together, and every method here
  that queries `app.buttons["Return to the reading"]` first knows which
  screen it is on — but a query written without that context could match the
  wrong one if a future bug ever showed both at once. Confirm which screen
  is frontmost (`inReader`/`inLibrary`) before relying on this label.
- **`xcodebuild … test -collect-test-diagnostics never` (used here to avoid
  the documented ten-minutes-on-failure hang) also drops a test's own
  `print()` output from `test.log`.** Every `print("FOLLOWING …")` line
  `FollowingProbe.swift`'s methods write is invisible in the wrapper's log
  with this flag set, even on a pass; only the XCTAttachment screenshots and
  the pass/fail line survive. Screenshots plus the `arm`/`analyse` frame log
  carried the evidence instead here; a script that needs a test's own stdout
  captured should weigh that against the hang risk case by case rather than
  assuming `-collect-test-diagnostics never` is free.
- **A Continuous drift's own step timing needs a different "glide" detector
  than a discrete line change's does.** `line-follow.cjs`'s existing
  `analyse` groups frames into episodes ended by three still frames, which
  almost never happens mid-sentence under Continuous (the drift itself is
  the "still frame" that never quite arrives), so it would read a whole
  sentence's worth of 1 px steps as one giant "episode". `continuous-follow.cjs`
  (new) first tried closing a "run" on any gap over 320 ms of full stillness,
  and still merged several sentences together into one false "glide" (70 px
  over 3408 ms, rate 0.02 px/ms — nothing like a real ~250 ms/20 px glide's
  ~0.09-0.12 px/ms) because ordinary inter-word rests measured here (183-718 ms)
  can be shorter than that gap. What actually tells a glide apart from the
  drift is **consecutive frame index**, not a time gap: a glide moves on every
  drawn frame for its whole span (`[2,3,2,2,2,2,1,2,1,1,1,1]`-shaped, as
  By line's own glides are), while the drift steps once roughly every 100 ms
  (median, measured) with several untouched frames in between. Grouping by
  a minimum run of consecutive moving frames (8+) instead reliably separated
  the two: three real glides at 1.0×, 217-234 ms each, rate 0.115-0.12 px/ms;
  two at 2.0×, 205-302 ms, rate ~0.093 px/ms — both clusters close to the
  ~250 ms figure design 0050 gives for either scrolling mode, and clearly
  apart from the drift's own much slower rate.
- **Reaching the automatic recovery rule's second half — "drag so the
  reading's line is on screen but off the line position" — by reversing the
  same fling that sent it far away does not reliably land there, because the
  reading is a moving target the whole time it is away.** A controlled,
  low-velocity drag (`press(forDuration:thenDragTo:withVelocity:250,
  thenHoldForDuration:0.1)`) repeated three times with only a 0.3 s gap
  between repeats twice registered as no drag at all — the page stayed
  exactly on the reading throughout (still `A`) despite three real touches —
  where the same shape once, or `FlingProbe`'s own repeated-flick shape, has
  been reliable elsewhere in this session; the cause was not isolated
  further, only worked around (space repeats further apart, or use
  `fastFling`). A single `fastFling` flick (`times: 1`) also did not
  register at all, matching `FlingProbe`'s own documented reason for using
  ten repeats rather than one. And a fling's own momentum is not reversible
  by construction: flinging away and then flinging back by the same shape
  measured here landed 3 chapters short of the reading's own current chapter
  (`Chapter 2023` shown against `Chapter 2026` marked current in Contents),
  because roughly a minute of real playback (the far wait, the reverse
  fling, the settle) had let the reading move on meanwhile. **Contents' own
  current-chapter row is a live, always-correct oracle for where the reading
  now is** (it marks `status.section`, not wherever the page is browsing),
  and choosing it while still Browsing is itself just Browsing somewhere
  else (#52) — not one of design 0050's three explicit "ways back" — so it
  reliably closes the gap without ending the test of the automatic path.
  Landing on the reading's own current chapter this way was measured to read
  as `A` within under a second every time it was tried (2026-09-26,
  `far2-04-after-recover-wait.png`), too fast to confirm whether that is
  because the tap lands within the same visible-page check the next cue
  would have made anyway, or because the "already on the page" Contents case
  (ADR 0048) does something more direct — worth isolating further if the
  exact mechanism ever matters, but the observable fact both explanations
  share (no further tap, no Play press, and the page still returns) is the
  one design 0050 actually asks for.

- **The first synthesized drag of an XCTest run is often not a scroll, and a
  drag the page did take was M only by a pixel.** Symptom: `FollowingProbe`
  failed "A real drag did not turn A into M" 5 times in 7 in
  `testReopenAndShotAThenM`, and now and then elsewhere. Two causes, found
  with a touch tracer in the reader (notes, 2026-09-26 16:05–16:25). (1)
  XCTest: in three runs out of four the run's first
  `press(forDuration:thenDragTo:)` reached the page as one `touchmove` and no
  scroll at all; no later drag did. A page that did not move is rightly not
  Browsing. (2) The app: `dragged()` measured the finger in the section
  document's own coordinates, which scroll with the finger, so a 175 pt drag
  read as 8 to 11 px against `DRAG_PX` 10 (#71's fix round: it now measures on
  the screen). Fix in the probe: `dragToBrowsing(app, from, to)` makes a drag
  again, up to three times, only when the screenshot after it is identical to
  the one before; a drag that changed the screen and left A still fails. While
  playing, the moving highlight changes the screen regardless, so a swallowed
  drag there still fails the test: open the book with a tap first, which the
  bespoke methods do.

## Verifying #75: a download beside a Reading (2026-09-28)

- **Every chapter boundary reached while locked stops a locked measurement in
  this branch.** The next chapter's text is prepared only when the download
  reaches it, that preparation does not finish away from the screen, and the
  task goes `preparing` and then `blocked` after 60 s (#76). With this book's
  chapters of 56–95 texts at five at once, the first `playlock` run reached the
  boundary 27.6 s after `background`, inside the 25–40 s the background time
  was expected to last, so it could not show a download going on past it. It
  happened in `home` too, not only locked: the boundary 45 s after leaving
  stayed `preparing` for the remaining 46 s. Fix: prepare the chapters after
  the first in the foreground beforehand with `download-prepare.cjs` (their
  text only, no clip), and enqueue a fresh first chapter followed by them;
  say in the report that it was done.
- **A longest stay on one Utterance "while playing" of 78.6 s was a pause, not
  a stall.** The first version of the sampler's summary took every sample
  that read `playing` and joined the last Utterance before a pause with the
  first after the Reading played again. `download-sampler.cjs read` breaks a
  stay at any sample that is not playing.
- **A drawer probe failed on the test's own scroll.** `testReadDrawer` failed
  with `No ring reads Pause download` (0 on screen, 72 `Resume download`), after
  a CDP `scrollToIndex` had thrown (Pitfalls, cdp.md) and left the list at
  chapters 53–57, far from the chapters being written; its screenshot showed
  `Downloading…` there. The same method passed after `SCROLL_TO` had put the
  row in view (4 `Pause download`). Check where a scroll landed before trusting
  what a probe found on screen.

## Verifying #74: the long-press fix on a fresh simulator (2026-09-29)

- **`TranslationProbe.testLongPressWhenEnabledAndReaderOpen` cannot follow a
  method that leaves the lookup drawer open — including itself.** Its only
  precondition waits 10 s for the player footer's `Choose a Voice`, and an open
  drawer replaces the player footer in the accessibility tree (the drawer holds
  `Close lookup`, `Lookup panel height` and the pronunciation buttons from y≈500
  down), so the run failed at once with `XCTAssertTrue failed` before any gesture.
  The failure attachment's UI hierarchy named the reader's own navigation bar and
  the open drawer, which is what separates it from an app fault: no long press was
  made. Fix: run `testCloseCurrentLookupDrawer` first — it ends with the drawer
  closed and the reader open — or any method that closes the drawer, before it.
- **The simulator's own log classifies long presses the way the phone's
  `long-press-watch.py` does**, with no diagnostic build at all: every long press
  on a word logs `[WebKit:DragAndDrop] Drag session requested` about 0.65 s after
  touch-down (a working press then logs `Drag session failed (missing staged drag
  source)` — on the simulator this is normal, not a failure) followed within tens
  of ms by `[WebKit:TextInteraction] … selectTextWithGranularity:atPoint:`. So:
  `xcrun simctl spawn UDID log show --style compact --start '…' --predicate 'process
  == "OpenReader" AND (eventMessage CONTAINS "Drag session requested" OR eventMessage
  CONTAINS "selectTextWithGranularity:atPoint")'` gives one press per `Drag session
  requested` line and whether a selection began. A press with lookup disabled also
  starts the WebKit selection (the app keeps `user-select: text` for its own
  highlight painting); only the drawer is gated.
- **The post-boot volume reset recurred on a brand-new iPhone 18 Pro (iOS 27.0),
  twice.** `silence.sh set` right after `bootstatus -b` read 0; `run-probe.sh`'s own
  check refused with 60 about ten minutes later, and again 20 minutes after that.
  Nothing had played and no output device changed that the Mac reported. The kit's
  existing rule — `set` again, then let the next `run-probe.sh` check gate the run —
  is what worked; no new fix needed.

## Verifying #88/#89: the drawer's marked chapter beside a Reading (2026-09-30)

- **The marked row is the row of the spine section the Reading is in, and a
  section index is not a chapter number.** My Vampire System — Chapters 1–250
  has two front-matter spine items (253 sections for 250 chapters), so a paused
  `hx.cjs '{"do":"say"}'` reading `section=173` with the position on Chapter
  172's tail sentences ("He didn't want to upset this little family…") marked —
  in the Download drawer opened from the Library while playing and in Contents
  alike — "Chapter 172: Bad Timing", and one utterance later, on Chapter 173's
  first sentence (section 174), both marked "Chapter 173: My Puppet". When the
  brief says "Chapter 173 on the page", read the HX `utterance=`/`section=`
  line before naming the row the drawer should mark.
- **The 10 s window fits the Library → `…` → Download chain, but budget the
  screenshots.** `play-for 10` schedules the in-app pause 10 s after `onPlay`
  (which itself lands about 1.5 s after the spawn); Back, the row's `…`,
  Download and two `simctl io screenshot` calls took about 7 s. Each
  screenshot costs 1.5–2 s — order the steps so the screenshot you must have
  inside the window comes first, and rebuild the timeline afterwards from the
  files' mtimes against `play.log`'s.
- **A screenshot taken 1.5 s after Back still showed the reader.** The
  navigation had not reached the frame `simctl io` captured (the Library was
  only proven by the next taps landing). Take the post-navigation screenshot at
  least 2 s after the tap.
- **Reopening the reader reverted a paused tap-cue to the previous stop.** The
  tap-cue moved the position to "It wasn't too hot…" (the Library row's Last
  read quoted it), but after closing and reopening the reader the paused status
  read `utterance=321` — "He didn't want to upset this little family…", the
  sentence the reading had last stopped on — and playback resumed there. The
  cue did not survive the close/reopen. Reported as a reader finding, not a
  drawer one: the drawer followed the live Reading either way, and the follow-up
  run (paused on Chapter 173's heading) marked "Chapter 173: My Puppet".
- **The Reading Button's playing state is provable from stills by byte-compare.**
  Crops of the button region from two paused screenshots taken ten minutes apart
  were byte-identical, while crops from two screenshots 1.5 s apart during
  playback differed from them and from each other — the waveform animates while
  playing and is static while paused.
- **`cdp.cjs --warnings` caps at 8000 ms**, printing `Warning capture must be
  between 0 and 8000 ms` and exiting after only replaying the buffer — a 30000 ms
  window never listens. Cover a longer interaction with back-to-back 8 s windows,
  one drawer cycle each; each window also replays the warnings buffered before it.
- **No LogBox warnings or errors from the drawer, from either entry point.**
  Three 8 s windows over the whole sequence — Library `…` → Download → close;
  row → reader `…` → Download open from the reader; reader drawer close → Back —
  each printed only CDP's own replay notice `Only limited number of console
  messages can be cached. N messages were discarded at the beginning.` (888,
  897, 906 as ordinary console logs accumulated; the notice is the debugger's,
  not the app's). No `GO_BACK` warning: every `hx.cjs` call had carried the
  harness file's `seq` forward, so no stale command was pending.
- **A reader reopen at a chapter boundary painted blank first.** With the
  position on Chapter 173's first sentence (right after its heading), reopening
  the reader showed nav bar and player over a fully blank page (`rendered=173`
  while `at=174` — the boundary gap); the text painted by itself about 7 s
  later, band on the stored sentence. Transient, self-recovered; earlier reopens
  with the position mid-chapter painted immediately.
- **The held Reading was gone after reader → its Download drawer → Back, and
  only then.** Byte-comparing the Library's bottom-right corner: the Reading
  Button (paused waveform) survived a Library drawer open+close at 00:29 and two
  earlier reader → Back returns (00:12 paused, 00:26 playing), but it was absent
  from 00:35:33 on, after the cycle row → reader → `…` → Download → close drawer
  → Back with the Reading paused. `reading.cjs state` on the Library then fails
  with `Reading handler evaluation failed` (no mounted Player), which is itself
  the sign the held Reading is gone, not that playback runs. The stored Reading
  Position stayed intact (the row's Last read still quoted it). Whether a paused
  Reading adopted by the reader should survive that particular path is the
  implementing agent's call; items 5 and 6 above were both established before
  it, and the leaving condition (Library, stopped) holds.

## A leftover `harness.json` replays its last command at every app relaunch (#95, 2026-09-30)

- **Symptom:** testing the share button's missing-file note, the kept `library/sha256-*.epub` was moved out and `ls` confirmed the directory empty; one probe relaunch later the file was back (its original birth time — an APFS clone), the share sheet rose, and the "missing file" assertion failed.
- **Cause:** the walkthrough harness polls `Documents/harness.json` from `seenRef = -1` at every launch, so whatever command is still in the file runs again. This tree's file still held `{"seq":1,"do":"add","file":"…"}`; the Debug Log shows `[hx] added sha256:…` one second after each `[launch]` line (02:28:37, 02:29:43, 02:31:22, 02:33:36), and `library.add` re-copies the file from `Documents/Inbox` (`add` uses `move: false`, so the Inbox copy survives as a permanent re-adding source). The relaunch had silently undone the fixture change.
- **Fix:** before any test that removes or changes container files across a relaunch, overwrite `harness.json` with a harmless high-seq command, e.g. `printf '{"seq":9999,"do":"shelf"}' > "$CONT/Documents/harness.json"`. Check the Debug Log's `[hx]` lines when a fixture refuses to stay as you left it.

## Verifying #105: a place kept while playing, taken when the reading stops (2026-09-30)

Simulator `iPhone 17 issue105b` (AF2B8F6C-7B2E-40B2-BE63-03AD93F2331E,
iOS 27.0, created for this run), Debug build from this worktree at the fix
commit `cab15f3` (APP_VERSION 0.0.2-beta70), JS from this tree's Metro on
port 8100, narration through the owner's Kokoro gateway (voice af_bella,
headers typed by `ProviderHeaders105Probe`), sync pointed at the local stub
`stub-105.py` on 127.0.0.1:8899, fixture `issue105-fixture.ts`
(`Issue 105 Fixture`, `sha256:d96e1571…`): chapter one holds the long phone
sentence A (Utterance 1, ~26 s spoken at 1.50×), `Phone old continuation.`
(2), `Desktop new sentence.` (3 = B), `Desktop new continuation.` (4).

**Main scenario, real touches (Scenario105Probe, 22:24).** Phone resumed at A
paused; Library = A (Stamp 1790776852047, iPhone-ioldisho); the stub served
B with a newer Stamp (device `desktop-105`) and held Play's GET 4 s. Play at
22:24:27.9 → `play at utterance 1` at 22:24:30.0 (the two-second bound); the
released download adopted B at 22:24:32.1 ("1 places taken, nothing
uploaded") — kept by the playing Reading. Pause at 22:24:36.3, while A was
still being spoken: `pause at utterance 1`, and the kept place was taken —
`[hx]` reads `utterance=3`, the highlight band sits on "Desktop new
sentence." in the screenshot while paused, the Library file holds the
desktop Stamp (1790778234917, desktop-105), and no PUT happened at all
("nothing uploaded" twice). Play again → `play at utterance 3` (the reading
starts at B, "0 places taken, nothing uploaded"), played through B's
continuation and paused; the pause uploaded the phone's then-sentence
("A short second chapter the scenario never renders.", device
iPhone-ioldisho) — a later sentence, never A's continuation.

**Control, real touches (22:56 and 23:46).** Same setup; speech passed into
the sentence after A before stopping: the adoption was kept mid-play
("1 places taken" at +4 s), the reading played on — no seek to B anywhere in
the log — and the phone's own next sentence was written above the desktop's
place ("Phone old continuation.", Stamp 1790783206549, iPhone-ioldisho, at
23:46:46). The next sync moment uploaded exactly that item (PUT #78/#79:
`exact='Phone old continuation.' device=iPhone-ioldisho`), and B appears in
no upload. In both control attempts the reading reached the document's end
before the probe's Pause tap (end 22:56:48, tap 22:56:56; end 23:46:53, tap
23:46:58). So the stop was the engine's own at the end of the book, and the
cursor stayed on Utterance 6, not B's 3. The control's upload was captured
as the written place's next-moment upload rather than the pause poke; the
kept-place-let-go behaviour is the run's own.

**Every XCTest run, as its `test.log` says it** (checked by the implementing
agent against the Debug Log):

| run | method | result | where it came from |
| --- | --- | --- | --- |
| 21:08 | ProviderHeaders105Probe | 1 failure | the probe's own predicate; the gateway answered 200 |
| 21:23 | SavePassword105Probe | skipped | no alert up |
| 21:26 | SavePassword105Probe | 0 failures | |
| 22:09 | testPlayPauseWithHeldDownload | 1 failure | no `Play` in the tree; no handler call |
| 22:23 | testPlayPauseWithHeldDownload | 0 failures | the main scenario |
| 22:26 | testPlayFromAdoptedPlaceThenPause | 0 failures | the second half |
| 22:29, 22:40 | testPlayFromAdoptedPlaceThenPause | 2 failures each | Play hit point `{-1, -1}`; no `play` in the Debug Log |
| 22:54 | testPlayPauseWithHeldDownload | 2 failures | Pause after the end of the book |
| 23:02, 23:15, 23:29 | testPlayPauseWithHeldDownload | 2, 3, 3 failures | Play hit point `{-1, -1}`; no `play` in the Debug Log |
| 23:46 | testPlayPauseWithHeldDownload | 2 failures | Pause after the end of the book |

**Not established here:** the pause from the lock screen / Now Playing (item
3 of the plan) — the engine-self-stop path was exercised repeatedly (every
overshoot) and behaved as the pause does each time, but no lock-screen press
was made. What the run cannot prove: nothing about real devices, drift, or
the desktop plugin's writer.

## Verifying #112: a section crossed away from the screen (2026-10-01)

- **`background-crossing.sh` read a stale status line and voided its own run.**
  - Symptom (ios-tester, 03:33): `VOID: not in section 51 with only 52 rendered ahead`, with the place now in section 1.
  - Cause: the app had been relaunched at 03:29 and sat on the Library. The script took `known` from the last `[hx] playing=` line in the file, written before the relaunch. Its first `seek` went to a Reader that was not mounted and was dropped, so the next one landed on a sentence in section 1.
  - Fix, in the script since: it opens the book first, and refuses a status line older than that.
- **`browse-probe.cjs` read RED on a correct browse.**
  - Symptom (ios-tester, 03:50–03:58, on both *My Vampire System* and the recipe's own *Cultivation Online*): the probe's `page top` was the section before the one browsed to, while the screenshot showed the chosen chapter's heading at the top.
  - Cause: the probe took the page's top at the container's edge. Since #67 the bar's room, the container's `::before` (54 px on an iPhone 17), sits above it, and `landBelowBar` lands a displayed section below that room. The previous section's iframe therefore covers the container's edge.
  - Fix: the probe measures at the edge plus the `::before` height. Re-run at 04:03 on *Cultivation Online*, section 3: `page top=3`, GREEN.
- **A tester run covering many recipes hit the subagent's 30-minute limit.** It ended in the middle of a chapter download (`download-chapter.cjs`, `Command aborted`), before its report, and wrote none of its pitfalls. Every recipe it had finished was recoverable from its transcript. Give a long verification a longer timeout, or split it into runs of a few recipes each.
- **`reading.cjs` answered `fetch failed`** against a Metro on 8112. Its default is `127.0.0.1:8081`, like `cdp.cjs` (pitfalls/cdp.md); pass `OPENREADER_METRO=http://127.0.0.1:PORT`.

## The #119 run (2026-10-01)

- **The harness's `settings` patch sets the app's voice, but a Reading reads the Document's — and a `play` with the latter empty is refused in silence.**
  - Symptom: `{"do":"settings","patch":{"provider":"local","enabledProviders":["local"],"local":{…},"voice":"af_bella"}}` persisted (`settings.json` and `{"do":"saysettings"}` both confirm it), yet the reader's `{"do":"say"}` printed `voiceInUse=null provider=local voice= rate=1.5` with the voice empty, and `{"do":"play"}` produced exactly one Debug Log line — `[reading] play at utterance none, local ` (the voice after `local` is empty) — with `playing` staying false and no note.
  - Cause: the reader is handed `settingsForDocument(settings, documentVoice)` (ADR 0010), and a Library entry with `voice: null` overrides the app's voice with an empty one. `use-reading.ts`'s `build()` then returns a null engine on `!ready.ready` (`missing: ['a Voice']`), and `play()`'s early `setStatus(playing: true)` is followed by the null-engine branch setting it straight back — one `play at utterance none` line and nothing else. The UI's own Play button would have opened the Voice sheet instead (`!settings.voice.trim()` → `setVoicesOpen(true)`), which is why a manual tap never meets this.
  - Fix: after opening the Reader, bind the voice for the Document: `node test/manual-test/kit/hx.cjs UDID '{"do":"voice","provider":"local","voice":"af_bella"}'` (reading-view's harness `voice` → `chooseVoice` → `library.voiced`). The recipe that has always carried both commands (e.g. `../voices-and-providers/consent.md`, `../place-and-following/background-crossing.md`) is right; this note is what the missing second command looks like from the log. Cost here: two silent `play`s before the `[reading] play` line's empty voice was read closely.
