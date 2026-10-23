# Recheck without downloading again (#321, #322)

Use a session-owned simulator and the shared `kit/ios-verification.md` lane.
Never stage this data on the owner's phone. Use the kit's fake speech server;
no real Provider or credentials are needed. The host seam is
`npx vitest run test/offline/runtime-segmentation.test.ts test/offline/recheck-catalog.test.ts test/offline/rechecks.test.ts`.

## Staging

Use `fixtures/segmentation-fixture.ts` and the seeding/Provider setup from
`sentence-boundaries-batch.md`, or a real-book copy for responsiveness. Before
changing a catalogue, terminate only the session-owned app and use SQLite
transactions; never replace its database files while its connection is open.
Preserve a complete backup of test data for each scenario.

Stage two chapters with real playable saved Clips: one whose Utterance text is
unchanged, and one whose old joined sentence becomes two under current rules.
The latter can be `这是第一句。2024年发生了很多事。` from the host test.
Keep task ownership, Voice, Model, payload sizes and membership keys consistent.
Use the same free-model identity as `narration-voice.ts`, not the display label.
For schema-2 repair, remove the `recheck` column from a disposable fixture,
set `user_version=2`, and put the formerly prepared chapters at `prepared=0`
with their old nonempty texts, memberships and audio intact. For the later
revision-change case leave preparation intact and record older revision values.

## Required observations

1. **Launch and checks.** Startup's `[offline]` summary records complete old
   audio and chapters awaiting Recheck together. Download and Contents agree
   about the selected Voice. The unchanged chapter stays checked. No new
   Download or Live Activity is started merely to check it.
2. **Changed sentence.** The changed chapter becomes partly saved with a
   selectable circle. Its remaining Clips and count stay visible in Manage.
   `recheck_holds` names that Voice/chapter; ordinary Resume all, reconnect and
   a relaunch do not request its missing sentences. Compare the fake server's
   request journal against a snapshot taken immediately before each operation.
3. **Explicit repair.** A real touch of Download selected for that chapter
   fetches only missing current Speech Text. Its Voice/Model and trigger are
   present in `[download]`. Check the result on screen and in the catalogue.
4. **Lifecycle and priority.** Start a longer Recheck, leave the app, and verify
   `[app] background` plus the withdrawn request. Returning resumes. Start a
   normal Download while a Recheck is pending: it owns the renderer first,
   and the old token cannot overwrite its answer. Partial unfinished Downloads
   may continue their already requested work; do not mistake that for a
   Recheck spending permission.
5. **Diagnostics.** Write a Debug Note in the Reader and find its correlated
   `[offline] snapshot, Debug Note <time>` including the selected Voice. Compare
   a quiescent catalogue summary using `kit/offline-catalog.py --local DB OUT`
   with the app's per-Voice summary. The metadata summary is not a file audit.
6. **Reading cost.** Establish playable control audio before timing. Silence
   and check the simulator in the same command as Play. Bound a measurement to
   enough Rechecked sections to observe interference, keep a no-Recheck control,
   and stop immediately afterward. Read frame gaps, playback/renderer callback
   continuity and runtime latency separately; a counter that says playing is
   not proof of uninterrupted output. If interference is demonstrated, return
   FAIL for the parent to apply the agreed pause-while-reading fallback.

Return raw logs and screenshots, precise commands, failed attempts, and the
limits of the measurement. Simulator timing does not establish performance on
the owner's physical iPhone. Leave playback stopped and the final app open.

## Verifying #321/#322 (1.0.1 (14)-beta11-debug) (2026-10-24)

Session-owned `iPhone 17 r321` (iOS 26.5, `85DF490D-2213-41FE-9EEA-7851B66357B6`),
guarded prebuild + `xcodebuild RCT_METRO_PORT=8141`, Metro 8141 from the parent
worktree (same frozen commit), `fake-kokoro-two-voices.cjs` on 8895, Consent
answered once after the alert's recipient was checked against the fake's
address. Fixtures: seg-zh/seg-en-negs/seg-ellipsis, plus real-book copies
(Pride and Prejudice, an MVS part). Artifacts: `/tmp/or321-ios-01/` (journal
snapshots, catalogue backups per scenario, screenshots, videos, frame-gap
analyses). Staging: SQLite only, app terminated, one transaction per scenario —
`recheck-stage-321.cjs` above is the working driver.

