# WebDAV and cross-device items

## Talking to the owner's WebDAV host from the Mac

- **Every request answers `403` with the body `error code: 1010`, including a
  `PROPFIND` on a folder that is certainly there.** It is not the credentials
  and not the path: Cloudflare is refusing the client by its `User-Agent`, and
  `Python-urllib/3.x` is on its list. An hour can go into re-checking a
  percent-encoded address that was right all along.
  - Fix: send a browser `User-Agent` on every host-side request. With that one
    header the same `PROPFIND` answered `207`. The app itself is never affected
    — `fetch` on iOS sends its own agent.
- **A raw non-ASCII path segment in the URL raises before the request is even
  sent.** The owner's real Sync Folder has a Chinese path component; a bare
  `urllib.request.Request(url, …)` built from it fails with
  `UnicodeEncodeError: 'ascii' codec can't encode characters …` inside
  `http.client.putrequest`, for every method, before any network call is
  attempted. `fetch` on iOS encodes this for the app; a host-side script must
  do it itself: `urllib.parse.quote` the URL's path component (leaving the
  scheme and host alone) before building the request. Met 2026-09-24 crafting
  a #54/#55 desktop item into `<test folder>/openreader-54/…json` — the test
  subfolder segment is plain ASCII, but the owner's own folder segment above
  it in the same address is not.
