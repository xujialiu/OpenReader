# Isolated iOS-on-Mac Drawer verification (#361)

This tests the iPad app running on Apple silicon, not Catalyst/native macOS and
not the owner's installed app. Read MEMORY/mac-install.md, the Mac installation
guide, the shared admission rules and the current computer-use guide first.

## Identity and build boundary

The separately agreed probe identity is `top.xujialiu.openreader.drawerprobe`,
display name `OpenReader Drawer Probe`. Start empty/default; do not copy the
owner's Library, settings, credentials or container. Keep probe-only config in
its own announced sub-worktree. Do not import its identity overrides into the
production branch.

The isolated build uses the existing `scripts/macos-install.py` workflow with
its expected bundle identity, temporary target and artifact verifier explicitly
scoped to this approved probe configuration. Signature, current-Mac profile,
embedded version, iPhone/iPad family, resizability and Debug/no-purchase checks
are still mandatory. A different expected identifier is not permission to skip
identity checks. Keep every failed build directory.

A verified wrapper can be copied to a new user-owned temporary directory and
run there through normal LaunchServices, without a privileged installation or
replacing `/Applications/OpenReader.app`. Do not remove quarantine, bypass
Gatekeeper or re-sign ad hoc. Normal app translocation may change the running
bundle URL; identify the process by the approved bundle ID and correlate its
signature/product, not a host-wide `OpenReader` process-name search.

## Real GUI controls

Use the current `orca computer` guide, an explicit app ID and current window ID.
Save raw action/capture receipts and durable copies of the screenshots; an
unverified provider action is not a passed interaction. Use a settled fresh
capture after sheet animations, not only the screenshot attached immediately
to the opening action. Native Mac window close/minimize/zoom controls are not
Drawer Close controls.

For pointer drags, derive the grabber from the current screenshot and divide
image pixels by its reported scale. Assert the actual native height changes.
Likewise, a window-corner drag must change measured native window bounds;
requested dimensions are not measured dimensions or a minimum-size claim.
Check opening/expanded retention and actual content separately.

The dark/light presentation follows the probe's resolved Theme. Do not change
the Mac's global appearance or output volume for a test. Layout checks need no
audio. Keyboard testing needs an opening-height working control before treating
an expanded failure as an app result.

## Symptom-specific Escape loop

First use real UI to open at the ordinary chosen height, or expand through the
grabber. Stage `expanded` from a known 50-percent opening; a grabber label alone
is ambiguous at very tall custom heights. Bring only the approved probe forward
normally, after warning about focus takeover, then run:

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 60 \
  --record /tmp/mac-escape-01-phase.json -- \
  python3 test/manual-test/library-and-reader/mac-drawer-escape.py \
  top.xujialiu.openreader.drawerprobe WINDOW_ID /tmp/mac-escape-01 --state expanded
```

Use `--state opening` for the working control. The helper refuses every other
app identifier, checks the exact capture PID/window and known height, requires
that process to be frontmost, then sends one real System Events Escape
(key code 53). It never calls an app callback or overrides native state. It
preserves native trees, screenshots and result on either outcome:

- `0`: the Drawer disappeared while the same app/window remained available.
- `1`: the system key was sent but the Drawer remained — the exact failure.
- `69`: foreground, input, identity or capture could not be qualified; BLOCKED,
  not a failed app assertion.

The opening/expanded controls and any menu/text-composition behavior are
separate gates. Passing a shortcut in an empty Library does not establish
alert/menu priority, closed-sheet lifetime or marked-text cancellation.

## Pitfalls established by the isolated run

- RNAudioAPI's release asset downloads can return HTTP504 while the vendor
  script continues and exits successfully; linking then reports missing
  `iphoneos/libogg.a`. Verify all six static archives and FFmpeg framework
  metadata, not script exit alone. A read-only local cache with identical
  package version/release tag can be copied into the independent node_modules
  with per-file hashes/link targets checked. Re-run `pod install` after hydration
  so CocoaPods registers vendored FFmpeg frameworks. Never substitute macOS
  archives for iPhoneOS, disable decoding features, delete shared caches or
  change TLS/security policy to get a green build.
- Orca's immediate opening screenshot showed no Drawer although its tree had
  the sheet. A later settled capture painted it. Do not diagnose invisible
  presentation from only that immediate frame.
- Background Escape at `large` did nothing. `--restore-window` was then refused
  as `window_not_focused`; do not repeat restore or count that refusal as app
  input. Normal activation plus the same foreground System Events key path
  passes at opening and fails at `large`. That qualified control, not the first
  synthetic dispatch, establishes the remaining keyboard defect.
- Actual native window sizes after corner drags differed from the requested
  sizes. Preserve both and qualify real change; do not call a partial move a
  new minimum-size rule.
- The Mac Settings back control is `back button Back`, not the iPad's
  `button Library`. A fixed-label helper failed after already proving the
  visible Beta19 version; a fresh semantic Back lookup returned to Library.
- A strict expectation of backdrop contraction did not hold on Mac: the
  Drawer stayed expanded and did not navigate or close. The same calibrated
  Settings point really navigated at opening. The accepted rule permits native
  contraction but requires retention and no underlying action; record the
  platform observation without claiming an unobserved contraction.
