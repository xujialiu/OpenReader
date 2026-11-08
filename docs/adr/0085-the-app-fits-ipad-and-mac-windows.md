---
status: accepted
---

# The app fits iPad and Mac windows

Issue #319; [the product decision](../design/0085-the-app-fits-ipad-and-mac-windows.md).
The owner approved a trial implementation of iPad support and a resizable
Apple-silicon Mac window, with the existing navigation and one Reading.
Dimensions are provisional, not measurements of an ideal layout.

## The same iOS app, one scene

`app.config.ts` sets `supportsTablet: true` and `requireFullScreen: false`.
`orientation: 'portrait'` remains unchanged. The installed Expo 58 writers
produce device families `[1, 2]`, portrait and upside-down portrait for the
base orientation key, and all four orientations for
`UISupportedInterfaceOrientations~ipad`. The latter comes from Expo's
`RequiresFullScreen` plugin independently of the phone's orientation.
`test/app-config.test.ts` runs those installed writers rather than repeating
that mapping in an app-owned implementation.

Expo SDK 58's upstream scene manifest declares
`UIApplicationSupportsMultipleScenes: false`; #345 retires the custom scene
plugin after the upstream template supplies the same configuration (ADR 0018).
Resizable is not multi-window. Nothing introduces a second Reading, another
playback owner, a sidebar, facing pages, or a Mac Catalyst target.