- **`urllib`'s `MKCOL` with no body raises instead of answering.** `Request(url,
  method='MKCOL')` with `data=None` sends no `Content-Length`, and the helper
  reported status `0` (its exception branch) for a folder that was never
  created; the next `PROPFIND` then said `404` and the run looked like a folder
  the server would not make. Pass `data=b''`.
- **Deleting the positions file mid-run brings it straight back.** With a book
  still on the shelf, the next sync moment finds a `404`, treats it as the
  ordinary first run, re-creates the folder and uploads the phone's items —
  measured 2026-09-21: the file was gone at 22:50:55 and back, byte-identical,
  by 22:51:10. Empty the shelf first, or point the app elsewhere, before
  clearing the file for a fresh baseline.
- **A helper that deletes the folder as well as the file needs the folder put
  back.** `MKCOL` on an existing folder answers `405`, which is the "already
  there" answer and not a failure.
- **A host-side poller that dies quietly reads as "the phone never uploaded".**
  On 2026-09-22 the two-second `GET` poller on the owner's file stopped
  logging at 11:00:27, the pause at 11:01:41 then appeared to upload nothing,
  and only a `kill` that answered "no such process" gave it away: one `GET`
  had raised `URLError` (`[SSL: UNEXPECTED_EOF_WHILE_READING]` from
  Cloudflare), which `urlopen` does not wrap as `HTTPError`, and the loop had
  no `except` for it. Catch `URLError`/`OSError` per poll and log the failure
  as a line, and before trusting an "unchanged" tail check that the poller is
  still alive — a fresh `GET` afterwards showed the upload had happened; the
  file's `Last-Modified` header gives the time a dead poller missed.
- **A shelf that has to stay populated still uploads every position it holds,
  including the version-1 ones nothing can beat.** Switching sync on against
  the owner's real folder uploads an item for every entry with a position; a
  position read out of a version-1 Library file goes out as `stamp.at` 0 under
  this device's name, no merge ever beats or removes it, and a desktop that
  holds the same EPUB and has never read it adopts it. On 2026-09-22 仙逆 and
  the short fixture carried such positions (`{"at":0,"device":""}` in
  `library.json`) and the owner's file held neither id. When the shelf cannot
  be emptied (`testRemoveEveryBook`), terminate the app, back up
  `library.json`, set those entries' `position` to `null`, and check that the
  file's baseline hash is unchanged after the switch-on sync — it was.

## Crafting a cross-device item for #54/#55

Verifying that Play adopts a place a desktop just wrote needs a real,
document-matching item on the server, written host-side and timed against a
real running app — not a stub. Four things went wrong doing that on
2026-09-24, all against the real WebDAV host (the `openreader-54` test
subfolder), none of them the app being wrong.

- **A host-side script cannot `Process`/`NSTask` its way out of an
  XCUITest method.** The obvious way to keep the gap between crafting an item
  and pressing Play short — call the crafting script from inside the Swift
  method, right before the tap — fails to compile: `cannot find 'Process' in
  scope`. This probe target builds for `iphonesimulator` (an iOS binary), and
  iOS has no process-spawning API at all; this is not a missing import.
  - Fix: a file both sides poll. The XCTest method writes a JSON request
    (`{"seq", "doc_id", "template", "device", "delta_ms"}`) to a fixed host
    path and polls a second path for a matching `seq`; a plain Python script
    already running on the host (`craft_watcher.py`, started once before the
    run and left running) polls the request path, runs the craft the moment a
    new `seq` appears, and writes the answer atomically (`os.replace`, so the
    Swift side never reads a half-written file). Measured round trip: ~0.2–0.5 s,
    against 20–40 s for the alternative below.
- **Crafting from the caller's shell, then launching a new `xcodebuild`, puts
  20–40 s between the craft and the Play tap — long enough for an unrelated
  poke to adopt it first, or for the phone to have moved on since.** Four
  consecutive attempts this way misbehaved in two different directions, both
  explained once measured:
  - Sometimes the item was already adopted **before the method's first
    line ran**: the new test process's own attach/`app.activate()` fires an
    ordinary `foreground` poke (unbounded, not the 2 s one `play()` waits on),
    which had 20–40 s of build-and-attach time to download, merge and adopt
    the already-crafted item in the background. What looked like "Play
    adopted it" was that poke's landing, observed only because Play happened
    to be pressed afterward — not evidence about `sync.wait('play')` at all.
  - Other times the item was **never** adopted, with the sync outcome (see
    the `synclast` harness command below) showing `remote:1, adopted:[],
    uploaded:true` — the download succeeded, but the merge kept the phone's
    own item as newer and re-uploaded it verbatim. Cause: `reading.play()`
    always runs after the sync's `.then`, adoption or not, so a Play that
    fails to adopt still plays on locally — and while it does, the periodic
    position-write effect (`POSITION_INTERVAL_MS`) keeps stamping the phone's
    *local* entry with the real wall clock. A next craft computed as
    "phone's last known stamp + a fixed delta" is stale the moment that local
    play has run past it, which it always had by the next attempt.
  - Fix: craft from inside the running method (the file handshake above),
    which keeps the craft-to-tap gap to what the method's own next few lines
    take, on the far side of the attach window rather than racing it.
- **A craft finishing under roughly a second before the Play tap can miss
  adoption even though the upload itself succeeded (`204`) and the merge logic
  is correct.** Measured 2026-09-24: two runs whose craft finished only ~0.2 s
  before the tap saw `adopted:[]` on the very next sync; every run whose craft
  finished 1–2 s before the tap adopted normally. The app's own download is
  already cache-busted (`whatwg-fetch`'s `?_=` query on every request), so this
  is not a caching bug in the app. Host-side, 16 PUT-then-GET pairs spaced
  0–1000 ms apart, with and without a warming read first, all read back the
  content just written — so it is not a caching bug in front of the host
  either. The cause was not isolated further; it sits somewhere in the
  sub-second window between one client's PUT finishing and another client's
  next GET starting, outside this app's own logic, and it does not matter to a
  real desktop client (which uploads roughly 10 s after its own pause, not
  milliseconds before another device's Play). Craft at least 2 s before the tap
  in any test that depends on adoption succeeding.
- **A crafted item's stamp must be anchored on the device's own current
  local stamp, read from its own `library.json`, not the server's copy of the
  phone's item.** The server lags whenever a local write has not yet been
  uploaded — normal while paused between sync moments — so "newer than what
  the server last said the phone had" is not the same question as "newer than
  what the phone actually holds right now," and the gap silently loses the
  merge with no error anywhere (see `synclast` above for how that was even
  visible). Read both the server's answer and the device's `Documents/
  library.json` directly (the container path from `simctl get_app_container`)
  and use whichever stamp is largest as the floor, plus the current wall
  clock, plus a margin.
  - A temporary harness command was added and removed to see this at all:
    `shell.tsx`, `{"do":"synclast"}` → `hlog(JSON.stringify(syncLast))`, the
    transport's own last outcome (`result`, `remote`, `adopted`, `uploaded`).
    Nothing else distinguishes "the run never happened," "it errored" and "it
    ran and found nothing new" from outside. Removed before finishing, in
    keeping with the walkthrough harness being pre-release tooling, but worth
    knowing it existed if the same question comes up again — it is a four-line
    addition in the same shape as `saysettings` right above it.
- **Harvesting a template by visiting the section leaves the device's own
  local position sitting at that section.** A section jump plus a real
  Play/Pause (`settleAt`, needed to get a real, document-matching
  locator/anchor rather than a hand-written CFI) is itself a real navigation:
  the phone is now *at* the section just harvested. Reusing that same section
  immediately afterward as another device's "newer, unrendered" target tests
  nothing — it is already rendered, and a run against it will look like a
  clean adoption while not exercising the wait at all. Harvest ahead of
  where the run will actually look, or explicitly move the device back to a
  different, already-rendered section (another `settleAt`) before crafting
  the target.
  - **The scope this actually holds at is the `ReadingView` mount, not the
    method call, and not the app process either** — `reportedSectionsRef`
    (`use-reading.ts`) is a plain `useRef` created inside `useReading`, so it
    resets on a fresh mount (a relaunch, or leaving and reopening the same
    book) but is shared by *every* harness/XCTest call that reuses the
    already-open reader (`app.activate()`, never `app.terminate()`) in
    between. Measured 2026-09-24 verifying #54 scenario A/B/C the first time:
    `testHarvestOneTemplate` (which itself does a section jump, to harvest
    that section's real locator/anchor) and the scenario method that then
    crafted and played *that same section* both ran via `app.activate()`
    against one continuous mount that had never been torn down since the
    reader was first opened. The craft-to-play gap was genuinely short (the
    file-handshake fix above), but the target had already been displayed
    minutes earlier by its own harvest, in the same mount — so the "adopted
    and landed" observed was an ordinary already-known-Blocks resume, not the
    pending-place wait #54 adds. One run's timing (0.98 s tap-to-word-level
    audio while still backgrounded) was the tell in hindsight: real cross-
    device layout+synthesis measured elsewhere took several seconds. The safe
    protocol: harvest in one process, `app.terminate()`/`app.launch()` so the
    process under test starts with a genuinely empty `reportedSectionsRef`,
    open at a place far from the target and let it settle, *then* craft the
    target and test. `testHarvestOneTemplate` and the scenario methods now
    always relaunch for this reason, at the cost of the relaunch's own time.
- **A `goToSection` jump jump across a large gap (~1000+ spine indices) can
  silently fail to move the cursor, even in a freshly relaunched process.**
  Measured 2026-09-24: jumping 500 → 1600 (harvesting a template) left
  `status.section` at `500` indefinitely — confirmed by polling a harness
  `"say"` for over 100 s with nothing else sent in between — while
  `status.rendered.index` reached `1601` (the render-ahead-of-target pattern
  every other jump also shows), meaning the section *did* report, just
  without the cursor ever moving to it. Not fully root-caused (a `handleBlocks`
  report for an intermediate section somehow consuming or missing the
  `pendingSectionRef` match is suspected, not proven), and not reproduced at
  every large gap — several ~500–700-index jumps elsewhere in the same session
  worked normally. Avoid gaps close to or above 1000 when choosing a harvest
  or craft target relative to wherever the device currently is; every gap
  used successfully in the end was 700 or under. `settleAt` now confirms the
  jump via a harness `"say"` read back from Metro's own log (`library.json`'s
  write is throttled and can lag a jump that did work, so it is not what to
  check) and retries up to three times rather than trusting a fixed sleep —
  which caught this failure instead of silently harvesting the wrong section
  under the requested one's name.
- **The Notification Centre swipe measured flaky, independent of the mount
  issue above.** Three separate, freshly-relaunched runs in one session found
  no `UIA.MediaControls.NowPlaying.CenterButton` after the documented
  top-left-edge swipe, including with three retries and a longer settle each
  time (nine total attempts, zero successes, after the one run earlier the
  same day that *had* worked with a single attempt). The accessibility tree
  captured on failure showed only an empty `Application` root for
  `com.apple.springboard`, which did not explain why. No alternative surfaced:
  there is no `simctl` command to simulate a hardware remote-command press,
  and this environment had no native desktop Computer Use tool to fall back to
  (only a browser-scoped one, which cannot reach the Simulator window) — the
  MEMORY/device-testing.md-sanctioned fallback for when `xcrun`/XCTest cannot perform an
  action. A run that needs the actual remote surface should budget for this
  being unreliable and check for it early, since discovering it only after
  crafting a target item leaves that item adopted through the ordinary
  foreground-while-paused path instead (harmless, but not what was being
  measured, and it consumes the target section).
- **`XCUIApplication.state` is not trustworthy evidence of backgrounding by
  itself.** Measured 2026-09-24: right after `XCUIDevice.shared.press(.home)`,
  and again a full 7 s later, `app.state.rawValue` read `4` (`.runningForeground`)
  — on a run where a whole-screen `XCUIScreen.main.screenshot()` taken at both
  moments showed the Home Screen, wallpaper and app icons, not the app. Only a
  third check, at 15 s, read `3` (`.runningBackground`). The screenshots are the
  ground truth; `app.state` lagged by at least 7 s on this iOS 27 simulator
  runtime and should be logged, not asserted on, until that lag is understood.
  A background check that only reads `.state` right after `press(.home)` and
  asserts on it can fail a genuinely-backgrounded run, or pass a run that never
  backgrounded at all — take a screenshot instead, or alongside.
- **Backgrounding right after a real screen tap stands in for a remote Play,
  but only with the craft at least 2 s before the tap, and it did not reach
  the layout question.** A remote Play and the screen's own end in the same
  `play()`, so `testScreenPlayThenHomeImmediately` avoids the unreliable
  Notification Centre swipe. It opens at a local place, plays briefly and
  pauses, so the engine, audio session and Now Playing registration exist as
  they would before a real lock-screen Play. It then crafts a target never
  displayed in this process, taps the screen's Play, and presses Home about
  half a second later.
  - Symptom: two runs adopted nothing and played the local place, and it
    looked like backgrounding's doing. Cause: the craft-to-tap gap in the
    pitfall above. Both crafts finished about 0.2 s before the tap, and a
    foreground control with the same gap failed the same way.
  - Measured 2026-09-24 with a 2 s gap, host-stamped `hlog` lines (added for
    the run and removed after). The Play sync adopted the item, and the
    target section reported with the place landed 0.45 s after the tap. That
    was before the app went inactive at 0.56 s, so the layout happened in the
    foreground. Clips then started at 1.9, 5.9 and 13.4 s, inside the 15 s
    background window: the JS thread and the audio go on in the background.
  - Not established: whether a section that has **not** laid out yet lays
    out while the app is in the background, which is what a lock-screen Play
    of a phone in a pocket needs. To reach it, Home has to land before the
    layout does, or the section has to take longer to lay out. A physical
    iPhone's suspension policy may differ from the simulator's anyway.
- **There is no `simctl` command to lock the simulator's screen** — checked
  (`xcrun simctl help`, `xcrun simctl` with no arguments): no such
  subcommand exists. A background-and-remote-Play check can go as far as a
  real Home press plus Notification Centre's swipe (the same
  `UIA.MediaControls.NowPlaying.CenterButton` surface `LockScreenProbe`/
  `lock-screen.sh` read), reached from the Home Screen the same way
  `testLockScreen` reaches it from inside the app. That establishes
  backgrounded behaviour; it does not establish behaviour under an actually
  locked screen, and a report that turns on this distinction should say which
  one was tested.
