# Duo rotation: input delivery, real window and rendered page (#349, #359)

Use the kit's shared admission/readiness rules. Keep the selected app visible
and paused. This recipe never plays audio, launches the app, requests forced
scene geometry or calls a private orientation API. It tests rotation at a fixed
fold pose, not rotation inferred from changing displays.

## Why the old XCTest choreography is not acceptance

On the Duo runtime, setting `XCUIDevice.shared.orientation` can change the test
runner's getter without delivering the corresponding event to the target app.
The same failure occurs in an all-orientations public-UIKit control. A getter,
supported mask, or successful input dispatch is not target-side delivery.

`DuoRootRotationProbe.testXCTestOrientationDeliveryDiagnostic` preserves that
negative diagnostic with actual app-frame assertions. It requires an explicit
opt-in and is not a production rotation verdict:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
  bash test/manual-test/kit/run-probe.sh DuoRootRotationProbe \
  SIMULATOR_UDID OUTPUT_DIR --mode xcdevice-diagnostic \
  -only-testing:DuoRootRotationProbe/testXCTestOrientationDeliveryDiagnostic \
  -collect-test-diagnostics never
```

Without that opt-in the test skips; the runner does not accept an all-skipped
result as passing coverage. Retain negative logs rather than describing them
as an OpenReader-specific veto. Disable automatic diagnostic collection for
this deliberate failure; a post-test collection timeout is an incomplete run.

## Calibrate the real input

Use the Device Hub belonging to Xcode 27.1. Find its process and the window
whose title names the explicit simulator, then obtain a fresh window-scoped
`orca computer get-app-state` screenshot. Follow the computer-use skill.

Locate the **Rotate** pictogram, not one of the adjacent fold-pose buttons.
Supply its current window-point coordinates: screenshot pixels divided by the
reported screenshot scale. Do not copy a previous run's coordinates. Keep the
same window size/toolbar arrangement throughout the run.

Choose the display/pose separately, before running: `simctl io UDID enumerate`
identifies outer display 1 and inner display 3. Inspect the selected pose and
capture that display; the other may legitimately be black. Pose controls may
need foreground input; announce it and restore the previous frontmost app.
Background Rotate clicks can also fail to deliver, or arrive after a BLOCKED
read. Do not retry from an assumed starting direction: read actual target state
again. For a foreground phase, keep the hub in front until the phase ends and
restore the prior frontmost app with a cleanup trap.

Start physically upright, with the **target's** UIDevice orientation equal to
1. The unfolded inner window can be landscape at that same physical direction.
The driver uses the display's measured initial axis rather than applying the
outer phone's portrait assumption to the inner display. After an app relaunch,
the target can report UIDevice0/unknown while its scene/window remain correct.
That is not an accepted starting direction: establish a real input event before
rotation acceptance. A passive final geometry/delivery read is a separate check
and must not be presented as another rotation test.

## Run one guarded round-trip

Open Library, or the short reading fixture with speech paused. Use `--reader`
only with a mounted Document. The latter also measures the real page through
the existing Debug harness, without synthesizing a resize or seeking.

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
python3 test/manual-test/kit/ios_guard.py run --wait 0 --timeout 180 \
  --record /tmp/THIS-RUN/phase.json -- bash -c '
    set -euo pipefail
    bash test/manual-test/kit/silence.sh set SIMULATOR_UDID
    python3 test/manual-test/place-and-following/duo-rotation.py \
      SIMULATOR_UDID /tmp/THIS-RUN/rotation \
      --hub-pid HUB_PID --window-id WINDOW_ID --rotate X Y \
      --display 1 --start-device 1 --metro http://127.0.0.1:METRO_PORT
  '
```

Use a new output directory for each case. For the inner display pass `--display
3`; for Reader add `--reader`. Repeat Library and Reader at each display's
fixed pose. The script reads target-native state through `owned-lldb.sh`,
verifies ownership and explicit detachment, and finishes that inspection before
any GUI, screenshot or harness operation. It never overlaps AX with LLDB.

The default four quarter-turns exercise both sideways physical directions and return to
upright. `--turns 0` checks the current geometry without input; `--turns 1`
minimises a trigger. Neither is a full round-trip. `--start-device 1` requires
the actual upright target direction before input and prevents a delayed prior
click from silently changing the choreography. Other known non-upside-down
start directions are available for minimisation. The target's device direction must change after each click. Window
and root geometry must follow relative to the display's initial axis. A
physically upside-down outer phone may keep its prior interface orientation;
that state is recorded, not forced into an unsupported direction.

Direction values can update before the window finishes rearranging. Every
native sample is retained during a bounded eight-second settle window; a
single in-flight sample is not the final app verdict. Reader additionally
requires viewport, stage and **every displayed iframe** to match the native
window minus the current side safe areas. A persistent iframe mismatch fails,
even when the window, viewport and stage all look correct.

## Real controls after rotation

The four-direction geometry matrix does not prove taps or drawer dismissal.
For a paused inner Reader, run the existing `DuoPlayerProbe` explicit
collapse/show method, then `DuoDrawerCloseProbe/testMoreActionsDrawerStagedDismiss`
through the guarded runner. The latter taps More actions, asserts the grabber,
and drags from an element-anchored coordinate. On this pose XCUITest's
`app.frame` can stay portrait-shaped while native window and element frames
are landscape; app-anchored drag coordinates can misaim. Keep failed logs
and inspect each raw XCTest method and its actual `Executed … failures` lines.
Do not infer success from the diagnostic print following an assertion.

