# Late adoptions, repeated copies and heading confusions on the simulator (#249, #250, #282, #283)

Verified on the simulator, 2026-10-20, against `1.0.0 (9)-beta19` at 18b37fb
(`xujialiu/fix_3--ios-positions`; the JavaScript came from Metro serving the
parent worktree at the identical HEAD). Simulator: a session-created
`iPhone 17 pos19` on the iOS 26.5 runtime (UDID
`7CD21014-E850-46F3-9583-14332655281C`), Debug build 9 built from the worktree
by the guarded phase (`ios_guard.py run` → `xcodebuild … build`), installed
over nothing, launched with `RCT_jsLocation` pinned to that Metro. Everything
here is this run's measurement, not a general recipe.

## Setup

- **Speech**: the kit's fake OpenAI-compatible server
  (`../player-and-reading-held/fake-kokoro.cjs`) on `127.0.0.1:8891`,
  configured with the harness settings patch (`provider: compatible`,
  `enabledProviders`, `compatible.baseURL`, `compatible.model: fake-tts`).
  The consent alert was answered once, after reading its title — it named
  `127.0.0.1:8891`, the fake, and nobody else. **The voice was per document
  (ADR 0010)** then: a harness `play` on a fresh Document silently did nothing
  (`[reading] play at utterance none, compatible ` — an empty voice) where
  the Play button would have opened the Voice sheet; each Document under test
  got `{"do":"voice","provider":"compatible","voice":"alloy"}` first. Since
  #327 (ADR 0089) one such command serves every Document.
- **Sync**: `delaying-webdav.cjs 8723 4000` (the GET and PUT of the Positions
  File held 4 s) at `http://127.0.0.1:8723/pos19-sync/`. The URL and username
  went in with the settings patch; the password was typed per character into
  the masked field with an `axe batch` and the switch flipped with a real
  touch — the switch's own check (a PROPFIND through the delaying server) is
  what proves the password, since the masked field reads back only dots.
- **Fixtures**: `../fixtures/positions-copies-fixture.ts` (written for this
  run) generates `Positions and Copies` — `Go. Go. Stop now.`, 100 ×
  `Is this number N? Yes.`, 100 bare `Yes.` — and `Named Places` —
  `Chapter 1`/`Chapter 10`, `7`/`1907`, `第1章`/`第10章`, each pair in a
  chapter of its own so the fallback search cannot tie across look-alikes.
  The existing `Issue 105 Fixture` carried the #249 scenarios.
- **Evidence**: `Documents/library.json` read from the container,
  `latest-positions.json` from the server's state directory, the app's Debug
  Log, Metro's log, and screenshots. Raw before/mid/after Library and
  Positions JSON snapshots and the on-device Debug Log (under followup
  suffixes) are kept in the run directory.

## What was measured

- **#250, the later of two identical sentences**: pause on the first `Go.`
  wrote `{exact: 'Go.', prefix: '', suffix: ' Go. Stop now.'}`; a pause on the
  second wrote `{exact: 'Go.', prefix: 'Go. ', suffix: ' Stop now.'}` — the
  later copy saved over the earlier one and uploaded, and after a leave +
  reopen the reading resumed at **utterance 2**, the later copy, with
  `resume="Resumed at the sentence the reading stopped on."`. A later
  play+pause on the same copy re-stamped nothing (`pause: ok … nothing
  uploaded`; the position stamp stood).
- **#283, past the old 64-occurrence cap**: a pause on the 100th `Yes.` (the
  block's utterance 203, whose prefix holds `Is this number 99?`) saved and,
  after a reopen, resumed at **utterance 203** by that context. An
  intermediate accident is recorded because it is diagnostic: a pause that
  rolled one sentence further saved the *first* bare `Yes.` (empty prefix),
  and such a place is inherently ambiguous — see the next line.
- **Indistinguishable copies refuse**: a pause in the middle of the 100 bare
  `Yes.` (utterance 254) saved; after a reopen, Play logged
  `play at utterance none` and the status line carried
  `resume="The sentence this book was left on appears in more than one
  [place …]"` — the reading started at the first sentence laid out
  (utterance 0), not at a guessed copy.
- **#282, a heading is not a substring of its neighbour**: for each pair the
  phone first stored both places (harvesting the app's own anchors and Block
  CFIs), then a desktop item was crafted with the **right anchor and the
  wrong Block's locator** and a newer Stamp, PUT to the server by hand, and
  adopted at the next open:
  - `Chapter 1` + `Chapter 10`'s locator → Play resumed at **utterance 1**
    (`Chapter 1`) with `resume="The paragraph this book was left in is not
    where it was, so [the sentence was found by its own text instead…]"`.
  - `7` + `1907`'s locator → resumed at **utterance 4** (`7`), same recovered
    note; the digit inside `1907` did not capture the match.
  - `第1章` + `第10章`'s locator → resumed at **utterance 7** (`第1章`),
    section 2, same recovered note — the CJK control, where ASCII word
    boundaries say nothing and the old aligner's partial match would have
    rescued the wrong Block.
