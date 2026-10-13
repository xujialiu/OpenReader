# Reading continuity while browsing: empty sections, ends, and preparation (#153, #161, #170, #156)

Current for **1.0.0 (8)-beta11** (889da33, the offscreen-release fix ff6b35e).
Verified on `openreader-continuity` (3FA96AD7-957F-4DEB-B186-DA0709922173,
iOS 27.0), Metro from this worktree, the fake Kokoro provider
(`../player-and-reading-held/fake-kokoro.cjs`, 2.5 s silent clips) at
127.0.0.1:8791 with its Consent granted, and a Debug build of this tree. The
fixtures are `../fixtures/continuity-fixture.ts` (empty first + empty last),
`../fixtures/continuity-empty-prefix-fixture.ts` (all-empty reported prefix at
open) and `../fixtures/continuity-empty-gap-fixture.ts` (tall blanks that hold
an all-empty prefix with a real gap). Dated measurements and chronologies are
in `notes/NOTES_2026-10-13.md`; this file states what holds.

Commands send harness commands with `../kit/hx.cjs` (handler probes, not
touches), read the Debug Log under
`$DATA/Library/Application Support/debug-log/`, and take real touches through
`../library-and-reader/ReaderTouchProbe.swift`'s `testTouchPoint` (Play after
the end; the player's Following badge) and `../lock-screen/LockScreenProbe.swift`
(the lock-screen card). `continuity-page-state.js` (this folder) asks the
reader's page for its views, offscreen preparation hosts, iframes and lit
highlights; `continuity-arm-stalled-view.js` /
`continuity-disarm-stalled-view.js` stall and release the manager's View
constructor from a page probe, which turns the next offscreen preparation into
a deadline test without touching app source.

## What holds on beta11

- **Successive offscreen preparations work in one uninterrupted page, with
  Browsing far ahead and far behind.** On Reverend Insanity 1-250: play, browse
  to section 40, and the reading fences at the first unknown section and
  prepares it offscreen; browse back to section 0 and the next unknown section
  is prepared the same way. Sections 206 and 207 were both prepared this way in
  one page session, each reported, the voice crossed into the prepared 206, and
  every page probe read `hosts: []`; cues ran without a skip or repeat.
- **A stalled preparation is bounded, cleans up, and Play recovers through the
  offscreen path.** With the View constructor stalled from a page probe, the
  next preparation's 15-second deadline stops the reading honestly
  ("The next section could not be prepared: Error: Preparing the next section
  timed out. Press Play to try again."), the host is removed (`hosts: []`
  immediately after), and after releasing the stall a press of Play re-prepares
  the same section offscreen (`renderAhead: offscreen sections 208 asked for…`
  in the same instant as the press), reports it, clears the note and carries
  the speech on. Without the stall the same machinery crosses boundaries in the
  background: `background-crossing.sh` is GREEN on this tree (the voice entered
  the next section away from the screen and the one after rendered 0.2 s later,
  still away). Note `AWAY` must cover `OFFSET × clip seconds × rate`: with
  2.5 s clips at rate 1.5, `OFFSET=58` needs `AWAY≥120`; the script's own
  default pairing assumes 0.2 s clips.
- **#161: the defining trigger — an all-empty reported prefix, an unknown gap, and a KNOWN EMPTY section beyond it — does not block Play.** In
  `An Empty Order Check of Play` (sections 0–5 blank and tall, 5 several
  screens so displaying it does not render 6; text at 6–7), a fresh open
  reports 0–1 (all empty, `known=0`); a browse to The End reports 5 and then 4
  (both empty) out of order — `known` stays 0 with 5 known while 2–3 are
  unknown. Play skips the known empty 5, obtains 6, and starts reading at the
  first text (the provider's first request is "The First Chapter"). The
  simpler all-empty-prefix state (no out-of-order reports) is covered by
  `An Empty Gap Check of Play`.
- **#170: the last empty section's first report may arrive after the
  exhaustion, and the reading still ends honestly.** With the last empty
  section held unreported (the stalled-view probe, labelled as induced), the
  engine exhausts at the last text section's end with the waiting note; when
  the preparation is released, the section reports empty and the reading stops
  with "That was the last of this document…". Without the stall the section is
  prepared during the last text section and the end is direct.
- **#156: Play after the end stays stopped — Player and lock screen.** A
  handler `play`, a real press on the player's Play, and a real press on the
  lock-screen card's centre button all leave the reading stopped with
  "That was the last of this document…" and no synthesis request. On beta12
  (`engine.play` runs the exhaustion check before resuming audio and returns
  without a graph resume; the hook restates the card through
  `restateNowPlaying()`), the lock-screen press (the dedicated
  `LockScreenProbe.testPlayAtEndStaysStopped` — not `--mode tap`, whose
  transport expectation assumes playback starts) is answered by
  `remote command=play` → `play.request`/`pause.request` in the same
  millisecond with **no graph resume and no native engine start**, zero
  synthesis, the card back to "Play" at 1 s and 2 s, and the end note
  retained. On beta11 the graph did resume until an external pause landed
  (the raw issue, superseded); an ordinary mid-document Play still resumes the
  graph and streams normally.
- **Return to Following is accurate.** From a browsing page, a real touch on
  the player's Following badge displays the reading's place with the exact
  sentence and word painted (page probe `lit`).

## Superseded beta9 record (c8533af)

The beta9 run found that `prepareSection`'s `finish` stranded the preparation
chain: `Views.destroy` removed from the visible container and threw
`NotFoundError` for the private-host view, so the host leaked, later
preparations were silently swallowed, and Play at a fence could only recover
through a re-follow display. That was real on c8533af (raw chronology in
`notes/NOTES_2026-10-13.md`, 13:04–13:32 entries, probe at 13:12:43) and is
**fixed by ff6b35e**; the retest above is the current record. The beta9 runs'
other facts (empty-prefix Play, the honest end, Play-after-end, the browse
fence) were re-verified on beta11 and stand.

## What this recipe cannot prove

- The owner's iPhone: real background suspension, a locked device, audible
  audio (clips are silent PCM at volume 0), and word-timing drift over long
  runs.
- The out-of-order-before-Play flavour of #161 as a stable state: a Document's
  place persists across reopens and the resume display always reports its
  neighbourhood, so the all-empty-prefix-with-gap state exists only on a
  Document's first open (which the gap fixture covers). Recreating it after a
  Play would need destructive Library surgery.
- The lock-screen card's "Pause" label on Play-at-end does not occur on
  beta12 (the card stays "Play"); on beta11 the graph resumed until an
  external pause landed — the raw issue is retained in
  `lockscreen-playend2` and `notes/NOTES_2026-10-13.md` as the superseded
  record.
