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

## Duo scene orientation exception (#346): native verification pending

The phone and tablet plist orientation arrays stay unchanged. The focused
`with-duo-scene-orientation` config plugin extends the upstream generated
SceneDelegate subclass; it does not reintroduce the retired scene-adoption
plugin or create another window/React root. It refuses an unexpected subclass
instead of overwriting another native policy. The existing Expo AppDelegate
also implements the legacy orientation callback; a narrow owned override
forwards only a positively identified Duo scene to the same policy, otherwise
calling the original superclass implementation and preserving its subscribers.

Built with the UIKit 27.1 SDK, the delegate attaches a public
`UIHingeInteraction` to its phone scene's window. Only a non-null hinge update
records positive evidence, scoped to the scene session. Null updates during a
hierarchy/display change do not revoke that evidence. The observation is not a
layout input: neither angle, posture, window dimensions nor a model-name guess
selects a layout or the orientation exception.

On iOS 27+, the scene-supported-orientations hook returns the existing
per-idiom plist mask, adding landscape only for a phone scene with matching
positive evidence. The supported-mask refresh and geometry request use public
UIKit APIs. The scene-only build reported mask30 while the root controller
still reported6 and genuine device rotations did not change app geometry.
The legacy callback alignment is a separate native verification step, not a
claim that display-driven landscape placement already proved rotation. A new
root container is deferred while the existing controller/delegate path is
checked, avoiding unnecessary reparenting of the React view. Ordinary phones retain their configured fallback; iPad/Mac keep
their existing tablet mask. Older runtime/build combinations use the fallback
without hinge observation; only a fresh SDK 27.1 build can establish Duo-policy
acceptance. Runtime geometry rejection is not a successful rotation.

This avoids a global portrait root-controller default (which would also change
iPad startup) and avoids treating hinge API availability as hinge hardware.
The upstream scene still owns cold URL delivery and lifecycle forwarding;
connect, active and disconnect overrides call their superclass implementations.

Generation tests cover the installed Expo template, idempotence, owned-block
updates and refusing conflicting native code, alongside unchanged plist masks
and upstream AppDelegate factory/lifecycle content. They are not native compilation or orientation evidence.
The generated file must compile and cold-start on SDK 27.1; actual scene/root
masks and geometry must be checked on Duo and an ordinary phone on 27.1, with
older-runtime and iPad controls. SourceKit cannot resolve the app-owned Swift
fragment's Expo base outside that generated app target; the Xcode build is the
compilation gate.

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

## Duo side-safe-area batch (#346): implemented, native verification pending

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
the renderer, and unchanged Font Size/Margins. They double native layout;
actual inset delivery through the portal, WebView/iframe widths, native title
placement, side-control avoidance and passage continuity require fresh native
verification. Broader Duo acceptance remains open in design 0092 and #346.

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
