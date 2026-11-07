# Duo keeps the current reading task

## Agreed scope

Issue #346 starts with basic compatibility on Duo's outer and inner displays and continuity when the available reading space changes. It does not resume the earlier, deferred large-screen redesign. Facing pages, permanent Contents, a Companion and separate controls for a partly folded display are not assumed requirements.

The existing reading, listening and lookup experience comes first. A necessary visible change returns for a decision with the specific problem it solves. Ordinary iPhone, iPad and Mac behavior must not be silently redesigned.

These requirements remain the acceptance boundary. The side-space and selection-continuity repairs are implemented and have simulator evidence. Issue #346 is closed for that scoped delivery, with the unresolved behavior and missing verification transferred to independent issues below. Closure does not mean complete Duo support has passed or that the remaining requirements are waived.

## The current task survives a layout change

While Browsing, the passage being viewed remains in view after the lines rearrange; the page does not return to the Reading merely because the display changes. As in decision 0085, the text at the upper visible edge is the anchor, not an identical pixel position or line break.

While Following, the page continues to follow the spoken text at the owner's Line Position. A layout change does not restart, repeat or pause a playing Reading, or start a paused one. Only speech moves the Reading Position; rearranging the page does not write a new one.

Open Contents, Word Lookup and Text Translation retain the current task, selection, results and pending request through a layout change. Rearrangement alone does not ask a service again. This continuity applies within the current use of the reader; it does not add restoration of lookup tasks after leaving the app and starting it again.

## What was given up

A dedicated large-screen arrangement could put more controls and supporting text beside the Document, but it would also change how the app is used before basic compatibility is established. That redesign is not a prerequisite for this work.

Returning to the spoken sentence after every display change would be simpler to explain, but would discard the passage the owner deliberately browsed to. Browsing and Following therefore keep their distinct meanings.

## Acceptance boundary

Fresh native Duo simulator verification is required for this work. Physical Duo verification is not a closure gate; an untested physical device must be reported as untested, never as accepted on the strength of simulator results.

Ordinary iPhone and iPad require relevant regression checks. Mac reporting must distinguish review from actual use of the app. A confirmed regression on any of these devices is not waived by a narrower test scope.

Platform constraints return for a decision rather than silently weakening the agreed behavior. Specific necessary changes to visible controls remain open; the orientation, partly folded and transient-surface boundaries below are agreed requirements, not verified behavior.

## Duo follows the available window

Both Duo displays support the orientations and app windows the system permits, including split view. This is a Duo exception to decision 0085's portrait-phone policy, not a request to enable landscape on every ordinary iPhone. Ordinary iPhone orientation settings are not deliberately broadened; iPad and Mac retain their existing rules. Any window variation the system already allows must still remain usable. If the platform cannot preserve this boundary, the constraint returns for a decision.

Partly folded use is part of basic acceptance, including transitions into and out of it. Text and necessary controls must occupy usable areas. This does not prescribe a dedicated mode, a top reading pane with bottom controls, or an arrangement inferred from the fold angle. If meeting the requirement needs divided reading and control areas or another visible rearrangement, that concrete choice returns before implementation.

Limiting acceptance to fully open and fully closed use was not selected: it would leave an ordinary intermediate way of holding the device outside the compatibility promise.

## Tasks survive; short menus may close

A layout change preserves whether the Player is expanded or collapsed, Tap Lock and Sleep Timer. It preserves an open Drawer, its list position and selection, lookup work, Library multi-selection, and text being edited together with the editing position.

Short-lived option menus, including the speed menu, may close when their anchor moves. Their chosen values remain unchanged and their entry points remain reachable. Keeping every short menu open was not selected: it adds a stronger presentation requirement without preserving additional work.

The app does not deliberately end editing merely because the layout changes. If the system dismisses the keyboard, the input and editing position remain. Appearance at its opening height must continue to show usable, undimmed Document text for judging changes.

These promises concern layout changes alone. Explicit dismissal, leaving a page and changing Document retain their existing lifecycle rules; this does not introduce a stack of supporting tasks or cross-Document task restoration.

## First establish what the current app does

The first stage is a bounded native investigation of the current app on a new, isolated Duo simulator. It measures both displays, rotation, split view and partly folded use, including different fold states with the same window size. It checks reading and listening continuity, completed and pending lookups, Drawers, editing and Appearance preview.

The result must distinguish passed behavior, observed failures and untested cases. Any necessary visible changes return with that evidence for a decision before production implementation. Minimal reversible diagnostic instrumentation is permitted; it does not authorize a production layout change.

This stage uses existing tools and isolated test data. It does not replace installed owner applications, upgrade the tools or operating system, change the machine's global tool selection, or publish an app. Missing tools and unresolved platform limits stop the affected checks rather than weakening acceptance.

## First repair batch: keep text and controls clear of the system

The first approved repair addresses system controls covering the Document at the side of the display. The reading page, its custom title and the Player use the space actually available beside those controls, including when the occupied side changes. The collapsed Reading Button stays within that usable space too. The reserved distance follows the system rather than being fixed for one device or pose.

Font Size stays unchanged. Margins remains the chosen percentage of the usable reading area's width, equally on each side within that area. The Player retains its separate width limit. Ordinary devices without a side reservation keep their existing layout; this batch does not change navigation, the orientation policy or the meaning of any setting.

The trade-off is less room for text and controls when the system occupies a side. Letting text run underneath those controls, or leaving a fixed blank strip even when it is not needed, was not selected.

This is a narrow repair, not acceptance of complete Duo support. The apparent Drawer-dismissal fault was not established by its test and is not part of the repair. Representative task-continuity and ordinary-device checks have passed; unverified combinations and the remaining shortcomings are tracked independently rather than keeping the completed repair batch open.

The speed popover is included in safe-area avoidance. It keeps the existing native bubble, trigger and stepper behavior, but may sit beside the number toward the Player's interior instead of above it when a side is reserved by the system. Ordinary windows without a side reservation keep the existing placement. Letting the bubble extend into the reserved side strip was not selected. At larger text sizes the bubble's existing wrapping controls may take more height when there is less room beside the number; the text is not made smaller to force it into one row.

The Library and its Search, selection actions and return-to-Reading button also stay beside the system's reserved side area. Settings uses that same usable area for its existing cards and fields. Navigation, selection, keyboard and editing behavior is unchanged; this extends the same avoidance rule, not a new Library or Settings layout.

## Remaining work after the scoped delivery

- #348: folding makes the expanded Player grow from two rows to four and take too much reading space.
- #349: automatic rotation with the device has not passed.
- #350: the selected passage's visible marking and adjustable handles after folding need verification.
- #351: the final result of a lookup that finishes across a fold needs visible confirmation.
- #352: actual split-window resizing and task continuity need verification.
- #353: audio progression and word-level Following through display changes need complete evidence.
- #354: undimmed Appearance preview needs a controlled before-and-after comparison.
- #355: the current changes need actual Mac regression coverage.
- #356: physical Duo coverage remains separate and is not a condition for closing the simulator repair batch.

The new compact-Player issue does not revive the deferred Companion or two-column redesign. Its requirement is to keep reading space useful while preserving readable, reachable controls.
