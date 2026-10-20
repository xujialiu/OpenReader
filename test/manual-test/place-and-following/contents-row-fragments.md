# A Contents row opens its chapter, not the top of its file (#307)

Run 2026-10-20 09:17 → 10:08 on the session simulator `307-contents`
(`5C548A97-1FF2-4B36-85F1-BA3CDA6FE4E5`, iOS 27.0), the Debug build of this
tree at 6610f3a (`1.0.0 (9)-beta14`, native unchanged — the app was installed
from that build and relaunched with `-RCT_jsLocation 127.0.0.1:8097`), Metro
from this worktree on 8097, the fake Kokoro provider
(`../player-and-reading-held/fake-kokoro.cjs`) at 127.0.0.1:8799. Book: the
Gutenberg Pride and Prejudice copied unchanged from
`~/Works/epub_books/Pride and Prejudice/Pride and Prejudice - original.epub`
(Document `sha256:173688ad…`), and Cultivation Online 2001-2044
(`sha256:f8fbd467…`) as the control. Artifacts in `/tmp/307-contents-01/`
(`debug-log-run1-snapshot.txt`, `debug-log-fresh-container.txt`, `shot-*.png`,
`metro.log`, `fake-tts.log`); the first row measured in an earlier attempt
that the Mac's sleep cut short is in `notes/NOTES_2026-10-20.md` (03:01).

## Re-verified after the fix, with real touches (2026-10-20 10:41 → 11:13)

