# Current Mac runtime gates (#355)

This checklist adds Mac acceptance to the existing [Duo geometry/input
recipe](../place-and-following/duo-rotation.md), [Margins
checks](../settings/margins.md) and [lookup
controls](../library-and-reader/README.md#pending-lookup-continuity-a-held-response-gate-346).
It is not an installation guide or a record of passed tests. Configuration,
compiled artifacts, ordinary iPhone controls and simulator results cannot pass
the Mac runtime gate. The behavior boundary is [design
0092](../../../docs/design/0092-duo-keeps-the-current-reading-task.md).

## Admission and evidence

- Read [the Mac rules](../../../MEMORY/mac-install.md) and
  [installation guide](../../../docs/install-on-mac.md). Confirm the exact stable
  committed source and explicit same-identifier replacement authorization.
  Back up the whole existing app data container and preserve the old Debug Log
  separately before installation/first launch. A container copy excludes
  Keychain. Use a normally signed standalone Release with Debug Mode and
  embedded JavaScript; never uninstall or delete the container or Keychain.
  A copy at another path with the same identifier still shares owner data and
  Keychain; it is not isolation. Never launch the installed owner copy as a
  convenient control without authorization.
- Follow [device-testing rules](../../../MEMORY/device-testing.md) and the
  [shared build/runtime admission rules](../kit/ios-verification.md). Coordinate
  one runtime lane with the parent. Do not operate another session's target or
  use simulator readiness/silence scripts on Mac. No security-policy, global
  tool-selection, system-setting or publication changes are implied.
- Use an approved disposable Document and disposable Library entries. Record
  permitted fixture imports, app-setting changes, diagnostic/container access,
  network recipients and cleanup before testing. Do not browse owner Documents
  or keys. Screenshots/logs containing private text stay outside git. Do not
  start playback or mute the Mac.
- Derive the expected Debug identity from the admitted commit's `src/build/app-version.ts`
  (formal base + 2, `-debug`; ADR 0086), not an older issue's reference build.
  Record native identity, embedded bundle provenance and visible Settings
  Version separately. Matching native numbers alone do not identify a Beta or
  its JavaScript. Preserve the previous Debug Log before a version-changing
  launch, which can clear it (ADR 0082).

Use a fresh private artifact directory per attempt. Each row below needs a
receipt: case, source commit/dirty state, model/OS, app path/identifier/native
Version, observed Settings Version, action start/end, before/after native
window and safe insets, active-display captures, result, and raw artifact paths.
Collect only authorized test-state/log fields, not whole credential/settings
objects. Record cleanup and the final paused state.

**PASS** requires delivered real input plus the specified visible/state result.
**FAIL** requires a valid control and an observed contract violation.
**BLOCKED** means missing permission, hardware, input delivery, provenance,
measurement or service control; it is not an application failure. Preserve
failed attempts. Do not turn a missing metric into PASS because the screenshot
looks plausible, or turn a tool-dispatch failure into an app defect.

Geometry changes get a bounded eight-second settle window, retaining samples
rather than judging the first animation frame. This is a measurement bound,
not a performance promise. Stop on the first persistent mismatch. A delivered
resize with wrong geometry is FAIL; no delivered resize is BLOCKED. Existing
page probes (`viewport-size.js`, `resize-anchor.js`, `margins-probe.js`,
`lookup-dom-range.js`) can supply supporting data through an explicitly approved
Debug bridge. Their simulator drivers are not Mac drivers.
If no native measurement/authorized bridge exists, report the missing part;
do not invent a geometry mutation or attach a debugger to a different target.

## Mac: current Designed-for-iPad app, not Catalyst

Run only after the Mac admission decisions above. Separate build, package
validation, installation, launch and runtime interaction results. The
[read-only package check](../../../docs/install-on-mac.md#check-replace-and-launch)
does not establish a window, rendering or interaction.

| Case / bounded action | Required assertions |
| --- | --- |
| M0 — authorized launch; allow at most 60 seconds for a usable window | Current app has a visible Library/Reader and native Settings navigation shows the expected complete Version. Record macOS, actual app path, signature/profile check and source provenance. `open` exit 0 or a process is not launch acceptance. If unavailable, retain evidence and stop; do not replace/relaunch repeatedly. |
| M1 — one real edge/corner width shrink, height change and return; eight seconds to settle each | Record actual native content bounds before/after, not a successful drag dispatch or requested dimensions. Width must really change. Reader viewport/stage and every displayed iframe equal current usable width (`window width - left/right safe insets`, in the same coordinate space). Margins stays the saved percentage of that width; Font Size stays unchanged. No stale-width iframe, clipped controls or document text under reserved system space. Capture visible rendering at both widths. |
| M2 — pause, Browse to another passage, then shrink/return once | Capture one exact character at the upper **visible** edge before resizing, accounting for the navigation bar. Measure that same character after reflow, rather than recapturing a new viewport start. The passage remains visible; Browsing does not return to the Reading. Speech remains paused and the saved Reading Position is unchanged. A CFI/DOM measurement supports, but does not replace, the visible capture. |
| M3 — inspect Library, Settings and Player at both measured widths | Native navigation and Back work. Library Search opens/types/cancels and selection actions clear the reserved sides. Settings cards/fields remain usable. Expanded Player labels/controls remain reachable; real collapse/show round-trips preserve paused state. Open Voice, Contents and speed through their own controls, then close. The speed choice survives resize even if its short menu closes. Check the button's near-edge inputs with a successful center control; an AX frame alone is not a touch-target test. Do not impose the phone's row count on Mac or large text. |
| M4 — one open Contents Drawer across shrink/return | Drawer stays open with its list position/selection; its labelled Mac Close works. No stacked/stuck Drawer after reopening. Record panel bounds; do not apply the phone's custom-detent pixel formula. |
| M5 — Appearance at its opening height; shrink/return; then expand and close | Pair captures with Drawer closed/open in the **same** Theme, passage, width and unchanged Appearance settings. Uncovered Document text is visible, undimmed and usable for preview; geometry alone does not prove this. Exercise one allowed Font Size/Margins change, observe a real page change, then restore it. Opening-height state survives resize; an expanded Drawer stays expanded. Close/reopen returns to the saved Drawer Height. |
| M6 — completed Word Lookup across shrink/return | First prove one normal permitted request returns a visible definition. Select a calibrated fixture word through real Mac selection. Record query, service request count, exact range and native visible selection/affordances before/after. Same Drawer/query/definition and selection remain, no request just because of resize. Adjust selection afterwards with the platform's native input: visible range/query and the resulting lookup update together. DOM offsets alone do not pass visible selection/input. |
| M7 — one pending lookup across a real width change, only with a working M6 control | Reuse the linked held-response gate, if an authorized Mac Debug channel supports it; it holds **delivery of an already received response**, not network latency. Confirm one waiting request, resize, then release before 12 seconds from request start (app timeout is 15 seconds). Capture the final visible definition in the same Drawer, one request, no abort/duplicate and retained selection. Release/coordinator success or a spinner screenshot alone is not result acceptance. If target measurement/input cannot fit that deadline, mark this case BLOCKED rather than extending the lookup timeout. Restore the fetch wrapper on every exit. |

M1–M7 are silent and do not establish Mac playback/Following. Installation
alone does not authorize playback; do not infer listening coverage from paused
checks. The parent/owner determines whether the evidence suffices for #355,
including any listening gap. Use actual available sizes, not the old 800-point
Reader cap or a fixed Duo safe inset. If the platform prevents a required
behavior, return the concrete constraint for a decision rather than changing
presentation requirements.

Stop on the first app failure and retain the exact preconditions/input/evidence
for a deterministic reproduction before proposing an app change. A coverage
issue alone supplies no red defect, causal hypothesis or fix.

## Exit and coverage accounting

Restore only the admitted test changes, cancel editors/selection, remove the
run's harness commands/lookup wrapper/recorders and stop playback. Verify the
final current Settings Version and ordinary rendered Reader/Library. Leave an
authorized Mac delivery open and paused as its installation guide requires.
Record any session-owned processes/ports/debugger attachment and their cleanup.
Do not terminate or modify unrelated resources.

Report M0–M7 individually as PASS/FAIL/BLOCKED/NOT RUN, with artifacts and limits.
A prepared checklist, successful package check or simulator pass must never be
reported as completed Mac runtime coverage. Issue closure and acceptance remain
with the parent/owner.
