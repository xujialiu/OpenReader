# Duo verification preparation

Recipes, probes and host evidence checks for the remaining Duo verification
and related platform/diagnostic gates. **Preparation, not acceptance:** host
checks validate the tools, not native behavior or issue completion. Runtime
measurements require the admitted tester lane and parent review.

- [Duo acceptance controls](duo-acceptance.md) (#350–#354): visible selection
  and handles, held lookup results, system windows, audio/Following and
  Appearance preview, with separate native evidence requirements.
- [Duo selection-paint oracle](duo-selection-paint.md) (#350): fixture-local
  HOST pixel controls and the remaining fresh native capture/offset handoff gate.
- [Duo native-loop verdict repair](duo-red-loop.md) (#350): one shared asserting
  verdict path, HOST captured-shape replay, nonzero RED/incomplete statuses and
  the remaining native qualification gate.
- [Diagnostic controls](diagnostics.md) (#357/#358): crash-attribution evidence
  and bounded, read-only simulator-volume observation; neither supplies a
  native crash reproduction nor continuing-silence acceptance.
- [Mac runtime gates](platforms.md) (#355): authorized current-app launch,
  resizing and interaction checks, not an installation or passed-run record.
- [Mac selection-paint feedback](mac-selection-paint.md) (#355): fixture-local
  native resize driver and pixel assertion; host replay qualifies the tool,
  not the application's native red/green result.

#356 is cancelled and closed as not planned; no physical-Duo coverage is
claimed here. Use the [manual-test index](../README.md) and [shared kit](../kit/README.md)
for prerequisites and existing tools.

## Pitfalls

- **A printed RED is not an asserting CLI.** The original #350 loop retained a
  real fourth-cycle range/paint loss but its literal final `exit 0` made the
  outer guard report success. Task/count/Library lines were printed rather
  than enforced, and a baseline incremented valid cycles before fold/capture.
  Use the [shared verdict path](duo-red-loop.md); keep old guard exit0 records
  unchanged as tool-defect evidence. Max cycles and two same-path REDs are stop
  reasons, not passing verdicts. HOST replay establishes nonzero capability,
  never a new native run or an application fix.
- **Diagnostics and cleanup selection are separate receipts.**
  `selection-diagnostics.js` reports `DEBUG-SELECTION` instances, not `ranges`.
  Waiting for ranges after sending only that probe can time out or accept an
  unrelated answer. Cleanup must send the actual selection probe, validate
  fresh complete JSON and empty ranges, attempt traffic restoration even after
  other cleanup errors, then independently verify clean state and harness-file
  removal. A later clean read cannot erase an earlier cycle's uncertainty.
- **Repeated CDP calls are not single-session reuse.** The heartbeat opens one
  fresh `cdp.cjs` connection per call, then sleeps 300ms. Neither a persistent
  connection nor a fixed 300ms sampling cadence is established. Preserve
  registration failures as controls; no new connection framework is implied.
- **A failed aggregation command must not disappear from the cycle ledger.**
  Truncated cleanup JSON once raised before the cycle verdict was saved, while
  the shell ignored the pipeline failure and summary scanned only saved verdicts;
  a later clean cycle could hide a retained RED and report PASS. Retain every
  attempted directory, treat unreadable cleanup as uncertainty, recover qualified
  phase REDs and stop on a checked aggregation failure. Replay likewise handles
  malformed later entries as attempts rather than discarding earlier REDs.
- **Newer-than-start is not invocation provenance.** Independently choosing a
  test log and attachments by filename/mtime can select a future-dated stale
  painted capture; a fresh directory can also contain old PNGs. Bind all artifacts
  to the actual runner's one `Artifacts:` result/log STAMP and source directory,
  reject pre-existing selected artifacts and future times, and check both PNGs
  inside the disclosed capture/export interval. HOST synthetic controls qualify
  this selection logic, never native painting or #350 acceptance.
