# The reader fixes #96/#195/#196 (1.0.0 (9)-beta7) on the simulator (2026-10-18)

Revision `bb43c22` (scope `0665d55..bb43c22`), Settings showing **Version
1.0.0 (9)-beta7-debug** on the device. Simulator `openreader-fix3-ioscheck`
(iPhone 17 Pro, iOS 27.0, UDID `D066DF98-E7A9-4AE4-AB0A-898900AE4AD9`), Metro
8085 from this worktree, the controlled Provider pointed at
`provider-fault-server.cjs` on 127.0.0.1:8811 (speech `ok-pcm`, fixture
voices, no cloud or paid call), sync against `cacheable-dav.cjs` on 127.0.0.1:8790
with `OPENREADER_FIX2_DAV_STATE=/tmp/fix3-ioscheck-01/davstate`. Book: the
owner's `Shadow Slave 1-250.epub` (256 spine items); `Pride and Prejudice.epub`
for the never-played check. Consent for 127.0.0.1:8811 asked on the first Play
and answered through `ax.py alert` after verifying the recipient; the
simulator's own volume was set and checked in the same breath as every play —
the check caught it back at 60 **four times** in the hour, each time before
the touch, so no chain ever played unsilenced. Playback windows: 5–14 s, each
sized to the fact it establishes (sentence advance, a stall hold, a
chapter-crossing), stopped right after.

Every persisted-position claim was read from the app container's
`Documents/library.json` with [`entry-place.cjs`](entry-place.cjs) — the file
`writeLibrary` writes — before and after each step; every synthesis claim is
backed by the fault server's own journal (`/__log`), and cursor claims by the
harness status line. Real touches: the paused word taps, the Sync screen
typing/switch, and the M button; harness commands are labelled handler probes.

## #96 — only speech writes the Reading Position

Baseline: a 5 s Play with real synthesis (24 KB PCM per sentence in the
server journal) advanced and saved "A measure of power…", stamp
`{at: 1792264256592, device: iPhone-bundvora}`.

- **Paused real touch on "seven" (There are seven Soul Ranks:)** — cursor
  moved to utterance 56, chapter Terminology; library.json unchanged (same
  anchor, same stamp); after leave and reopen the highlight was back on the
  stored sentence (screenshot) and the resume note read "the sentence the
  reading stopped on". The tap never became a position.
- **All four skips, paused** (`next-sentence`, `next-paragraph`,
  `previous-sentence`, `previous-paragraph` as handler probes): cursor
  54→55→56→55→54, file byte-identical. **A Contents row while paused**
  (`{"do":"section","section":5}`) browsed the page (rendered 4/256) and left
  the reading and the file untouched.
- **A stalled Play saves no unheard text.** Two invalid attempts first, kept
  for the record: with `speech=stall` the play still advanced because the
  first full pass had **cached this chapter's clips** — playback from cache is
  real speech, not a stall — and the pause rightly saved the sentence speech
  reached ("Beast"). The valid run used the recipe's fresh-voice trick
  (`fixture-willow-s4`, an unlisted id the paused `chooseVoice` accepts, whose
  cache is empty): the server journalled the held requests
  (`SPEECH body: … "❖ Aspect Ability"` under the s4 voice, stall slices,
  nothing completed), the status stuck at utterance 95 with `level=null`, and
  the pause left the file exactly at "Beast" with its original stamp — 22
  utterances behind the cursor.
- **Play from the selected cursor saves and advances**: from the stored
  sentence, 7 s of real synthesis (76 speech POSTs by then) and a pause wrote
  the reached sentence ("Unlike humans…") with a fresh stamp.
- **Never-played tap/leave writes nothing**: Pride and Prejudice, opened
  fresh, a real touch moved the cursor to utterance 1, no play, leave —
  `position: null` still.
- **Remote adoption retains the original Stamp; the format is unchanged.**
  Sync on against the stub (password typed per character on the Sync screen —
  13 dots read back for 13 characters; the stub's log shows the Basic auth and
  the app's first PUT, 314 bytes, "Synced at" on screen). The host served a
  remote place for the same Document under device `fix3-desktop`, stamp
  `1792265029558`; the next `open` sync log said `1 places taken`, the reading
  resumed at the remote sentence, and library.json held **exactly the remote
  stamp** — both `position.stamp` and the entry stamp — with no local re-stamp.
  The stub's newest PUT is schema-identical to the pre-fix upload (`format`,
  `version: 1`, item keys `anchor/format/id/locator/publicationId/stamp`,
  anchor `exact/prefix/suffix`, stamp `at/device`).