- **#249, a late desktop adoption while the phone replays a sentence it had
  already reached** — the regression check requires prior genuinely new
  progress **inside the same mounted Reading**, because a fresh mount starts
  with `reachedRef.toWrite = null` and no old writeback to overwrite the
  adoption (a reopen-only replay passes on the old code too). The presses
  below were real touches on the Player's Play and Pause controls; the delaying
  server held the pre-Play sync's GET so the adoption landed mid-clip.
  Exact times are the Debug Log's (`+08:00`), all inside **one** mounted
  Reading of the `Issue 105 Fixture`, mounted 19:50:40.008 and closed
  19:51:38.726 — no reopen, and no Provider or Voice change, in between:

  1. **Prior progress in this Reading**: real Play at 19:50:53.205 →
     `play at utterance 3` 19:50:55.121 → real Pause at 19:51:11.376 landed
     on **utterance 4**, a genuinely different sentence
     (`pause at utterance 4` 19:51:11.270) → the pause wrote and uploaded it
     (`pause: ok … uploaded` 19:51:19.381). Library and Positions File now
     held `Desktop new continuation.` @ `iPhone-jzs58vve`, Stamp
     1792497063296 (mid-run snapshots).
  2. **Desktop place crafted now**: while the reader stayed open and paused,
     an item at utterance 2 (`Phone old continuation.`, the app's own
     harvested anchor and Block locator, Stamp 1792497123296 = mid + 60 s,
     device `pos19-desktop`) was PUT to the server (201).
  3. **Replay + adoption + switch**: real Play (no seek) at 19:51:31.714 →
     `play at utterance 4` 19:51:33.623 (the replay of the sentence this
     Reading had already reached; its cue matched the stored place and wrote
     nothing) → the held GET answered and **`play: ok … 1 places taken`**
     19:51:35.635 — the desktop place adopted while playing, kept → another
     Document opened at +5.1 s (`[document] closed` 19:51:38.726), before
     utterance 5's playing cue (the clip had ~11.8 s of wall time left; the
     19:51:33.981 `received=speak utterance=5` line is the prefetch arming,
     not a cue).
  4. **Assertion**: the unmount wrote **nothing**
     (`leave: ok … nothing uploaded` 19:51:42.755). Library and Positions
     File both kept the desktop item field-for-field — locator, anchor
     `{exact: 'Phone old continuation.', prefix: '', suffix: ' Desktop new
     sentence. …'}`, Stamp 1792497123296, device `pos19-desktop`
     (`c1c2-after-library.json`, `c1c2-after-server.json`,
     `c1c2-crafted.json`).

  Two earlier runs are kept as what they are, not evidence of the fix:
  - **Reopen-only control** (19:25 mount): a Reading reopened on its stored
    sentence, replayed, adoption kept, switch — desktop place stood. Valid
    only as the no-earlier-progress control: a fresh mount has no writeback
    to retire, so the old code passes it too.
  - **Failed attempt, control path** (19:45 mount): the same shape with the
    first pause 3.4 s into the 12 s clip — the replay resumed at the paused
    mid-clip position, leaving ~4.6 s of clip, and the switch at +6.5 s came
    68 ms after utterance 5's cue (`received=speak utterance=5` 19:45:45.393,
    close 19:45:45.461). The released adoption correctly lost to the phone's
    new sentence (Stamp `max(now, desktop+1)`); 30 s clips and an earlier
    pause fixed the budget for the run above.