`DuoSettingsVersionProbe/testVersionLineVisible` enters Settings with native
button taps and derives the exact Debug version from `app-version.ts`.
`DuoBannerDismissProbe` distinguishes an already absent banner from a delivered
dismissal; its absent-banner success is not evidence that the tapping branch
ran. Capture every screen when the app uses the inner display, since
`XCUIScreen.main` may be the outer one. The final active-display screenshot
must show clean controls, separately from earlier captures with a Debug banner.

## Bounded inner-display resize stress (#359)

A slow four-turn case can miss a race between a location-report frame and the
native resize observer. `duo-rotation-stress.py` sends four real Rotate clicks
per burst, records a bounded target-page resize trace, and asserts persistent
geometry after each burst. It stops at the first confirmed mismatch, saves the
native state and active-display image, and removes its own recorder/harness.
No method is patched in the target. The burst check requires at least four
page resize events and a final actual upright target direction; it does not
claim a native direction assertion after every intermediate input. Pair it
with the ordinary round-trip above.

With the fully-open inner Reader already mounted, physically upright and
paused, run the following **inside the same admitted foreground phase**:

```sh
python3 test/manual-test/place-and-following/duo-rotation-stress.py \
  SIMULATOR_UDID /tmp/THIS-RUN/stress \
  --hub-pid HUB_PID --window-id WINDOW_ID --rotate X Y \
  --cycles 8 --metro http://127.0.0.1:METRO_PORT
```

Eight cycles bound the check past the observed pre-fix five/six-cycle failures;
`--cycles` permits at most twenty. Derive the enclosing guard deadline from
the number of cycles. A fresh inner Reader is sufficient: outer-display or
fold history is not required. The trace and guard records remain evidence;
a tool-dispatch failure or incomplete event history is BLOCKED, not PASS.
A clean final screenshot and the ordinary driver are separate acceptance steps.

The deterministic host regression, `npx vitest run
test/renderer/resize-width.test.ts`, executes the installed epub.js location
report/getter and resize/iframe sizing methods. It pins the location read
between the DOM size change and the resize observer, the order captured in
the live failure. The unguarded control retains the stale locked iframe width;
the adapter keeps location reads from consuming the resize cache.

## Read the result, including failures

- `records.json` distinguishes PASS, FAIL and BLOCKED. Exit 69 means a missing
  input/precondition/tool result, not a failed app assertion. Exit 1 means a
  delivered input with an incorrect measured response.
- Native logs include actual target orientation, scene direction, window/root
  bounds, side insets, process identity and explicit debugger detachment.
- PNGs are display-specific. PASS still requires visual review of rendered
  Library/Document content and controls; geometry alone cannot establish it.
- Reader checks speech remains paused. Every case checks the app process is
  unchanged and saved Reading Positions are unchanged. It does not verify
  playing audio, Word Timings, exact Browsing anchors or task combinations.
- A click on an empty hub area is a useful negative input control: it must
  return BLOCKED for an undelivered device event, never PASS or an app failure.
- A failed run preserves its final state for inspection. Do not silently
  relaunch, fold or rotate again before recording the failure. Restore the
  convenient paused inspection state explicitly afterwards.

Host oracle tests run with `python3 test/scripts/duo_rotation_test.py` or
`npx vitest run test/scripts/duo-rotation.test.ts`. They cover missing delivery,
window/root failures, both display axes, stale iframe widths and missing LLDB
detachment. They do not stand in for native runs. Current native measurements
and remaining failures belong in the engineering log and issue, not in a PASS
claim inferred from these tests.

## Real fold-pose transitions (#348)

`duo-fold.py` drives the Device Hub's fold-pose buttons (not Rotate) for paired
outer↔inner transitions judged by the target's own window width: folded 466,
fully open 951. It runs under the same admission rules as `duo-rotation.py`,
with the app visible, paused and served by the Metro whose readiness it checks
first. Every click is foreground-calibrated fresh (see pitfalls/mcp.md: the hub
must be frontmost, and a failed dispatch may still have delivered).

```sh
python3 test/manual-test/place-and-following/duo-fold.py SIMULATOR_UDID OUT_DIR \
  --hub-pid HUB_PID --window-id WINDOW_ID --closed X Y --open X Y \
  --metro http://127.0.0.1:METRO_PORT --reader --sequence open,closed \
  --negative X Y --start-width 466
```

The pose points are the CURRENT hub window's, in window points (screenshot px
÷ scale); re-derive them every run. `--sequence` is a comma list of `open` /
`closed` targets, each clicked once with a bounded settle loop that retains
every native sample; the first input's `--start-width` pins the actual starting
pose. The native read reports every scene and window (`FOLD348` lines, ObjC++
through `owned-lldb.sh`, explicit detach) because a fold can leave more than
one scene; the driver selects the foreground-active scene's key window. The
negative control clicks an empty hub point and must not change the app.
`--reader` also records the page's viewport/stage/iframe widths and requires
speech to stay paused and saved Reading Positions to be unchanged. Exit 1 is a
delivered input with a wrong measured response; 69 is a missing
precondition/tool result. Player-row measurement during each pose is
`DuoPlayer348Probe` (`testFoldedTwoRowGeometry`, run serially between driver
runs — never overlapping LLDB), which also covers the drawers, the speed
popover round trip, collapse/show, skips and Tap Lock while paused.
