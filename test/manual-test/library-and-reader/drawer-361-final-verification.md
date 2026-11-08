# Drawer #361 final iOS verification (3dd2d14, tester run 2026-11-08)

Independent final verification of the iPad/Mac shared Drawer on current
source 3dd2d14 (branch xujialiu/fix--drawer-ios-test). Attempt directory:
`/tmp/openreader-drawer361-ios-qa-01` (raw logs, screenshots, trees, guard
records, measures). Metro 8362 from this worktree (PID 5622, debug variant).

> **Audit correction (2026-11-08, after the parent's raw-log review).** The
> windowed-resize phase (phase 5) was originally summarised as a full PASS.
> That was a scope overclaim and is corrected here: the windowed driver
> proves real input caused real window-size changes, retained JS-selected
> detent state/guard/requested ratio, and sampled presentation continuity —
> it does NOT measure the drawer's painted height/width in the window, its
> painted bottom edge, or the actual first/last visible list entries. Those
> remain UNVERIFIED for the windowed states until separate native/paint
> measurements exist. Phase 4's fullscreen painted geometry keeps its
> original basis (the placement oracle over the Library's pure-white page);
> the rotation poller is a sampled JS presentation bound, not native
> controller identity proof. Everything else in this record stands as
> written; no evidence was added or removed in this correction.

## Devices

- `drawer-361-pad-01` EF3E47DA-C530-45CC-9BC8-9B70ECCD454B (iPad Air 11 M4,
  iPadOS 26.5) — transferred from the parent. Installed Debug shell 1.0.4,
  CFBundleVersion 30, Info RCTMetroPort 8293; native inputs byte-identical
  between 0361654 and 3dd2d14 (package/lock/modules/plugins/patches/
  app.config/app.json/ios, 0-byte diff), so the shell was reused with every
  launch pinned `-RCT_jsLocation localhost:8362`.
- `drawer-361-phone-01` E627518D-9AB2-47EF-8E49-E1EB114B9F15 (iPhone 17,
  iOS 26.5) — created by this run inside the shared admission after a
  memory_pressure check (37% free); first boot inside the guard; the reused
  Debug shell installed; Metro 8362 pinned the same way.

## Results per gate

### Phase 1 — Admit/readiness: PASS
`ios_ready.py EF3E47DA… readiness --timeout 20 --metro http://127.0.0.1:8362`
ready (`readiness/readiness.json`); the app registered on 8362; Debug Log
launch lines read `OpenReader 1.0.4 (30)-beta19 … Debug Mode on, Metro
bundle`.

### Phase 2 — Visible Settings version: PASS
Real AXe input (Library actions → Settings row → real grabber-drag dismiss →
scroll): the footnote reads exactly `Version 1.0.4 (30)-beta19-debug`
(`evidence/settings-version-footnote.png`, `settings-scroll-*-tree.json`).
Proves current source (Beta19) is what runs.

### Phase 3 — Full-window iPad placement + interaction contract: PASS
Runs (guarded, real AXe opens; heights handler-staged via the Debug harness,
recorded as such; harness.json cleared after staging):
- `drawer-placement.py` GREEN at 40/50/90 on 820x1180 (full-window,
  origin-zero, light Library page — the oracle's supported basis):
  - 40: x 119.5, y 655, 581x474, bottom gap 51
  - 50: x 119.5, y 537, 581x592, bottom gap 51
  - 90: x 119.5, y 65, 581x1064, bottom gap 51
  Width 581 ≈ the 580 ideal cap (paint +1), centred (119.5 + 290.5 = 410);
  heights match the target share + ~2 pt paint; not page-sized, not dimmed,
  not narrow.
- `drawer-interactions.py` PASS (`r2-interactions/events.json`): opening
  background min RGB ≥ 250 (white, undimmed), real Settings/Library
  navigation behind the open drawer, real grabber expand → large + guard on
  + shaded background (RGB 180–225), expanded backdrop touch contracts to
  the opening height without navigating or dismissing (Q12, accepted), then
  real expand → contract → dismiss.
- Independent no-Close sweep: 22 native trees, zero `Close …` labels.

### Phase 4 — System rotation (fullscreen): PASS for what it measures
`IpadRotationProbe` (run-probe.sh, own admission; `Executed 1 test, with 0
failures` in every `test-*.log`; XCUIScreen attachments kept). The drawer
was the Library actions drawer over the Library's pure-white page, so the
screenshot oracle's painted geometry retains its phase-3 basis:
- Landscape (1180x820): expanded retained — JS selection `large`, guard on;
  painted 579x726 centred, gap 52; opening detent re-rendered 590 → 410.
- Portrait: retained; detents back to 590; painted 579x1086 at large; at
  opening 581x412 (landscape) and 581x592 (portrait).
- CDP pollers across three rotations (92 samples each, ~0.5 s): zero
  non-presented samples — SAMPLED JS presentation continuity (~1 s bound).
  This is not native presentation-controller identity proof.
- Windowed→fullscreen transition with the drawer open: retained; ratio
  recomputed to 590 = 50% of 1180; reader undimmed.

### Phase 5 — Real window-handle shrink/grow (windowed): PARTIAL PASS — native painted geometry and visible-entry identity UNVERIFIED
Established (real corner-handle drags; AX blind behind the desk surface, so
driven by CDP + fresh screenshots):
- Real input changed the real window size: RN useWindowDimensions followed
  the drags (828 → 554 → 486 → 710.5 tall; 375/510/630.5 wide).
- JS-selected detent state and the tablet guard flag were retained across
  every real shrink and grow (selection `large` + guard on at large;
  selection back at the opening after contraction); no dismissal occurred.
- The REQUESTED opening ratio was retained exactly: the JS opening detent
  equalled 50% of the same RN-reported window height at every size
  (414/828, 277/554, 355.25/710.5; 590/1180 fullscreen). Note the ratio
  check is against the same RN hook that requests the detent — it proves
  the JS arithmetic, not native painted geometry.
- Sampled presentation continuity: no dismissal observed in any sample
  across the resizes and the windowed→fullscreen transition.
- Dismiss + reopen: reopen selected the opening detent = 50% of the current
  window (355.25) — JS-selected state evidence.
- Manual visual evidence (exact retained images, reviewed by hand, not an
  automated assertion): `phases/r5d-shrunk.png` (19:11, shrunk window,
  drawer at large, top rows Chapter 3 highlighted → 4–8 + partial 9),
  `evidence/after-2nd-shrink.png` (19:12, 375x486 window, same top-row
  sequence), and `phases/r5e-grown.png` (19:12, grown 630.5x710.5 window,
  same top rows Chapter 3 → 13, more rows visible in the taller window).
  These show the same top rows across the shrink and the grow for the
  states photographed; intermediate states were not row-registered.
NOT established by this phase (wrongly claimed PASS originally):
- The drawer's actual painted height/width relative to the windowed
  window, its painted bottom edge, and the actual first/last VISIBLE list
  entries. The driver's row set is rendered/cached fiber text (lexical
  first/last — not visible entries), its light-mask width can span the
  whole window over the near-white reader page, its "impliedChrome" is
  derived from the requested detent height, and its painted_height helper
  subtracted the fullscreen 51 pt constant. All are annotated as
  observations/deprecated in the committed driver.
- The windowed native bottom chrome value (~6–11 pt) is an inference from
  requested values, not a measurement.

### Phase 6 — Representative actions (on the phone): PASS
More actions drawer menu page shows the Share header action (tree-verified);
the nested Appearance page opens with its `Back from Appearance` control;
one real font-size increase and decrease restored the value (24 → 26 → 24;
the ladder steps by two); Back returned to the menu page; the drawer
dismissed by a real grabber drag. The system share sheet did not open from
the AXe Share touch (known AXe system-sheet flakiness; named limit — the
Share control's presence and enabled state are tree-verified). Contents
long list: done on the iPad in phase 5 (real 250-chapter part). Library
actions: done on the iPad in phase 3.

### Phase 7 — Ordinary iPhone (drawer-361-phone-01): PASS
Detent `{height: 412.78}` = drawerDetentHeight(50, {402, 874, inset 34})
exactly; painted floating card x 8.33, width 385.33 (8 pt insets), top
y 436 ≈ 50% of 874 (oracle basis: pure-white Library page, full-window
origin-zero); no Close; real drag flow usable: expand → grabber 69.5
(large), contract → exactly the opening grabber position (444.31), dismiss
→ gone. No behavior refactor claimed.

### Delivery: iPad input/delivery BLOCKED-INCOMPLETE; phone complete
- Phone `drawer-361-phone-01`: latest Beta19 app delivered open on the
  reader, paused, Metro 8362 — inspection-ready.
- iPad `drawer-361-pad-01`: the app (correct Beta19 source, version verified
  in phase 2) is open fullscreen on the Library, paused, Metro 8362 — but
  the input wedge RECURRED (~19:20) after the windowing round-trip, so the
  changed Drawer could NOT be opened on the device for final inspection.
  iPad changed-interaction inspection delivery is therefore
  **BLOCKED/INCOMPLETE** (app source/version present and running; the
  interactive changed surface is not staged).

### Environment checkpoint — input wedge (recurrence): BLOCKED
~18:19: touch delivery died (axe touch/tap, elementRef tap, HID home all
succeed with no effect; describe-ui/screenshots/CDP fine). One **recorded**
target-only shutdown/boot (`readiness/recovery-used.json`, `recovery.log`)
restored it at 18:26; all real-input evidence above postdates it. (A first
wrapper invocation failed exit 127 on my own path typo **before any command
touched the device**; recorded in `recovery-used.json`.) ~19:20, after the
heavy windowing round-trip: the wedge RECURRED (control: HID home no-op;
empty OpenReader root only). The attempt's one recovery was spent, so per
the attempt rules no second reboot was taken: iPad input work is BLOCKED at
this checkpoint.

## Failed runs (all retained with raw artifacts)
- phase2 (first): "no native Sheet Grabber" — the pre-recovery wedge
  (environment; proven by the recovery + passing rerun).
- diag4/5/6: CLI probes — `snapshot_ui` name mismatch, no-runtime-snapshot
  errors; superseded by CLI `snapshot-ui`.
- recovery wrapper exit 127 (my path typo; device untouched).
- phase3 r1: `Library actions is not available` (app left on Settings by
  phase 2 — staging error), `FileExistsError` (artifact-dir reuse),
  `declare -A` (bash 3.2). Fixed and rerun as r2 (all GREEN).
- phase4b: dismiss-from-expanded helper bug (a downward drag contracts
  first); poller path bug (landscape continuity lost, re-established later).
- phase5a: missing Inbox dir; add answer slower than 2 s (poll added).
- phase5b/5c: stale AX frames after a real resize; second drag hit the
  desktop (`DockFolderViewService`); windowed app blinded AX.
- phase5d series: measurement-driver iterations (light-column text-row
  stops, Dock poisoning, title-text grabber false positive, pill-centred
  expand drag no-op → 5 pt above + 2.2 s). Final driver committed with the
  audit annotations above.
- phase5e/f/g: dismissal assertion race (pixel grabber false positive with
  no drawer); LogBox banner over the transport; speed popover opened by the
  X estimate (closed by tapping the control again).
- phase6 phone: `Appearance` is not a player button (it lives in More
  actions); font-size assertion expected +1 (ladder steps 2 — the restore
  itself was correct); rerun entry-state fix; share attempt no sheet.
- phase5 original summary: scope overclaim (full PASS) — corrected by this
  annotation pass; the raw attempts and their partial evidence are retained.

## Remaining risks / limits
- Mac (Escape/pointer) acceptance is the parent's separate lane; no Mac
  acceptance claimed here or anywhere in this record.
- Windowed native painted geometry (panel height/width, painted bottom
  edge) and visible-entry identity across windowing remain UNVERIFIED;
  they need separate native/paint measurements (e.g. a native oracle or
  controller-level reads) — not produced at this blocked checkpoint.
- Windowed native bottom chrome value unmeasured (inference only).
- No-re-presentation is bounded by ~1 s poller resolution; it is JS-sampling,
  not native controller identity.
- Voice/Download/lookup shared-layout gates not exercised (no provider
  configured, per the task's scoping rule).

## Verification-record paths
- Committed record (this file, corrected): 
  `test/manual-test/library-and-reader/drawer-361-final-verification.md`
- Committed helpers (annotated): `drawer-rotation-step.py`, `drawer-poll.py`,
  `drawer-windowed-resize.py` (historical run-specific diagnostic)
- Pitfalls: `test/manual-test/README.md` (Pitfalls), `pitfalls/simulators.md`,
  `pitfalls/shell.md`
- Raw attempt directory: `/tmp/openreader-drawer361-ios-qa-01` (ledger.md,
  evidence/, phases/, readiness/, logs/, rotation-probe/)