Apple distinguishes fixed-size iPhone apps from iPad apps supporting
multitasking in [Running your iOS apps in macOS](https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos).
The exact Expo configuration is documented in
[SDK 58 app configuration](https://docs.expo.dev/versions/v58.0.0/config/app/).
SDK 58's lack of `react-native-macos` support is not a change to this execution
path: OpenReader remains the iOS/iPad app on Apple silicon, not a
`react-native-macos` or Catalyst target. Configuration compatibility does not
establish actual Mac runtime verification.

## Duo scene orientation exception (#346, #349): real-input rotation observed

The phone and tablet plist orientation arrays stay unchanged. The focused
`with-duo-scene-orientation` config plugin extends the upstream generated
SceneDelegate subclass; it does not reintroduce the retired scene-adoption
plugin or create another window/React root. It refuses an unexpected subclass
instead of overwriting another native policy. Fresh AppDelegate factory and
lifecycle code stays untouched. A cleanup-only AppDelegate mod removes the
owned legacy-callback experiment from non-clean prebuilds; forwarding through
that callback did not establish device-driven rotation.

Built with the UIKit 27.1 SDK, the delegate attaches a public
`UIHingeInteraction` to its phone scene's window. Only a non-null hinge update
records positive evidence, scoped to the scene session. Null updates during a
hierarchy/display change do not revoke that evidence. The observation is not a
layout input: neither angle, posture, window dimensions nor a model-name guess
selects a layout or the orientation exception.

On iOS 27+, the scene-supported-orientations hook returns the existing
per-idiom plist mask, adding landscape only for a phone scene with matching
positive evidence. The supported-mask refresh and geometry request use public
UIKit APIs. A public single-landscape request succeeded with scene mask30 and
root mask6, but device-driven rotation did not. That proves a geometry request
is permitted, not that automatic rotation follows the declared capability.

For a confirmed Duo only, a native containment controller now gives the root
the same scene policy instead of the old portrait fallback. It retains the
original Expo controller and its exact React view as one child, pins that view
to its bounds (not another inset guide), and forwards status-bar,
home-indicator and system-gesture preferences. It does not create another
React root or change ordinary-device controller containment. Stale hinge
callbacks from a different scene/window are ignored.

Fallback selection matches Expo's existing device-idiom logic: the iPad key
when that device idiom applies, then the base key and platform default if a
key is absent or empty. No separate Mac policy is invented. Ordinary phones,
iPad and Mac retain that fallback. Older runtime/build combinations use it
without hinge observation; only a fresh SDK 27.1 build can establish Duo-policy
acceptance. Runtime geometry rejection is not a successful rotation.

This avoids a global portrait root-controller default (which would also change
iPad startup) and avoids treating hinge API availability as hinge hardware.
The upstream scene still owns cold URL delivery and lifecycle forwarding;
connect, active and disconnect overrides call their superclass implementations.

Generation tests cover the installed Expo template, idempotence, owned-block
updates and refusing conflicting native code, alongside unchanged plist masks
and upstream AppDelegate factory/lifecycle content. They also check retention
of the original native controller/view and the same mask provider at both
policy layers. They are not native compilation or orientation evidence.
The generated file compiled and cold-started with SDK 27.1. The beta13 native
shell aligns the confirmed Duo scene/root masks at30, and public single-mask
geometry requests rotate the outer Reader. An activated, foreground-asserted
XCUIDevice control still leaves its app frame unchanged. Follow-up #349
separates that test input from actual target-device delivery: the same getter
changes without a target orientation notification in an all-orientations
public-UIKit control. It is not an OpenReader-specific rotation veto.
The real Device Hub Rotate control delivers target events and rotates the
unchanged shell's window/root466-by678 to678-by466, and the inner951-by669
to669-by951. `duo-rotation.py` retains target-native state, active-display
captures and explicit LLDB detachment. Masks, forced geometry, fold-driven
aspect changes and XCUIDevice's getter alone remain insufficient evidence.
Outer Library/Reader and inner Library/Reader have independent beta15
round-trip evidence, with active-display rendering and all displayed iframe
widths measured. The inner renderer width race discovered there is #359,
below. The original outer-open to inner-rotation scenario and eight real-input
stress bursts pass after its correction. Saved settings/positions remain
unchanged; no playing-audio or physical-Duo claim follows from these paused
checks.
On that same shell with beta14 JavaScript, iPhone27.0 retains its402-by874
portrait app frame; iPad26.5 changes820-by1180 to1180-by820 and back. Both also
pass the corrected paused Player collapse/show control. Ordinary iPhone27.1
pairings were refused, so that runtime-specific comparison remains absent.
Actual split-window behavior, Mac runtime and physical Duo remain unverified.
SourceKit cannot resolve the app-owned Swift fragment's Expo base outside the
generated app target; the successful Xcode build, not a standalone source scan,
is the compilation evidence.

## Reader-width revision (#344): implemented and verified

Remove the automatic reader-only 800-point cap and restore Margins to the
inset from the available reading window, rather than from a narrower centered
viewport. The independent Library, Settings and Player limits remain. Do not
introduce another reading-width control. Margins is now a percentage in [0,25],
per side, of the current available reading-window width. Persist one chosen
percentage per device across orientation and window-size changes, without
syncing it. This supersedes the initially discussed one-point step/range and
eliminates the smaller-window overflow branch; the saved percentage stays
valid at every width. Preserve EPUB internal indents.

Press-and-hold repeats slowly at first and then faster; release, cancellation,
Drawer closure and endpoints stop repetition, and release adds no extra step.
Only Margins gains this behavior, not Font Size. Every tap/repeat changes one
percentage point and the displayed value includes `%`. New installations use
5 percent. Acceleration changes repetition cadence, not the step size.

Migrate existing point-valued choices once, when the first post-update reader
has a measured available window width: round `100 * oldPoints / windowWidth`
to the nearest whole percentage and persist the converted choice. Exclude the
removed outer-column whitespace from this conversion. For example, 8 points
at width 1180 becomes 1 percent. Storage must distinguish old point values
from new percentages, including overlapping numeric values; later launches
and size changes must not convert a percentage again. No conversion can use
an unmeasured width or the removed 800-point cap.

Scope is confirmed. `src/renderer/margins.ts` owns validation, stepping, CSS
units and conversion. `appearance.marginsUnit` explicitly distinguishes
`points` from `percent` without changing the settings envelope or provider
enablement. `ReadingView` converts pending points only when shown with a
positive measured width, through the shell's existing atomic settings path.
Other writes preserve pending point values. The native reader cap is removed;
Library/Settings/Player caps remain. Body padding uses a validated percentage
of the iframe width; transitional point choices retain px until conversion.

`use-step-repeat.ts` repeats only the Margins stepper: first repeat after
400 ms, 200 ms cadence until 1200 ms held, then 75 ms cadence, always one
percentage point. It uses current committed props rather than a captured
initial value, cancels on press-out/inactivity/unmount and app backgrounding,
and suppresses the release click after a repeat. These are initial cadence
values for native acceptance, not platform measurements. Font Size remains
tap-only. Host tests cover the public storage/CSS/controls and the real
ReadingView measurement boundary. Native acceptance covers legacy conversion,
percentage geometry at landscape/portrait/narrow widths, real taps and held
input, handler-assisted closure during a hold, and same-character Browsing
through native width changes. Bounded local-speech evidence covers monotone cue
progression and visible highlights after resizing, not long-duration timing or
an exact Line Position tolerance. Independent ios-tester repeated the corrected
cancellation/closure tests; the parent additionally verified actual taps and
native Close in a 375-point window on the main-integrated tree. The pre-existing
highest-accessibility-size clipping in both steppers is tracked separately in
#347, not counted as passed. See the issue and engineering record for raw
results and the failed test choreographies that were replaced.

The diagnosis on the running iPad Air separates the two spaces: a 1180-point
landscape window contains an 800-point native Reader, WebView viewport and
iframe. Margins is 8 in storage and live props. Computed body side padding is
8, body side margins are zero, and Chapter I paragraphs start at x=8 with width
784 and no side margin or maximum width. The window-edge inset is therefore
(1180 - 800) / 2 + 8 = 198 points. This is the trial's cap, not a stale resize or
an ineffective CSS rule. The existing resize-continuity requirements below
remain in force when the viewport begins using the full available width.

## Duo side-safe-area batch (#346): implemented, scoped native verification

The unchanged app built with SDK 27.1 exposes a wider native window and a
trailing safe inset than its SDK 27.0 build. The baseline WebView spans the
whole window and the side status/back controls visibly overlap Document text.
The first repair uses current `react-native-safe-area-context` left/right
insets, not a device-name check or the baseline's measured 84-point value.

`ReadingView` pads its measured document area horizontally. Its `onLayout`
therefore passes the usable width to the existing Reader and Margins path;
renderer keys, settings and playback ownership stay unchanged. Applying the
padding inside the held view keeps the same rule while it is parked above the
navigator rather than making the portal's two destinations disagree.

The absolutely positioned Player accounts for those same insets independently:
its room begins/ends inside them, its row layout uses the usable width before
applying the existing cap, and its collapsed Reading Button clears the right
inset. A side-inset change also closes the short speed popover, even when the
window size and usable width stay unchanged but the reserved side moves.
`ReaderTitle` subtracts the side insets from its width allowance; UIKit still
owns placement of the navigation items. The loading/error overlay also clears
the side insets. Top/bottom placement is not redesigned in this batch.

Host component checks cover right, left, asymmetric and zero insets, changing
insets at a fixed window size, measured width propagation without remounting
the renderer, and unchanged Font Size/Margins. They double native layout.
Fresh SDK27.1 simulator evidence measures a466-point outer window with an84-point
right inset and a382-point WebView/DOM viewport, unchanged five-percent body
padding, text/Player controls clear of the rail, and a retained representative
Browsing anchor. The native popover correction, Library and Settings avoidance
are covered separately; ordinary iPhone27.0 and iPad26.5 retain usable Reader,
Library and Settings rendering and functioning collapse/show controls. An inset
switch at a fixed window size is host coverage, not an exercised native control.
These observations are not exhaustive pose, split-window, word-timing or
Following acceptance. The scoped repair in #346 is closed; automatic rotation
continues in #349, split-window behavior in #352, audio/Following verification
in #353, and Mac/physical-Duo coverage in #355/#356. Design0092 retains the
behavioral requirements. The unattributed inspection-time crash and recurring
simulator-volume resets are separately tracked in #357 and #358, not silently
counted as application fixes.

## Location reads do not consume the native resize (#359)

The side-effect-free capture in `keepPlaceOnResize` is not enough: epub.js's
own `reportLocation` schedules a frame that calls `manager.currentLocation`.
If native geometry changes before that frame and before the resize observer,
the getter's `updateLayout` changes `_stageSize` from951 to867 without updating
the iframe's locked width. The resize observer then sees867 already cached and
skips clear/redisplay. In the actual failure, stage/layout/viewSettings all
report867, both queues are empty, and connected live DOM iframes retain951px
styles,951 client/rect widths and951 locks. This is not stale-view measurement
or a failure of automatic window rotation. The reverse585-to669 mismatch was
also observed.

`readLocationWithoutReflow` adapts only non-paginated location reads, returning
the existing `scrolledLocation` mapping and storing it in the same manager
location field. The original paginated getter remains the fallback. Native
resize still owns layout, clear and redisplay; no delay, forced reflow, React
identity change or Reading restart is introduced. The adapter installs once
beside the resize and queue adapters in the actual highlighter program.

`test/renderer/resize-width.test.ts` executes the installed location-report,
getter, layout/resize and iframe size/lock/expand/reframe methods. It places a
location frame between the real DOM-width change and observer delivery, with
a single view sufficient to fail. The unguarded control reproduces the stale
951 lock against867 layout, and guarded shrink/grow and repeated multi-view
cases pass. Geometry, text mapping, CSS arithmetic and replacement-view
creation are explicit doubles, not a simulated full browser. Real-input stress
and active-display rendering remain separate runtime gates. Beta15 parent
and independent checks pass eight inner stress cycles plus the original Reader
and Library round-trips. Independent ordinary iPad verification measures
820↔1180 viewport/stage/iframe widths; ordinary iPhones on27.0 and26.5 retain
402-point reading widths and portrait app frames under the XCTest landscape
attempt. These are scoped simulator regressions, not Mac/physical-device or
sample/word-timing certification. Failed tool attempts remain in the record.
The final app is left paused with clean controls and the version line verified
through native Settings navigation.

## Earlier trial: limit the viewport, not the Document's body

`src/app/layout-widths.ts` holds the initial point limits: reader and Library
800, Settings 680, Player 600. Every surface remains full-width below its
limit. The reader's measured native container is capped; the same numeric
viewport continues to reach epub.js. Its identity remains the page generation,
not its dimensions, so changing size does not remount the Reading.

This deliberately avoids a second `max-width` rule on the EPUB's body: the
renderer, the publisher's tables and images, and the existing Margins all see
one page width. Margins is now the inset within that reading page. Extra
whitespace outside it is not the Margins setting. This supersedes ADR 0056's
screen-edge interpretation; the padding values, storage and stepping do not
change. Font Size and the WebView's patched mobile content mode stay intact.

Player row selection uses `min(window.width, player limit)`, not the full
window width. Otherwise a large accessibility font would select the compact
row because of room outside the actual Player. Its speed popover closes on
height changes as well as width/font changes because its bottom anchor moves.
The collapsed Reading Button stays at its existing window corner for this
trial. The renderer still reserves a vertical band for the Player, not a new
shape-aware occlusion model.

## Tablet/Mac placement revision (#361): implementation in progress

The [product revision](../design/0085-the-app-fits-ipad-and-mac-windows.md#drawers-stay-near-the-bottom-of-the-app-window)
requires every iPad/Mac Drawer near the bottom of the current app window,
allowing a small native-style gap but not the large blank region below the
reported floating panel. There are no close buttons, not a relocated cross;
Back, Share and other header actions remain. Touchscreen downward dismissal
remains required. Ordinary iPhone behavior is unchanged.

Drawer Height is 40–90 percent in ten-percent steps, default 50, of the
current app window's height rather than an internal native panel's available
height. Wide-window Drawers are horizontally centred and width-capped;
narrow windows use their available width. Exact width awaits visual
acceptance. Opening-height background interaction and undimmed preview
remain required. Mac must support both physical Escape and mouse/trackpad
downward grabber dismissal; accessibility escape alone does not meet the
keyboard requirement. Opening-height clicks outside operate the background
instead of dismissing the Drawer.

Expansion is nearly full current-window height with the same width policy,
and a dimmed, noninteractive background. Downward movement returns to the
chosen opening height, then dismisses. Rotation and resizing preserve the
open instance, expansion state and viewed list content: opening height
recalculates against the new window, while expanded stays expanded. No
close/reopen cycle or Reading pause/restart is allowed. A completed dismissal
resets the next opening to the chosen Drawer Height. Constrained-window
conflicts require a separate choice rather than an implicit exception.

These are agreed requirements, not runtime findings or evidence that the
current native presentation can satisfy them. The full product scope is
accepted. The next authorized phase is a bounded native proof: establish a
repeatable failing placement check, then test native sizing and input without
replacing the owner's Mac installation or delivering a formal implementation.
A failed native route returns for a choice; no custom fallback is selected.

### Source capability inspection, not runtime verification

At source revision `e27341c`, `src/app/drawer.tsx` supplies tablet/Mac
`onClose` to `DrawerTitle`, which creates the close `RoundButton` itself.
That cross is app-drawn, not a compulsory control added by Expo's sheet.
The body's `onAccessibilityEscape` is an accessibility action, not evidence
that a physical Escape key closes the Drawer.

Installed `@expo/ui` 58.0.27 presents a SwiftUI `.sheet` in
`ios/BottomSheetView.swift`. Its presentation modifiers expose detents,
selection, background interaction, grabber visibility and
`presentationSizing` (`automatic`, `fitted`, `form`, `page`, with fitted-axis
options). The exposed BottomSheet props and presentation modifiers do not
provide an explicit current-window-bottom attachment or numeric outer-chrome
width cap. This is a bounded API observation, not proof that native
presentation is impossible or a selection of a custom replacement. Actual
outer geometry, undimmed background input, Escape and pointer grabber behavior
still require native experiments on iPad and the actual iOS-on-Mac app path.
The component tests double native UI and cannot establish those facts.

### Native proof (#361): diagnosis established; candidate not accepted

The isolated iPadOS 26.5 / `@expo/ui` 58.0.27 run uses the shared app Drawer,
not a standalone approximation. On an 820-by-1180 window, repeated real
Library actions taps produce a native `_UIFormSheetPresentationController`
frame `{{120,585},{580,325}}`: its bottom is 910, 270 points above the window
bottom. The painted edge includes about one point of chrome/shadow per side,
so the screenshot oracle reports 581-by-327 and 269 points below it. Removing
every action row leaves the same native-sized card. Expanding the 1-by-1 Host
to its parent's full size also leaves the gap unchanged. This rules out the
contents and that anchor size as the cause of the reported placement.

An explicit 590-point detent changes height, not that bottom position.
The current fractional detent is therefore not a promise of window-relative
geometry: the native form's available sizing space is smaller. The outer
native card itself is floating; this is not RN padding inside an edge-attached
sheet. `drawer-placement.py` and its recipe retain the unattended failing
loop, including a return to the unchanged source after diagnostics.

Cold `.page` sizing, on either side of the other modifiers and with vertical
fitting alone, instead draws an 820-by-1138 native frame starting at 42, with
only a native large detent and no largest-undimmed identifier. The requested
fraction still appears in JS/selection metadata, which is not evidence that
it controls the native geometry. A bottom-gap GREEN here fails the agreed
height/preview requirements. Unconstrained both-axis fitting yields a 100-by-65
native card; its screenshot is outside the wide-card oracle, and separate
owned native measurements establish the unusable result.

A more promising native candidate combines both-axis fitted sizing, a
provisional 580-point ideal content width, an ideal height matching the
1180-point window, and explicit window-relative opening heights. Native
fitting still chooses the outer card; no translation or hand-positioned
card is used. At 40/50/90 percent, native opening targets are 472/590/1062;
the painted heights are 474/592/1064, width 581 and bottom gap 51. A valid
fitted-fraction native inspection measures 52 points below the chrome. This
native inset and the candidate width are accepted for implementation; the
59-point diagnostic cutoff itself is not an acceptance threshold. A later 90-percent native inspection
returns a zero frame and is invalid, not additional geometry evidence.

For that candidate, the opening background is actually white 255 and a real
Settings touch reaches Settings behind the Drawer. A runtime header override
removes the app cross for the candidate screenshot; it is not a source fix.
A separate real grabber sequence passes opening → large → opening → dismissed.
An expanded backdrop touch blocks the background action but dismisses the
Drawer; a live interactive-dismissal-guard attempt does not retain `large`.
Those failures remain unresolved, not waived by the pure grabber control.

This is portrait iPad geometry/input evidence only. Rotation, narrow windows,
long-list continuity, ordinary-phone regression and the actual Mac app's
Escape/pointer behavior remain unverified. No Mac package was built, replaced
or launched for this experiment, and no app source/version was changed.
The candidate's native inset and width were subsequently accepted for the
native implementation. The dated record and raw artifact inventory are in
the engineering log; temporary runtime overrides were discarded before the
pristine recheck.

### Beta19 implementation: native opening verified; remaining gates pending

The shared Drawer now requests the accepted fitted native ideal geometry,
using the current window height and a 580-point ideal-width cap, and explicit
window-relative opening heights. Ordinary phone sizing/modifiers remain
unchanged. The app-drawn close control is removed; Back, Share and page
actions remain. A tablet-only `interactiveDismissDisabled` modifier stays
present from the first presentation and changes value with expansion state.
This avoids the diagnostic experiment's late modifier-chain insertion.

The new shared-boundary tests first fail six of eight cases against the old
code, then all eight pass; the selected Drawer host suite totals 24 passing
tests. TypeScript passes, ESLint has zero errors and the pre-existing unused
`__r` warning, and source LSP import organization is applied. These are host
checks, not native acceptance.

On current source, without runtime overrides, the actual placement loop is
GREEN at the accepted painted 51-point gap and the native tree has no Close
control. The initial white background and real Settings/Library navigation
also pass. Two repeated real expanded-backdrop touches neither navigate the
background nor close the Drawer, but contract it from `large` to the explicit
590-point opening detent. The assertion requiring it to stay `large` therefore
fails reproducibly. That native contraction is now explicitly accepted:
the revised check must assert return to the opening height, a retained Drawer
and no background navigation, rather than retaining `large`. The old failed
assertions remain in the record and are not called flaky. A separate Mac
probe is approved with display name `OpenReader Drawer Probe` and identifier
`top.xujialiu.openreader.drawerprobe`, starting empty without replacing or
reading the owner installation. Escape/pointer input, constrained windows
and independent final tester acceptance remain pending. Beta19 is an in-progress source change,
not a completed delivery or a claim that #361 is resolved.

The following section records the earlier implementation; its system-chosen
placement is not acceptance of the new requirement.

## The phone's sheet correction is not tablet geometry

The phone retains `drawerDetentHeight` and all its measured floating-card
corrections (ADR 0066). Tablet/Mac presentation instead uses a native fraction
of the available panel height. The active detent is tracked explicitly, so an
expanded panel stays expanded through resizing and a completed dismissal
resets the next opening to the owner's choice. `presentationBackgroundInteraction`
remains enabled through that opening detent. Tablet/Mac headers also have a
labelled close button, without removing Back or the existing header action.

This uses the existing system sheet, as documented by
[Expo 57 BottomSheet](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/bottomsheet/)
and its [presentation modifiers](https://docs.expo.dev/versions/v57.0.0/sdk/ui/swift-ui/modifiers/).
It does not assume that the iPhone's measurements prove iPad/Mac appearance.
Undimmed preview and a usable close control are device-verification gates; a
native presentation that fails either returns to the owner rather than
silently becoming a dimmed modal. Runtime verification is recorded on #319.

## Capture the current passage before epub.js clears it

In the bundled epub.js, the continuous manager's `resize` calls `clear()`
before emitting `resized`. `Rendition.onResized` then redisplays the explicit
CFI, or `rendition.location.start.cfi`. That stored location is only the last
reported viewport: during scrolling it can refer to an earlier passage.
Capturing a location in the `resized` listener is too late; the views are gone.

`keepPlaceOnResize` wraps the manager's resize entry. Before destruction it
reads the live viewport with `manager.scrolledLocation()`, then maps the upper
**visible** edge with `manager.mapping.page` when the floating bar covers the
viewport's top. A section wholly under that bar is passed over. It converts
the resulting mapping with `rendition.located()` and passes its start CFI
through the existing resize/redisplay path. An explicit target wins. If a
rapid second resize finds no views yet, the previously captured location is
kept. Capturing does not emit a Reading Position, a seek, or a Browsing change.
The existing section-level blank-open recovery remains for a page with neither
a live nor a recorded location.

After the normal redisplay completes, Following settles again, after epub.js's
own `moveTo` rather than before it. The existing `settle` guard refuses to move
a Browsing page. Its upper visible text remains the resize anchor, while
Following returns to Line Position. A CFI preserves text, not an identical
pixel coordinate through reflow.

Do not replace that mapping call with `rendition.currentLocation()`. It calls
`manager.currentLocation()`, which first calls `updateLayout()` and overwrites
`_stageSize` with the new native container size. The original resize then sees
no size difference, skips `clear()` and leaves old-width iframes. This was
missed by rotating a 13-inch iPad: both orientations kept the 800-point cap.
The first real native corner drag exposed a 375-point viewport holding an
800-point iframe. The first unit double also hid it by replacing the manager's
whole location getter rather than only its visible-text mapping.

`test/renderer/resize-place.test.ts` now executes the installed manager's actual
resize, currentLocation and updateLayout, plus rendition location/redisplay
methods. Only browser geometry, visible-text mapping and applying layout to
views are doubled. Native container size changes before the resize observer
runs, as on device. This regression fails the first wrapper because `clear`
and redisplay never occur, and passes the side-effect-free mapping call.
The unwrapped stale-location control and repeated-resize cases remain. The
header-coverage regression also distinguishes the raw viewport start from the
upper visible text. Measured on the same stable page, raw start and a mapping
at y0 named `/114/1:0`, while a mapping at the 54-point header boundary named
`/116/1:70`, whose actual top was54.5. Retaining an initially occluded CFI does
not satisfy the visible-passage contract, even with correct resize and settle.

A second runtime finding separated CFI restoration from visual placement:
a wide-to-narrow resize redisplayed the correct `/162/1:210` target, but it
ended near the bottom, not the top. The default manager moves to the CFI
before the continuous manager's `fill()` appends its neighbour, so a target
near a section's end can clamp at the available scroll limit.

After the resize display/fill completes, `restoreResizeAnchor` measures the
same CFI in the new contents and nudges it below the visible navigation bar.
Like Following's settle, it remeasures for at most `SETTLE_FRAMES` and exits
after three stable frames. It does not display again or send a speech/position
message. The CFI remains the resize anchor after that short loop ends: a native
drag can deliver another resize even after several quiet frames. Recapturing
the raw viewport start then selects text hidden above the restored line under
the navigation bar and walks backwards on every resize. A user touch, mouse,
wheel or keyboard action on the page, a fresh Browsing choice or Return
releases the retained CFI; the next resize captures the newly browsed text.
A fresh resize invalidates the old frame loop without discarding its target.
It never competes with Following. `resize-anchor-settle.test.ts` exercises the
clamped-target case, late frame movement, cancellation and the finite budget.

Rotation, actual width-changing resize, highlighting and speech checks are
separate runtime gates. Passing rotation at a constant capped width is not
proof of width reflow; their results are recorded on #319.
