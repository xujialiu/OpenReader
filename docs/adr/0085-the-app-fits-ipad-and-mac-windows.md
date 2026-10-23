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
`orientation: 'portrait'` remains unchanged. The installed Expo 57 writers
produce device families `[1, 2]`, portrait and upside-down portrait for the
base orientation key, and all four orientations for
`UISupportedInterfaceOrientations~ipad`. The latter comes from Expo's
`RequiresFullScreen` plugin independently of the phone's orientation.
`test/app-config.test.ts` runs those installed writers rather than repeating
that mapping in an app-owned implementation.

The scene plugin still declares `UIApplicationSupportsMultipleScenes: false`.
Resizable is not multi-window. Nothing introduces a second Reading, another
playback owner, a sidebar, facing pages, or a Mac Catalyst target.

Apple distinguishes fixed-size iPhone apps from iPad apps supporting
multitasking in [Running your iOS apps in macOS](https://developer.apple.com/documentation/apple-silicon/running-your-ios-apps-in-macos).
The exact Expo configuration is documented in
[SDK 57 app configuration](https://docs.expo.dev/versions/v57.0.0/config/app/).

## Limit the viewport, not the Document's body

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