## #195 — every cue after a restart waits for the current page

The corrected scenario (an ordinary recovery plus a skip inside the reported
chapter does not exercise this): with the reading cued at "Unlike humans…"
(section 2) and the page browsing sections 119 and 139 (their Blocks reported
on the **old** page), `kill -9` on this simulator's own WebContent process
(16021, under launchd_sim 27056 — identified by its start time matching the
page's `born`, after a first awk picked a stale PID and killed nothing):

- The new page opened at the **reading's** CFI
  (`the page opens again at "epubcfi(/6/6!/4/2/74)"`), displayed section 2,
  and the initial repaint painted the cue (`lit:
  2:openreader-utterance:Unlike humans…`). The pre-kill browsing target was
  retained only from the old page — never restored.
- **An unreported retained section, explicitly targeted**: `seek 600` (a
  sentence of the old page's section 139, unreported on the new page) logged
  `the app asks epub.js to display "epubcfi(/6/280!/4/2/24)" (the new page has
  not reported the reading's section)`, the page displayed 139, reported it,
  and painted "The castle receptionist flinched…" — `note=null` throughout,
  no "The highlight could not be drawn".
- **Latest target wins**: `seek 450` then `seek 470` 0.77 s apart (one display
  request for section 119); the painted sentence is 470's ("Sunny had never
  expected to find a human"). A first attempt sent both seeks back-to-back and
  only the second ran — the harness's own ≥300 ms rule; redone properly.
- **Browsing is not stolen (playing)**: playing while browsed to section 160,
  the page stayed on 159/160 with no highlight while the reading moved on;
  the only display request since the browse was the browse itself. The M
  button ("Return to the reading", a real touch) brought the page back to the
  reading and painted it.
- **Not covered on device**: hold(stop) deferred across an await while
  browsing (the reading finished its reported text before the crossing could
  be staged; the host suite's reader-bridge-restart tests hold this path).

## #196 — a boundary page that rests

`following: continuous`, Line Position 50, the kit's new
[`scrollby-probe.js`](scrollby-probe.js) wrapped on the drift's own
`rendition.manager.scrollBy` with a per-frame scrollTop sampler:

- **The true bottom**: playing the last chapter to the end-of-book stop
  (14 s: 304 scrollBy calls, 15,006 px requested, 8,661 px moved, 56 failed
  down-calls once `atBottom`) — then, **26 s after the last cue settled, a
  9 s window at the pinned bottom: `scrollByCalls: 0, pxRequested: 0,
  pxActuallyMoved: 0, failedCalls: 0`, 0 of 557 sampled frames moved,
  `atBottom: true`, scrollTop frozen at 12548**. The paused boundary page
  requests no ongoing drift or scroll work — the requested outcome, not a low
  rate while playing.
- **Reachable control**: the same session's play through the front matter
  moved 1,581 px on 233 sparse calls with no boundary failures — normal drift.
- **Wake**: from the pinned bottom, a seek glided the page to the new target
  (744 px requested, 469 moved within 326 ms) — a new target wakes the page.
- **The top boundary is not constructible in this book**: the tall cover
  gives the first text line hundreds of pixels of scroll slack, so the reveal
  always places the line at the Line Position with room below — the drift
  never faces an upward-pinned edge here (`seek 0` + play moved down
  normally). The upward direction stays covered by the host
  `continuous-boundary-rest` test, which builds the geometry; on device the
  downward direction and the paused rest are measured.

## What else was learned

- `rendered=` in the harness status line reports the last epub.js `display()`
  index, not the visible scroll: after browsing to section 255 and then
  seeking back into already-rendered sections, it read `254/256` while the
  page correctly showed section 2 with the right highlight (page probe).
  Pre-existing status-line semantics, noted for the next person it confuses.
- The sim volume returned to 60 four times in one hour on this fresh device
  with no boot and no app relaunch — the #390 pattern, faster. Every play's
  `silence.sh check` in the same `&&` chain is what kept each one honest; one
  chain's Play was skipped by a caught reset and simply re-run after `set`.
- Finding the reader's WebContent process by the first `launchd_sim` awk match
  can match a transient PID and kill nothing; match the full device path in
  `launchd_bootstrap.plist` and confirm the candidate's start time against the
  page's `born` (pitfalls/simulators.md).
