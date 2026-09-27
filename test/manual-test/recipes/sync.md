# Sync

## Sync: the Sync screen, the switch, and places crossing devices (#20)

Real touches on Settings → Sync, and on the reader's transport, against a
WebDAV folder. Prerequisites: the latest Debug app connected to Metro, both
`A Short Test of Reading Aloud` and `仙逆` in the Library, and four credential
files written by the caller with mode 600 and **removed afterwards** — never
printed, never in a screenshot, never committed:

```sh
: > /tmp/openreader-sync-url.txt        # the folder, percent-encoded and ASCII
: > /tmp/openreader-sync-user.txt
: > /tmp/openreader-sync-pass.txt
: > /tmp/openreader-sync-wrongpass.txt  # the same password with a character added
chmod 600 /tmp/openreader-sync-*.txt
bash test/manual-test/sync.sh SIMULATOR_UDID /tmp/openreader-sync-01 \
  -only-testing:testSyncSwitchOutcomes
```

**Use a test subfolder of the owner's sync folder, never the folder itself.**
The real one holds the desktop plugin's live files, and `Address` is
photographed by every capture. A subfolder that does not exist yet also
exercises the 404 path the switch is supposed to accept. Delete the subfolder
and its file when the run ends. The WebDAV folder in `~/.secrets/openreader/`
is already such a test folder (the owner, 2026-09-23): use it directly, and a
place written there costs nothing. The owner's real folder is not in that
directory, and **Against the owner's real folder** below is about that one.

Run parameters go in `/tmp/openreader-sync-params.txt` as `KEY=VALUE` lines
(`PLAY_SECONDS`, `SKIPS`, `PARAGRAPH_STEPS`, `SETTLE`, `BOOK_TITLE`), because
`xcodebuild` does not pass the environment through.

The methods, in the order a full run uses them:

- `testSyncSwitchOutcomes` — types the folder, the username and a **wrong**
  password, turns the switch on and requires it back off with the reason on the
  status line and the fields still editable; retypes the right password and
  requires the switch on, all three fields frozen, and the missing-folder line;
  turns it off and requires the fields editable with their values kept; turns it
  back on and leaves it there. The only method that types.
- `testTypeAddressInChunks` / `testTypeLongIntoProviderAddress` — the pair that
  separates "typing at all" from "one long `typeText`" (see **Pitfalls**). The
  second is the control on a screen that exists on `main`; run it only to
  re-establish that the crash is not this screen's.
- `testSwitchOnAndWait` — turns the switch on with nothing else happening: no
  launch, no book, no backgrounding. Whether the first sync runs is then decided
  by the switch alone, and the caller reads the answer off the server.
- `testPlayPauseUploadsPlace` — opens `BOOK_TITLE` with a real touch, presses
  Play, prints **tap-to-playing** (the bound `use-sync.ts` puts on the pre-Play
  sync), plays for `PLAY_SECONDS` and presses Pause. Check the server from the
  host afterwards: the item's `stamp.device`, `locator` and `anchor.exact`.
- `testMoveOnParagraphs` — `PARAGRAPH_STEPS` taps on Next/Previous paragraph in
  the already-open reader, then a short Play and Pause, which is what writes the
  place and starts the sync: the reader writes on its own only every ten
  seconds.
- `testForegroundAdoption` — Home, wait, activate: the `foreground` sync moment,
  photographed before and after.
- `testBackgroundForegroundFromLibrary` (#59) — walks back to the Library
  first, so it never captures the Sync screen, then Home, wait, activate with
  no reader opened: a `background`/`foreground` sync moment for confirming
  nothing uploads when nothing changed, without touching any book's own
  position the way opening a reader could.
- `testReadSyncScreen` — reads the screen without touching the switch; used
  after a relaunch to show that sync came back on, frozen, without a new check.
- `testOpenBookOnly` — opens `BOOK_TITLE` with a real touch and leaves it paused:
  the `open` sync moment and nothing else, which is what an idle measurement
  needs to start from.
- `testSeekAwayAndBack` — the clear-on-seek path: a real tap on a word of the
  next sentence (`WORD_X`, `WORD_Y`, in points, taken from a screenshot of the
  middle of a line), one tap on Previous sentence to come back, then a short
  Play and Pause. The pause must write **this** device's Stamp on the sentence a
  resume landed on, because the cursor has been pointed somewhere in between.
- `testClaimBeforeRender` — the claim rule: Home, activate, then one real tap on
  a word of chapter 1 at `CLAIM_DELAY` seconds after the **Home press** (see
  **Pitfalls**), with the stalling stub deciding when the adopted place lands.
  Prints the Home, activation and tap times so a run that tapped too early is
  reported rather than counted.
- `testLeaveUnmovedWritesNothing` — defect 4, in three printed steps: play into
  the next sentence and pause, wait and leave with Back without playing, then
  re-open, play on and leave. The host's poller is read against `STEP-A/B/C`.
  `PLAY_SECONDS` must cross a sentence boundary (10 s in the three-chapter
  fixture); a pause on the sentence the reading was already on correctly writes
  nothing, which cannot be told from the defect.
- `testSwipeForward` — six swipes up the open reader, to find out whether a place
  adopted while the book is open is waiting for the section it names to render.
- `testRemoveEveryBook` — long press, Delete, confirm, for every row there is.
  Run it before any run against the owner's **real** folder, so that nothing of
  this simulator's can be uploaded into it.
- `testEnterFolderAndSwitchOn` / `testSwitchOffAndLeave` / `testReadSyncStatusOnly`
  — the three that are safe to point at the owner's real folder, because they
  **capture nothing**: no screenshot, no element-tree dump. Both a capture and a
  full-screen `xcrun simctl io … screenshot` taken while the Sync screen is up
  carry the address and the username, so take neither while that screen is on.

### Against the owner's real folder

A cross-product test needs the real folder, and then the subfolder rule above
cannot be followed. What replaces it:

- Empty the shelf first (`testRemoveEveryBook`). A place of this simulator's in
  the owner's file is the thing that cannot be undone.
- Use only the three capture-free methods on the Sync screen, and read the status
  line from their `print`, which does not carry the address.
- Keep a baseline: `curl` the file before the run and `shasum -a 256` it. With an
  empty shelf the phone must leave it **byte-identical** — the desktop plugin's
  file is already in the canonical spelling this build writes, so an upload is a
  finding, not a formality.
- Watch it while the run goes on, rather than only afterwards: a poller that
  `GET`s every two seconds and prints the hash and one item's `stamp` is how the
  upload was timed to within a second of the pause.
- A fixture the app must add: `xcrun simctl openurl UDID "file:///host/path.epub"`
  hands a host path straight to the app's document handler — the reader opens on
  it, and no `Inbox` copy or harness `add` is needed.

What none of it proves: nothing here is a physical-device test, a drift
measurement, or a test of the desktop plugin's own writer. The screenshots, not
the assertions, are what show the highlight moved; `statusLines` cannot see
inside the reader's WebView, so an empty "sentences added" list means only that
the chrome did not change.

A folder that answers the check and then stalls the download — for the two-second
Play bound, and for a place arriving while a reading is playing — is a stub the
caller runs on the host and points `sync.url` at:

```python
# PROPFIND -> 207 at once, GET -> sleep N then serve reply.json, PUT -> 201
```

A stub is the only way found to measure the bound: a wrong address cannot be
typed while the switch is on, and a simulator has no way to lose its network.
