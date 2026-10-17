# The open Player on a 390-point phone, an untimed sentence above the Player, and the drawer's count (#218, #197, #144)

Run 2026-10-17 23:59 → 2026-10-18 01:10 on simulator `fix2-390-check`
(`40C495BE-58A1-4686-B0DC-EBA20C0555BA`, iPhone 16e, 390 × 844 pt, iOS 27.0),
tree `xujialiu/fix2--ios-check` at 824a922 (`1.0.0 (9)-beta1-debug`), this
worktree's Metro on 8093, and the kit's fake OpenAI-compatible TTS on
`127.0.0.1:8095` (4 s clips, log `/tmp/fix2-390-check/fake-tts.log`). The
app was built from this sub-worktree by the guarded phase
(`/tmp/fix2-390-check/verify-phase.sh` under `kit/ios_guard.py`): fresh
`expo prebuild`, `xcodebuild … -configuration Debug`, `simctl install`,
launch with `-RCT_jsLocation localhost:8093`, then `kit/ios_ready.py --metro`.
The container plist was pinned to `localhost:8093` (`plutil -replace` +
shutdown/boot) so `BracketsProbe`'s own bare relaunch reconnects to this
Metro, not whatever serves 8081.

## A. The build

Settings' version line read `Version 1.0.0 (9)-beta1-debug` (AX frame
36,758; screenshot `A-settings-version.png`). The same build passed
`ios_ready.py` with a real screenshot and a Metro OpenReader connection.

## B. #218 — the open Player at 390 points, default text size

`A Short Test of Reading Aloud` opened by a real touch on its Library row;
the Player is open as soon as a Document is open (no playback needed).

The seven transport controls, from `ax.py tree`
(`B-player-tree.txt`), one row, y 764–810:

| Control | x,y | w×h | gap from previous |
| --- | --- | --- | --- |
| Contents | 12,768 | 58×44 | — |
| Previous paragraph | 74,766 | 44×48 | 4.0 pt |
| Previous sentence | 121,766 | 44×48 | 3.0 pt |
| Play | 169,764 | 52×52 | 4.0 pt |
| Next sentence | 225,766 | 44×48 | 4.0 pt |
| Next paragraph | 272,766 | 44×48 | 3.0 pt |
| Playback speed, 1.50 times | 320,768 | 58×42 | 4.0 pt |

Every control ≥ 44 pt wide, none overlapping, minimum gap 3 pt; **Play's
centre x = 195.0** exactly. Head row above: Following mark 12,714 44×44,
Choose a Voice 142,714 106×44, Collapse 334,714 44×44. The Player's card
top hairline is at y 709.0–709.3 pt in `B-player-default.png` (border colour
row scan), so its height is **134.7 pt** — ADR 0050's 134.67, not the old
four-row ~235. The speed label reads `1.50×` on one line; no icon is clipped
at the 3–4 pt gaps (screenshot).

Real touches: Contents opened the Contents Drawer
(`B-contents-drawer.png`), closed with `axe drag` down its grabber; the
speed control opened its popover (`B-speed-popover.png`, `Playback speed`
group with Slower/Faster), closed by a touch on the head row's plain box.

At `xcrun simctl ui … content_size extra-extra-extra-large` the Player
rearranged (`B-player-xxxlarge.png`, `B-player-xxxlarge-tree.txt`): the head
row keeps only the M mark and the collapse arrow, **Choose a Voice on its own
row** (126,663 138×44), the five transport buttons on theirs (y 713–715), and
**Contents (12,771) and the speed (299,771) on a row below the transport**.
`large` restored the two-row layout.

## C. #197 — a sentence without Word Timings ends above the Player

Voice: **OpenAI Compatible** at the fake (`compatible` provider, base URL
`http://127.0.0.1:8095`, model `fake-tts`, voice `af_bella`). Its clips are
raw `/v1/audio/speech` PCM — the Debug Log's synthesis lines read
`4.00 s of PCM at 24000 Hz, 0 word timings`, so the whole-Utterance path ran
(`level=utterance` in the status line). General > Line position was set to
80 % with Scrolling By line (the default) through the harness settings patch;
the reading page's `LINE_POSITION` takes it live.

Fixture: `fixtures/untimed-placement-fixture.ts` (new) — heading, a lead
sentence, the long sentence (97 words, **17 lines, 508 pt tall** at the
default appearance on this phone), a one-line control, then filler
paragraphs. The filler is load-bearing: **the placement needs scroll room
below the sentence** — the first three runs were caught by the page clamped
at scrollTop 140 because a one-screen chapter cannot scroll the sentence's
end up to the Player's top, which reads exactly like the bug the fix removes
(see Pitfalls). Consent preflight: the first Play raised
`Send text to the server at 127.0.0.1:8095?` (`ax.py alert`,
`C-consent-alert.png`), the intended fake, answered Allow by real touch at
+25 s; the Debug Log then shows the three clips fetched and the engine start.

