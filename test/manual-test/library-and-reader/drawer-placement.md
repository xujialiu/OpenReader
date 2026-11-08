# Drawer placement reproduction and native-proof limits (#361)

## Reproduce the reported large bottom gap

Use a session-owned, booted iPad simulator, the current Debug app and its own
Metro. Follow the kit's admission/readiness rules. The app must show the
Library in light Theme, occupying the full origin-zero window. An empty
Library is sufficient: no Document, Provider, keyboard or playback is needed.
Python needs Pillow and NumPy, as the existing screenshot tools do.

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 60 --timeout 45 \
  --record /tmp/drawer-placement-01-phase.json -- \
  python3 test/manual-test/library-and-reader/drawer-placement.py \
  SIMULATOR_UDID /tmp/drawer-placement-01 --metro http://127.0.0.1:METRO_PORT
```

Use a new artifact directory for each invocation. The script resolves the
selected simulator's name, filters CDP to that app/device, closes any open
Drawer through its real component callback, then opens Library actions by a
real AXe touch. It confirms the actual shared Drawer is open and saves the
native tree, screenshot and `result.json`. It neither modifies app source nor
starts audio. `--capture-only` measures the already open Library actions
Drawer without resetting or touching it.

Expected exits:

- `1`, **RED**: the painted Drawer has a bottom gap greater than the larger of
  24 points or five percent of the current app-window height. This conservative
  separator catches the reported large blank region; it is not the accepted
  final bottom inset.
- `0`, **GREEN**: only that large-gap check passed. This says nothing about the
  correct opening height, width, preview, dismissal, resizing or Mac support.
- `69`, **BLOCKED**: native/CDP/input/capture preconditions or supported image
  geometry were not established. Never turn a missing Drawer into GREEN.

The screenshot oracle supports a wide light Drawer over the Library's white
page. It derives scale from the native Application frame, rather than assuming
three pixels per point. Dark Theme, non-origin-zero system windows and very
narrow fitted sheets are outside this oracle's supported geometry. For a
native experiment outside it, retain the BLOCKED image result and separately
measure the real presentation frame through the kit's owned LLDB path; do not
silently substitute a successful verdict.

Host-only oracle checks:

```sh
python3 test/scripts/drawer_placement_test.py
```

These cover a detached card, a near-top page sheet, the candidate's retained
gap, screenshot scale, absent Drawer and unsupported narrow geometry. They
cannot prove native UI behavior. In particular, a full-height page sheet can
pass the bottom-gap check while failing the required half-height preview.

## Verify real interactions on current source

With Library actions already open at the chosen height, in the same
full-window/light-Theme setup:

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 60 --timeout 140 \
  --record /tmp/drawer-interactions-01-phase.json -- \
  python3 test/manual-test/library-and-reader/drawer-interactions.py \
  SIMULATOR_UDID /tmp/drawer-interactions-01 --metro http://127.0.0.1:METRO_PORT
```

This requires the tablet native modifier policy. It rejects diagnostic
runtime globals, checks no Close in every native snapshot, confirms opening
background luminance and delivered Settings/Library navigation, then expands
through the real grabber. A shaded-background touch must consume the action,
retain the Drawer and return its actual grabber/selected height to opening.
A separate real expansion → contraction → dismissal sequence follows. It
records `events.json`, trees and screenshots on both success and failure.
No handler, module export or native state is overridden. Exit zero requires
all assertions; a failure remains a failure until explained and corrected.

This is full-window iPad input evidence, not Mac keyboard/pointer evidence or
proof of rotation, real window resizing or long-list continuity.

## A native candidate is not a completed fix

The engineering findings and pending acceptance are in ADR 0085. The source
inspection and isolated runtime experiments do not authorize replacing the
owner's Mac installation, selecting a custom fallback or claiming the issue
resolved. Temporary module/prop overrides must be discarded by relaunching
before rechecking the unchanged source. Preserve experiment failures, native
frame/detent receipts and the unmodified before/after controls.

A usable candidate needs separate checks of actual window-relative height,
width and bottom gap, initial background luminance and a delivered background
action, expanded shading/blocking, and real grabber expansion/contraction/
dismissal. Retaining a requested modifier or selected-detent string is not a
native geometry or input assertion. Mac Escape, mouse/trackpad behavior,
rotation, actual window resizing and long-list continuity are independent gates.

## Probe pitfalls

- Filtering out sheets whose top is above 60 points falsely BLOCKED the native
  page-sized result. The oracle now includes near-top sheets; a dedicated host
  test locks down that capture seam. The original failed record stays retained.
- A live `presentationSizing` prop override left native geometry unchanged,
  while a cold presentation used a different size. Installing a runtime Host
  wrapper over an already presented sheet also produced JS `visible=true`
  without a native Drawer. Relaunch to discard diagnostic overrides, install
  the wrapper while closed, prewarm its closed Host, then require a fresh
  ordinary failing control before testing a new setting. A failed diagnostic
  setup is not proof that a native API cannot work.
- A C++ `CGRect` local/persistent initializer failed in LLDB with `no matching
  constructor`, and a generic `d` name collided with internal symbols. A
  source-command error can abort before the final detach despite the global
  stop-on-error setting. The working inspection passes rectangles directly to
  `NSValue` and uses `command source -e false` around a command file ending in
  `process detach` and `quit`. Require a real frame and explicit detach receipt;
  command exit zero alone does not establish successful expressions. A later
  root-only controller-chain inspection returned a zero frame: require a
  currently presented controller and positive frame, and traverse containment
  as the kit's Duo geometry script does. A synthesized/nonpresented controller
  is not evidence about the painted Drawer.
- A touch on the shaded background can dismiss the expanded native Drawer
  without navigating to Settings. Checking only that Settings did not open
  incorrectly credits half the contract. Assert that the Drawer and its
  selected height also remain. A live dismissal-guard experiment retained the
  Drawer but did not retain `large`; it is not a passed guard. Keep that failed
  scenario separate from the isolated opening → large → opening → dismissed
  grabber sequence, which exercises different input. Keeping the guard in
  the modifier chain from the first source presentation prevents closing,
  but repeated expanded backdrop touches still contract to the opening
  detent. That native contraction is explicitly accepted. The original
  retaining-`large` assertions remain failed historical checks; the new
  interaction test asserts the opening height, retained Drawer and no page
  navigation instead.
- Native tree nodes may contain an explicit `AXLabel: null`. A default passed
  to `get` does not replace that null; use `node.get('AXLabel') or ''` before
  string operations. The first source no-Close helper failed on this shape;
  subsequent fresh-tree interaction checks explicitly confirmed no Close.