- **Schema-2 restore (S1).** `DROP COLUMN recheck`, `user_version=2`,
  `prepared=0`, empty `prepared_sections` on a real downloaded catalogue. The
  next launch restored once (`user_version=3`, `prepared=1 recheck=1`, sections
  back in `prepared_sections`), the launch summary read "1 Downloaded, 1
  awaiting Recheck", both Rechecks finished, and the fake's journal gained zero
  lines. Terminated read after: `recheck=0` everywhere, holds empty.
- **Revision change (S2).** With seg-zh's af_bella chapter rewritten to the old
  cut (`这是第一句。2024年发生了很多事。` joined; audio cloned from an existing
  clip; af_nova left at the current cut) and `walk` rewound with `segmentation`
  deleted, the launch wrote `[offline] preparation revisions walk 1→2,
  segmentation null→1; pending Recheck, checks retained`, the Recheck wrote
  `[offline] Recheck c4291886 nav.0 local "af_bella": 1 / 5; needs Download
  selected, Resume all cannot fetch it`, and the journal delta was zero.
  af_nova stayed Downloaded — per-Voice isolation on screen: the same chapter
  `0 chapters downloaded` with a selectable `1 / 5` circle in Bella, `1 chapter
  downloaded` with a ✓ in Nova. Manage kept Bella's 3 remaining clips (2
  unmatched) beside Nova's 5. en-negs (unchanged text) kept its check through
  the same update.
- **Durable holds.** Resume all (real touch, its own `[download] resumed … from
  Resume all` line) fetched exactly the paused task's own missing sentence and
  nothing for the held hole; a terminate+relaunch reloaded `recheckHeld:
  ["nav.0"]` with zero requests. Reconnect is host-only (`mock.connectivity`),
  and a held chapter never presents a ring (it is a plain selectable row), so
  ring/Resume-all denial on device reduces to the UI shape plus the host tests.
- **Explicit repair.** Real touches Select all → Download selected (1):
  exactly the 4 missing current texts in the journal, `[download] added to …
  from Download selected (1 chosen)`, hold cleared, row `downloaded`, Contents
  ✓. Nothing else — no heading, no old joined text, no other document.
- **Background and priority.** `Recheck b4f3e737 section 0 interrupted` at
  `[app] app background`, resumed on return (29.6 s wall, includes the
  backgrounded wait; zero requests). An enqueue landed inside PP's active
  Recheck: `[download] started` at 03:13:37.953, `Recheck 173688ad section 1
  interrupted` at 37.967, `prepared … in 434 ms`, the Recheck resumed and
  finished, and the journal gained exactly the new download's 3 texts.
- **Debug Note and the kit.** A Reader Debug Note was followed by `[offline]
  snapshot, Debug Note <time>: c4291886 "seg-zh" local "af_nova" …` with
  per-Voice summaries and tasks beside the unchanged `[renderer] snapshot`
  line. `offline-catalog.py --local` on the terminated catalogue matched the
  app's summaries number for number, including the 2 unmatched orphan clips.
- **Reading beside a Recheck.** A 10 s Reading (real-book copy, saved clips,
  volume 0 set and checked in the same command chain) ran with ~5 s fully
  inside an active Recheck (PP 7 sections + an MVS part's 6 sections). Sentence
  cues stayed at 1.77–1.84 s (control 1.4–1.8 s), the engine held one graph
  with no stop, and the journal delta was zero. Frame gaps
  (`kit/frame-gaps.py` under a venv with `opencv-python-headless`): median
  16.7 ms and p95 33–35 ms in both runs; the recheck run had 13 gaps >50 ms
  (max 368 ms) against the control's 4 (max 375 ms, its own first paint) —
  a few 100–200 ms highlight repaint hitches during section renders, no cue or
  engine disturbance. Coexistence held; whether a person hears or feels
  anything is not establishable at sim_volume 0, and none of this measures a
  physical iPhone.
- **Staging gotchas.** Writing the staging SQL from a bash heredoc keeps `\"`
  literally in the value — the two staged clips' metadata JSON was corrupt and
  the app answered `downloadError: JSON Parse error` with the document's
  progress reads refused until the rows were repaired; write the SQL from a
  script (`recheck-stage-321.cjs`) or double the quotes. Membership is shared
  across Voices, so old-cut staging shifts every Voice's completeness — stage
  one Voice's audio and leave the other at the current cut deliberately.
  Opening a Reader clears `recheck=1` on the sections its renderAhead
  prepares, shrinking a staged Recheck list; stage big Documents the reader
  will not open, and put them last in the Library order for a long window.
  After a relaunch the Reading is held but the Reader screen is not restored:
  `reading.cjs` evals fail until the harness `open` re-mounts it, and the held
  place re-applies on the mount (a `seek` sent before the mount is a no-op).
