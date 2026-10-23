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

## Device staging method and limits (from the 2026-10-24 run)

Measured results, timestamps and the matched-passage playback comparison live
in `notes/NOTES_2026-10-24.md`; this recipe keeps only what a rerun needs.

- Session-owned simulator on the stable runtime; guarded build phase with
  `RCT_METRO_PORT` baked in; `fake-kokoro-two-voices.cjs` as the Provider;
  Consent answered once after the alert's recipient is checked.
- Fixtures via `segmentation-fixture.ts` plus real-book copies for reading
  cost. Stage with the app terminated, one transaction per scenario:
  `recheck-stage-321.cjs` (S1 schema-2 restore = `DROP COLUMN recheck`,
  `user_version=2`, `prepared=0`, empty `prepared_sections`; S2 old cut =
  rewrite texts/memberships, clone the old texts' audio, drop the Voice's
  current-cut rows, rewind the revision rows). Snapshot the fake's journal
  before every operation; the Recheck and its holds must add zero lines.
- Per-Voice isolation: stage one Voice's audio and leave the other at the
  current cut; the same chapter then shows partial in one Voice and Downloaded
  in the other.
- Lifecycle: catch a pending Recheck from the log's own `started` lines;
  background via a Safari `openurl`, return via `simctl launch`; a Download
  enqueued mid-Recheck must write `Recheck … interrupted` and then finish.
- Reading cost: matched pairs, not unrelated passages — same document, same
  fixed utterance anchor (rewind with `seek` and verify it from the status
  line), same window, same procedure, counterbalanced order; run
  `cdp-rtt.cjs SECONDS 250` beside each play and quote the Recheck overlap from
  the event timestamps. `frame-gaps.py` measures gaps between CHANGED frames
  inside motion episodes — it is not a refresh-rate or audio measure; compare
  only matched windows. Audio continuity is not measurable at sim_volume 0;
  cue cadence, engine events and the debugger round-trip are the continuity
  evidence, and none of it establishes a physical iPhone.
- Staging gotchas: writing the staging SQL from a bash heredoc keeps `\"`
  literally in the value and corrupts JSON columns (use the script); after a
  relaunch the Reading is held but the Reader screen is not restored
  (`reading.cjs` evals fail until the harness `open` re-mounts it; the held
  place re-applies on the mount, so a `seek` sent before the mount is a no-op);
  a `goToSection` to the section the place is already in does not move the
  place — rewind with an explicit `seek` and verify it, or matched pairs drift
  one passage per run.