The same simulator, same beta14 native, this tree at 8c165e5 whose Metro
bundle carries the fix (`locateInWholeView`: the view is fitted to its
document before epub.js's `locationOf` measures the fragment). Each relaunch
was fresh (`-RCT_jsLocation 127.0.0.1:8097`); the first one was probed and
held neither `[DEBUG-307a]` wrapper (`manager.moveTo` unwrapped,
`locationOf` the app's own expand-then-locate). Reading paused at
Utterance 574 (CHAPTER V.), shelf place `CHAPTER V.` — unchanged (same stamp)
after every press below. Artifacts in `/tmp/307-contents-01/reverify/`
(`dl-run*.txt` are the Debug Log after each press; the `[probe]` JSON is in
each).

Every row below was a real touch (`ax.py touch`) on the row brought into the
sheet's visible band (see the new pitfall in [../pitfalls/mcp.md](../pitfalls/mcp.md)):

| check | press | display line | landing (t0 / +2 s) |
| --- | --- | --- | --- |
| 1, first render, 3 fresh relaunches | CHAPTER XXX. 10:50:36, 10:52:20, 10:53:37 | `display section 3 at "1306980130634175271_1342-h-2.htm.xhtml#pgepubid00246" (browse)`, `view 3 appended` each time | **54 / 54** ×3 (`scrollTop` 97383 = `h2TopInDoc`) |
| 1, another file's first render | CHAPTER XL. 10:54:44 | `display section 4 at "…1342-h-3.htm.xhtml#pgepubid00313" (browse)`, `view 4 appended` | **54 / 54** |
| 2, view recreated, twice | "Engaged by the river." CHAPTER XLV. 11:00:06, 11:01:54 → CHAPTER VII. 11:00:54, 11:02:16 | XLV.: `display section 5 at "…1342-h-4.htm.xhtml#pgepubid00364" (browse)`. Each VII.: `views cleared: [5 …]` then `view 1 appended` — h-0 recreated by the press | XLV. **54 / 54**; both VII. **54 / 54** (`scrollTop` 81404 = `h2TopInDoc`) |
| 3, regression, file on the page | CHAPTER V. 11:03:02 | `display section 1 at "…#pgepubid00046" (browse)`, no view append | **54 / 54** |
| 3, regression | CHAPTER XV. 11:03:51 | `display section 2 at "…1342-h-1.htm.xhtml#pgepubid00119" (browse)`, `view 2 appended` | **54 / 54** |
| 3, regression | Chapter I. 11:04:27 | `display section 1 at "…#pgepubid00022" (browse)`, `view 1 appended` | **54 / 54** |
| 5, control (browsing→following) | Cultivation Online "Chapter 2004: Li Jinxi's True Feelings" 11:06:17 | `display section 6 (goToSection)` — **no ` at …`**; `display finished: section 6` | the chapter's heading painted by the page's own follow (pre-existing placement); `say` utterance 133, section 6 |
| 4, following, fresh copy (reinstall, no Reading Position) | CHAPTER XXX. 11:09:03 | `display section 3 at "…#pgepubid00246" (goToSection)`; `contents row 3#pgepubid00246: wait for section 3`; the reading followed to **utterance 1501**, `mark=30:exact:"CHAPTER XXX."` | **26 / 26** — see below; the repeat press (view alive) 11:12:45: **54 / 54**, `contents row 3…: utterance 1501` |

The check-4 first press: the landing scrolled past the heading by 28 px
(`scrollTop` 97411 = `h2TopInDoc` 97383 + 28) and rested there, stable for a
minute — the heading's top 28 px under the bar's 54 px reserve, `h2TopInStage`
26. This is not the fixed race: the pre-fix signature was the scroll stopped
at a short frame's end with the heading 23,430 px low; here `locationOf`'s
value was exact and the +28 px is the reading's own place/anchor step
(`place block=266 settled=266 anchors=12`), which ran once while the fresh
file's layout was still cold and never corrected. The repeat press on the
alive view landed exactly 54/54 with the reading again on the heading's
utterance. Recorded as an open finding for the implementing agent: a first
cold following press can rest the heading 28 px high; the shelf stayed
`place=null` throughout (no Play, no Reading Position written).

## How to measure a landing

1. Real touches through `../kit/ax.py`: `touch Contents` (the player bar's
   button), then the row by its exact label. The sheet is a half-sheet whose
   FlatList only renders nearby rows — see
   [../pitfalls/mcp.md](../pitfalls/mcp.md) ("A virtualized Contents list has
   no off-screen rows", "A swipe that starts above a half-sheet closes it",
   "The Contents sheet's footnote eats the touches of the bottom rows", "A row
   scrolled past the half-sheet's top edge is touched on the reader behind
   it") for how to bring a far row up and where a touch actually lands.
   After `scroll-touch`, find the row again and touch only when its centre
   sits inside the sheet's visible band (y 460–800 on this sheet worked);
   outside it the frame is clipped or under the footnote, and a `touched …`
   line can still mean nothing fired. Confirm every press by the Debug
   Log's display line, never by the touch's own output.
2. Send the probes with the kit's harness: generate per fragment with
   `sed -e 's/__FRAGMENT__/<id>/' contents-landing-probe.js`, then
   `node ../kit/hx.cjs UDID '{}' --code-file <generated>` at about t0 (a few
   seconds after the press, when `display finished` has appeared in the Debug
   Log) and again 2 s later. "Lands" is `h2TopInStage` 54 — the bar's reserved
   space, read back as `barCss` `height: 54px` — at both.
3. After the press, `{"do":"say"}` (the reading's Utterance and the marked
   row) and `{"do":"shelf"}` (the stored place).

## What held on beta14 (browsing, paused, with the reading on a sentence)

With the reading seeked to Utterance 398 of Chapter I, every row press moved
only the page: the display line carried `#<fragment>` with mode **browse**,
the reading stayed at 398, the mark stayed `1:exact:"Chapter I."` and the
shelf's stored place stayed null:

| row | spine | mode | landing (t0 / +2 s) |
| --- | --- | --- | --- |
| CHAPTER V. `#pgepubid00046` | 1 | browse | 54 / 54 |
| CHAPTER XV. `#pgepubid00119` | 2, view created by the press | browse | 54 / 54 |
| CHAPTER XXX. `#pgepubid00246` | 3, file's first render | browse | **23 484 / 23 484** — see below |
| CHAPTER XXX. again | 3, view alive | browse | 54 / 54 |
| “On looking up.” CHAPTER XXXIII. `#pgepubid00265` | 4, view created by the press | browse | 54 / 54 / 54 (t0, +2 s, +8 s) |
| “Engaged by the river.” CHAPTER XLV. `#pgepubid00364` | 5, file's first render | browse | 54 / 54 / 54 |
| A note for Miss Bennet. CHAPTER VII. `#pgepubid00062` | 1, view recreated | browse | **947 / 947** — see below |
| CHAPTER VII. again | 1, view alive | browse | 54 / 54 |
| Chapter I. `#pgepubid00022` (fragment at its file's top) | 1 | browse | 54 / 54 |

The control: Cultivation Online 2001-2044, whose chapters each have a file. A
real touch on "Chapter 2004: Li Jinxi's True Feelings" asked for
`display section 6 (goToSection)` — **no ` at …`** — and the reading followed
to the chapter's first Utterance 210 (`contents row 6: wait for section 6`,
then utterance=210, mark `5:exact:"Chapter 2004…"`); the heading is painted
mid-screen by the page's own follow of the reading, which is the pre-existing
place placement, not a fragment landing (`top-of-section-probe.js`).

## What failed: the first landing on a file whose images are still decoding

Two of the eight first presses rested far off, stable (measured twice 2 s
apart and again minutes later — the page never re-placed):

- CHAPTER XXX. (spine 3), the file's first-ever render: the heading measured
  `h2TopInStage` 23 484. `scrollTop` 73 953 equals the heading's
  `h2TopInDoc` before the press's layout settled — epub.js computed
  `locationOf` before the 24 images above the heading had laid out, scrolled
  there, and the images then grew the content by 23 430 px
  (`scrollHeight` 262 817 on the wrong landing against 119 833 once settled).
- CHAPTER VII. (spine 1), the view recreated: 947 — the same race, 893 px of
  late growth, the heading pushed just below the fold.

Every press whose file had already been laid out once (its images sized —
including CHAPTER XV., whose view the press created, and CHAPTER XXXIII./XLV.,
prepared offscreen beforehand) landed at exactly 54, and the re-press of both
failed rows (view alive) landed at exactly 54. The same real-touch gesture
passed six times and failed twice, so the gesture is not the difference; the
log line is identical (`display section N at "…#<fragment>" (browse)`) either
way. This is the risk #307's plan named — "epub.js measures the element right
after the view displays. An image or font above the heading that changes
height after that would leave the heading lower or higher than the top" —
realized: the fix's one-shot `display` does not re-place the fragment once
layout settles, and the page program has no re-place step. Found as an open
finding for the implementing agent; `scroll-watch-arm.js` /
`scroll-watch-read.js` were built to separate epub.js's own scrolls from the
app's and are what a re-place step would be measured with.

## A fresh, unread copy (no Reading Position yet)

Uninstall, reinstall the built `.app`, re-add the same file (the add answered
the same Document Id `sha256:173688ad…`), open, `say` reads `utterance=null`
and `mark=0:shared:"PRIDE. and PREJUDICE"`. A real touch on "CHAPTER V."
(runs at 09:58:54 and again at 10:01:14 after a relaunch) gave:

- `the app asks epub.js to display section 1 at "1306980130634175271_1342-h-0.htm.xhtml#pgepubid00046" (goToSection)`
- `[reading] contents row 1#pgepubid00046: utterance 574` — the reading
  follows to the heading's own Utterance (574 is `CHAPTER V.` in the
  Utterance list)
- landing 54 / 54, `say` `utterance=574`, `mark=5:exact:"CHAPTER V."`.

Play with the fake Provider, all in one chain
(`silence.sh check && hx '{"do":"play"}'`; the check caught a volume reset to
60 five minutes after its `set` once — `set`, relaunch, press the row again,
then play): the first-Play Consent alert named exactly
`Send text to the server at 127.0.0.1:8799?` and was answered Allow by a real
touch on its button. `[reading] play at utterance 574, local af_bella`; the
first synthesis request after the Allow was `10 chars "CHAPTER V."` (the
fake's log line 3), the read-ahead's second. Paused at the first cue that
shows the reading on the heading (`[hx] playing=true … utterance=574`, 34 ms
after the Allow): the hold landed at utterance 574 word 0. Duration: 1.0 s
from the Allow to the pause, of which about 0.4 s of clip (the volume was 0);
stopped because the fact — Play reads from the row's heading — was established
by the first synthesis request and the hold.

## What this recipe cannot prove

- The race needs a file whose images are still decoding at `locationOf`; a
  book of plain text (or a second run with everything cached) will not show
  it. The failing rows' drift was stable once wrong, so a screenshot at a
  settled moment is enough to catch it. The first-render path was re-run
  three times on fresh relaunches at 8c165e5 and held (54/54 each); a PASS
  on a cached file alone still does not clear it.
- `scroll-watch-arm.js` hears only calls through `manager.scrollTo`; the
  record alone does not say who moved the page when the record is empty.
- The Utterance numbers (398, 574, 210) are this build's segmentation of
  these two files; a renumbering moves them (`entry-place.cjs` reads the
  stored place, not the index).
