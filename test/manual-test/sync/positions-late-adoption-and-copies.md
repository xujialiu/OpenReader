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
  (`../../player-and-reading-held/fake-kokoro.cjs`) on `127.0.0.1:8891`,
  configured with the harness settings patch (`provider: compatible`,
  `enabledProviders`, `compatible.baseURL`, `compatible.model: fake-tts`).
  The consent alert was answered once, after reading its title — it named
  `127.0.0.1:8891`, the fake, and nobody else. **The voice is per document
  (ADR 0010)**: a harness `play` on a fresh Document silently does nothing
  (`[reading] play at utterance none, compatible ` — an empty voice) where the
  Play button would have opened the Voice sheet; each Document under test got
  `{"do":"voice","provider":"compatible","voice":"alloy"}` first.
- **Sync**: `delaying-webdav.cjs 8723 4000` (the GET and PUT of the Positions
  File held 4 s) at `http://127.0.0.1:8723/pos19-sync/`. The URL and username
  went in with the settings patch; the password was typed per character into
  the masked field with an `axe batch` and the switch flipped with a real
  touch — the switch's own check (a PROPFIND through the delaying server) is
  what proves the password, since the masked field reads back only dots.
- **Fixtures**: `../../fixtures/positions-copies-fixture.ts` (written for this
  run) generates `Positions and Copies` — `Go. Go. Stop now.`, 100 ×
  `Is this number N? Yes.`, 100 bare `Yes.` — and `Named Places` —
  `Chapter 1`/`Chapter 10`, `7`/`1907`, `第1章`/`第10章`, each pair in a
  chapter of its own so the fallback search cannot tie across look-alikes.
  The existing `Issue 105 Fixture` carried the #249 scenarios.
- **Evidence**: `Documents/library.json` read from the container,
  `latest-positions.json` from the server's state directory, the app's Debug
  Log, Metro's log, and screenshots.

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
  already reached** (real touches on the Player's Play button, the delayed
  server holding the pre-Play sync's GET so the adoption lands mid-clip):
  - **The fix case**: the Library held the long sentence (utterance 1); a
    desktop item at utterance 2 (`Phone old continuation.`, Stamp +60 s,
    device `pos19-desktop`) was PUT while the reader sat paused on it; a real
    press of Play replayed utterance 1 (`play at utterance 1`), the held GET
    answered 4 s in (`[sync] play: ok … 1 places taken` — adopted while
    playing, kept), and another Document was opened 6 s into the 12 s clip.
    The unmount wrote **nothing**: the Library and the Positions File both
    kept the desktop item byte-for-byte (`Phone old continuation.` @
    `pos19-desktop`, Stamp unchanged), and the leave sync uploaded nothing.
  - **The control**: the same shape with a newer desktop item at the heading;
    this time the switch waited past the next sentence's cue (the 12 s clip
    is 8 s at the 1.50× rate — see Pitfalls). The cue of
    `Desktop new sentence.` released the kept place and wrote the phone's own
    newer Stamp; after the switch, Library and Positions File both held
    `Desktop new sentence.` @ `iPhone-jzs58vve`, stamped above the desktop's.
- **Version**: Settings shows `Version 1.0.0 (9)-beta19-debug`, and the
  bundle Metro served (parent worktree, identical HEAD) contains
  `1.0.0 (9)-beta19`, `takeLatePlace` and `quotationEdgesAgree`.

## What the run cannot prove

- A physical device, backgrounding/suspension, and the desktop plugin's own
  writer are untouched (host tests and the plugin's runs cover those).
- Every Play in the scenarios was the Player's real button **only** for the
  two #249 runs; all harvest/resume plays were handler-level
  (`reading.cjs play-for`, the Player's own `onPlay`), which skip the pre-Play
  sync wait — right for measuring writes and resumes, not evidence about the
  wait itself.
- The first `Positions and Copies` import shipped one spine item (a fixture
  bug, below); every #250/#283 measurement ran inside its chapter one, whose
  content is the content tested. The repaired book (three spine items, new
  Document Id) carried the #282 scenarios.

## Pitfalls met on the way

Are in `../../README.md`'s **Pitfalls** under this run's dated entry, and in
`../pitfalls/metro.md`: the fixture's missing `META-INF/container.xml` (the
reader sat on "Laying the document out…" for ever) and its mis-typed file
list (one spine item, the reading "ran out of text" after chapter one); the
per-document voice a harness Play needs; the `online` flag a launch-time
connectivity event can leave false until the app restarts; `play-for`'s
budget against the 2 s pre-Play wait and the 1.50× rate (a 2.5 s clip lasts
1.67 s); and the stamp race — a paused seek before the replay makes the
replay's cue a *new* place whose fresh Stamp legitimately beats the crafted
desktop item (`0 places taken`), so the desktop item must be crafted after
the replayed sentence is already the stored one.