- **Genuinely new speech wins (control)**: a newer desktop item adopted while
  the phone replayed its stored sentence was released by the next sentence's
  cue, and after a switch both stores held the phone's own newer place
  (`Desktop new sentence.` @ `iPhone-jzs58vve`, stamped above the desktop's).
- **Version**: Settings shows `Version 1.0.0 (9)-beta19-debug`, and the
  bundle Metro served (parent worktree, identical HEAD) contains
  `1.0.0 (9)-beta19`, `takeLatePlace` and `quotationEdgesAgree`.

## What the run cannot prove

- A physical device, backgrounding/suspension, the desktop plugin's own
  writer, and drift over long runs are untouched by this run.
- Real touches on the Player's Play button were used for the #249
  scenarios; harvest and resume plays went through `reading.cjs play-for`, which
  presses the Player's own Play and therefore **does** pass the 2 s pre-Play
  sync wait (only the harness's `{"do":"play"}`, used for setup, skips it).
  Handler-level plays are evidence about writes and resumes, not about
  button gestures.
- The first `Positions and Copies` import shipped one spine item (a fixture
  bug, below); every #250/#283 measurement ran inside its chapter one, whose
  content is the content tested. The repaired book (three spine items, new
  Document Id) carried the #282 scenarios.

## Pitfalls met on the way

Are in `../README.md`'s **Pitfalls** under this run's dated entry, and in
`../pitfalls/metro.md`: the fixture's missing `META-INF/container.xml` (the
reader sat on "Laying the document out…" for ever) and its mis-typed file
list (one spine item, the reading "ran out of text" after chapter one); the
per-document voice a harness `play` needs; the `online` flag a launch-time
connectivity event can leave false until the app restarts; `play-for`'s
budget against the 2 s pre-Play wait and the 1.50× rate; the replay resuming
at the paused mid-clip position, which shortens the window after an adoption
by the already-spoken remainder; and the stamp race — a paused seek before
the replay makes the replay's cue a *new* place whose fresh Stamp
legitimately beats the crafted desktop item (`0 places taken`), so the
desktop item must be crafted after the replayed sentence is already the
stored one, and newer than the place this Reading wrote since.

## Parent acceptance

The parent checked the corrected run's raw Debug Log and compared the mid-run,
after-switch and crafted desktop JSON snapshots. The first progress, pause,
replay, adoption and switch occur inside one mounted Reading; both after-switch
positions equal the crafted desktop position, including its unchanged Stamp.
The earlier reopen-only run is not counted as regression evidence. No XCTest
suite ran: the gesture evidence is AXe input, with handler probes identified
above. After merging the test-only records, all 3,124 host tests in 225 files,
TypeScript and ESLint passed. The application code is unchanged from 18b37fb.

## Integrated re-verification on `1.0.0 (9)-beta20` (e501d38, 2026-10-20)

After main's sentence-boundary batch (#240/#245/#241/#242, `sentencex`
0.4.2) was merged and the tree re-cut at e501d38, the same session device
and build 9's native app were reused (no native or dependency version
change; JavaScript from a fresh parent-worktree Metro on 8088; the empty
Positions File was re-created by the app's own first upload). Bounded
integration checks, not a rerun:

- **Splitter and bundle**: the served bundle names `1.0.0 (9)-beta20` and
  still carries `takeLatePlace`/`quotationEdgesAgree`; `sentencex` in the
  parent's `node_modules` is 0.4.2; Settings shows
  `Version 1.0.0 (9)-beta20-debug`. The `Positions and Copies` utterance map
  is unchanged under the new splitter (304 utterances, `Go.`/`Yes.`
  boundaries where they were), and `Named Places` still splits its CJK-digit
  headings whole (第1章/第10章 as utterances 7/8).
- **#250**: the later `Go.` copy saved and uploaded
  (`{exact:'Go.', prefix:'Go. ', suffix:' Stop now.'}`) and a reopen resumed
  at utterance 2 (`play at utterance 2` 20:32:29.054).
- **#283**: the 100th `Yes.` (prefix `…Is this number 99?`) saved and a
  reopen resumed at utterance 203 (`play at utterance 203` 20:33:12.768).
- **#282 (CJK control, interaction with the new splitter)**: a crafted
  desktop item with 第1章's anchor and 第10章's Block locator was adopted and
  the reading recovered to utterance 7 (第1章) — `play at utterance 7`
  20:35:34.590.
- **#249, same-mount regression (real touches throughout)** — mount opened
  20:59:47.964, closed 21:00:54.701, no reopen or Provider/Voice change in
  between: real Play 21:00:00.926 → `play at utterance 1` 21:00:02.841 →
  roll into utterance 2 (21:00:23.181) → real Pause landed on **utterance 2**
  (`pause at utterance 2` 21:00:24.983, a genuinely different sentence;
  `pause: ok … uploaded` 21:00:33.079) → desktop item at utterance 3 crafted
  while the reader sat paused (Stamp 1792501283108 = mid + 60 s, device
  `pos19-desktop`, PUT 201) → real Play, no seek, 21:00:47.275 →
  `play at utterance 2` 21:00:49.164 (the replay; its cue matched the stored
  place) → **`play: ok … 1 places taken` 21:00:51.196** (adopted mid-clip,
  kept) → switch Documents 21:00:54.701, before utterance 3's cue → the
  unmount wrote nothing (`leave: ok … nothing uploaded` 21:00:58.720) and
  Library and Positions File both kept the desktop item field for field
  (`b20f-after-*.json` vs `b20f-crafted.json`).

Two environment findings from this pass are in `../README.md`'s Pitfalls:
`ax.py` point touches stopped landing while tree reads kept working (two
silent failures with correct coordinates; an XCUITest-simulated tap reported
success equally fruitlessly), and a shutdown+boot of the session device —
the run's one recorded recovery — restored them.