Catch runs used `player-and-reading-held/untimed-placement.cjs` (new):
silence check, harness seek to the utterance before the target, Play through
the debugger, poll the status line, pause on the catch, then **hold 1.5 s**
past it so the 250 ms glide and its per-frame re-measures are settled, then
screenshot. `untimed-scroll-recorder.js` + `wrap-scroll.js` sampled scrollTop
and the highlight box every 50 ms and wrapped `rendition.manager.scrollBy`.

**The long sentence, settled** (`C-long-settled-v2.png`): the highlight band
runs 202.3 → **709.3 pt** on the screenshot and the Player's top hairline is
at **709.3 pt** — the last highlighted line ends **at the Player's top
edge**. DOM: 17 line boxes, scrollTop settled at 219, last line's client
bottom 663.3 (screen 710.3). The wrapper shows the cue's scrollBy calls
converging to **+80.0 pt — exactly `box.bottom − seenTo`** for the fixed
`moveFor` — and the page following them to 219. Old `moveFor` would have
asked +60.9 (bottom ≈ 841 pt screen, three lines behind the Player).

**The control, one line** (`C-control-settled.png`): settled at scrollTop
381 (predicted 381.9), box 527.3..555.3 client, **middle at 541.3 client =
588.3 pt screen** against the 80 % line at 587.4 (101 + 0.8 × 608). Its
middle keeps the Line Position.

Playback per catch run: **4.88–4.99 s from the press to the catch + 1.5 s
hold ≈ 6.4 s**, paused immediately after; the 4 s lead clip at rate 1.0
accounts for the press-to-cue span, and the fact is established inside the
first ~1.4 s of the long sentence's own clip. Playback was only as long as
the placement needed. The simulator's volume returned to 60 between runs
three times; `silence.sh check` caught each and the `&&` chain stopped before
the play, as designed.

## D. #144 — the Download drawer's count

`A Short Test of Reading Aloud` (two chapters), its Voice set to
`compatible/af_bella` (the count answers the drawer's voice), real touches:
More actions → Download. The drawer read **`0 chapters downloaded`**
(`D-drawer-zero.png`); one chapter selected, Download selected (1) →
**`1 chapter downloaded`** (`D-drawer-one.png`, the row greyed with a check,
`Manage downloads` appeared) — a real download through the fake provider (19
synthesis requests in the fake's log); then the second chapter →
**`2 chapters downloaded`** (`D-drawer-two.png`). Singular with one, plural
with zero and two.

## E. The probes

- **Predicates** (code read): `GeneralFontsProbe`, `LibraryActionsProbe`,
  `ScrollThemeReaderProbe`, `BracketsProbe`, `PauseOrderProbe`,
  `TwoFingerProbe`, `DownloadConcurrencyProbe` all match
  `label MATCHES '[0-9]+ chapters? downloaded'`; `BracketsProbe` and
  `OfflineFixProbe` wait for the literal `1 chapter downloaded`.
- **Compile**: all eight changed probes were compiled with the kit's own
  machinery (`project.rb` + `xcodebuild build-for-testing`, guard-recorded):
  `GeneralFontsProbe`, `LibraryActionsProbe`, `ScrollThemeReaderProbe`,
  `PauseOrderProbe`, `TwoFingerProbe`, `DownloadConcurrencyProbe`,
  `OfflineFixProbe` each ended `BUILD SUCCEEDED`
  (`/tmp/fix2-390-check/probe-build-*/build.log`), and `BracketsProbe`
  compiled and ran through `run-probe.sh`. A bare
  `swiftc -typecheck` cannot see XCTest's Swift assertions on this Xcode
  (no `.swiftmodule` beside the framework's `module.modulemap`), so the
  project path is the compile proof.
- **Run**: `BracketsProbe.testDownloadStatLines` against this build — cold
  launch, Library `...`, Download, Select all, Download selected, and its
  wait for `1 chapter downloaded` **succeeded in 4.8 s of downloading**
  (raw log `t = 12.52s Waiting 90.0s for "1 chapter downloaded"` → found;
  `PROBE downloaded in 4.8 s`; attachment `stat-lines-downloaded`). The
  probe then **failed on its own last gesture**: it taps a `Close Download`
  button this build's drawer no longer has (#117 batch 2 removed it;
  `PauseOrderProbe` guards the same tap with `.exists`,
  `BracketsProbe.testDownloadStatLines` does not — `BracketsProbe.swift:55`).
  `Executed 1 test, with 1 failure` — the failure is the stale tap after the
  assertion under test passed; open finding for the implementing agent.

## What it cannot prove

- #218's other rearranging sizes (xLarge at 402, xxLarge at 414, …) — only
  the 390-point default and xxxLarge states were measured.
- #197 with a Word-Timings voice (the `line` path is a different code path,
  untouched by the fix), at 60/70 %, and with a note on the Player or a
  collapsed Player (no note appeared in these runs; the Player stayed open).
- A real hosted provider: everything ran against the local fake.
- The speed popover's rate change was not exercised (opened and closed only).
