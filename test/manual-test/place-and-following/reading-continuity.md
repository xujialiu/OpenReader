# Reading continuity while browsing: empty sections, ends, and preparation (#153, #161, #170, #156)

Verified 2026-10-13 on `openreader-continuity` (3FA96AD7-957F-4DEB-B186-DA0709922173,
iOS 27.0), tree `xujialiu/fix--ios-continuity` at c8533af (app 1.0.0 (8)-beta9-debug,
Settings screenshot `settings-version.png`), Metro 8091 from this worktree, the
fake Kokoro provider (`../player-and-reading-held/fake-kokoro.cjs`, PID 71139,
2.5 s clips) at 127.0.0.1:8791, and a Debug build from this tree
(`/tmp/openreader-continuity-dd`). The fixture is
`../fixtures/continuity-fixture.ts`: an empty first spine item, four text
chapters whose every sentence names itself, and an empty last spine item.

Commands below send harness commands with `../kit/hx.cjs` (handler probes, not
touches), read the Debug Log at
`$DATA/Library/Application Support/debug-log/`, and take real touches through
`../library-and-reader/ReaderTouchProbe.swift`'s `testTouchPoint`.
`continuity-page-state.js` (this folder) asks the reader's page for its views,
offscreen preparation hosts, iframes and lit highlights;
`continuity-arm-stalled-view.js` / `continuity-disarm-stalled-view.js` replace
and restore the manager's View constructor from a page probe. Page probes run
in the reader's WebView (the harness `js` command), so a leaked host or a live
highlight is read from the same DOM the reader paints.

## What was measured (and what each fact came from)

- **Empty first section does not block Play (#161).** From seek 0 with the
  empty cover reported, Play cued "The First Chapter" and the chapter's
  sentences; the fake provider's log shows the fetches (04:39:29–04:39:45Z) and
  the Debug Log the cues. The reading then walked every fixture boundary in
  order to the end.
- **A late empty trailing section ends the Reading (#170).** The fixture run
  ended on its own at 12:41:04: the exhaustion snapshot reads
  `views [2 not displayed, 3 displayed, 4 displayed, 5 displayed 54px]` — the
  empty last section reported through the visible run — and the note is
  "That was the last of this document. The reading has stopped at the end of
  the book.", `playing=false`.
- **Play after the end stays stopped (#156).** Handler `play` (12:43:53) and a
  real touch on the player's Play (`testTouchPoint`, `Executed 1 test, with 0
  failures`, 12:44:53) both re-report exhaustion within 3 ms and leave the end
  note with `playing=false`; the provider log gains no request. Leaving to the
  Library afterwards shows no playing Reading (`navstate` routes, shelf line,
  `library-after-end.png`).
- **Sequential speech across boundaries while browsing far ahead and behind
  (#153).** On Reverend Insanity 1-250 (254 spine items): play from the start,
  nine seconds in browse to section 40 (`{"do":"section","section":40}` —
  handler probe). `known` jumped 267→503 (sections 39–41 reported) while the
  voice walked 6→14→15… in order; the page stayed on the browsed chapters
  (`browse40-voice-section2.png`, player badge "M"), the engine fenced at the
  first unknown gap — `renderAhead: offscreen sections 3 asked for, the voice
  is in section 2` — and section 3 reported 0.6 s later through the offscreen
  view. No fetch carries browsed-chapter body text: the only "Chapter 38/40/41"
  lines in the provider log are the ToC rows of section 2. Browsing backward
  mid-play to section 0 behaves the same: the voice walked 45→46 across the
  boundary with the page parked on section 0 (`renderAhead: offscreen sections
  47 asked for, the voice is in section 46`), no restart at 0.
- **A section crossed away from the screen (#112 regression).**
  `background-crossing.sh` on the real book: GREEN — the voice entered section
  203 at 13:35:49 with the app background, and section 204 rendered 0.2 s later,
  still in the background (`view 203 displayed in 15 ms`, `view 204 displayed in
  30 ms`, `renderAhead: section 204 done in 139 ms`; `bg-window.txt`).
- **Preparation deadlines and Play retry.** With the page Browsing at section 0
  and the voice at a fence (202|203), the reading first says it is waiting
  (13:30:01), then the **native** 15-second deadline stops it honestly:
  "The next section could not be prepared: Preparing the next section timed
  out. Press Play to try again." (13:30:15, `playing=false`). Pressing Play at
  the fence re-arms, waits and stops again with the same note (13:31:05 →
  13:31:20): **the retry cannot prepare the section while the page is Browsing
  — see the finding below.** Play recovers by itself only while buffered text
  is still speaking: at 13:17:12 the resume re-followed the page, the visible
  display rendered the missing sections (46–48), and the voice continued into
  47.

## Finding for the implementing agent (reproduces on c8533af, real WebKit)

`renderAhead`'s offscreen preparation never cleans up after itself, and its
serialized chain jams on its first use. `prepareSection`'s `finish()` calls
`manager.views.destroy(view)`; in this epub.js build `Views.destroy` runs
`container.removeChild(view.element)`, which throws
`NotFoundError: The object can not be found here.` because the temporary view's
element is a child of the preparation's own host div, never of the manager's
container. `finish()` has no guard around the call and does the `destroy`
before `resolve()`/`reject()` and `host.remove()`, so:

- the host div leaks and the preparation's promise never settles (probed
  directly: one `left:-200vw` host with an emptied `epub-view` div persisted
  from 12:48:07 to 13:32:43, through both deadlines);
- the `preparation` chain is stuck on that first link: every later offscreen
  preparation — including the exhaustion-driven `prepare` message — is queued
  behind it and never runs (its 15-second timer lives inside the executor that
  never executes), with no log line and no text-error;
- at a fence while Browsing the reading therefore always ends at the native
  deadline's honest stop, and Play can never prepare the missing section again;
  recovery needs the visible path (a Play that still has buffered text and
  re-follows, or the owner scrolling/navigating to the text, or leaving the
  reader — a fresh page starts clean: `hosts: []` on the reopened reader).

Reproduction: open a long book, play, browse far ahead mid-play (handler probe
is enough), let the voice reach the first unknown section; watch the Debug Log
for the waiting note then the timeout note, press Play, and watch the same
timeout note return 15 s later; probe `continuity-page-state.js` for the leaked
host. Page timers were verified live (a 2 s probe timer fires), so the missed
deadlines are not throttling.

## What these runs cannot prove

- The owner's iPhone: real background suspension (the simulator only hides the
  page), a locked screen, and audio actually audible (clips were silent PCM at
  volume 0, per the kit rules).
- Word-timing drift over a long run; the longest single run here is the
  fixture's 95 s end-to-end walk.
- Whether the #112 lock-screen behaviour holds: the crossing here was
  app-background (Preferences in front), not a lock.
- The stub probes (`continuity-arm-stalled-view.js`) were armed and disarmed
  but never used against a playing Reading: `createView` reads `this.View` at
  call time, so a stalled stub view would jam the visible manager queue as
  well; arming during playback was judged too destructive for a verification
  run.
