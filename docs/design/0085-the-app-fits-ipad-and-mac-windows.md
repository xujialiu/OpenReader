# The app fits iPad and Mac windows

## What was decided

OpenReader is to support iPad as well as iPhone, and a window that the owner can
resize on an Apple silicon Mac. The owner approved the following as a first
version to try, with dimensions and placement open to adjustment after using
it. Implementation and device verification are tracked in issue #319.

The Library still leads into the reader. The Player and the Drawers keep their
existing entry points. A larger window does not introduce a permanent Library
or Contents sidebar, or facing pages. The first task is to make the existing
reading experience work at different sizes, not to replace it with a second
interface.

The iPhone stays in portrait. The iPad supports portrait and landscape, and the
window sizes the system allows. On Mac, the owner can drag the window larger
or smaller above a usable minimum size; that minimum is still to be settled.

Decision [0092](0092-duo-keeps-the-current-reading-task.md) agrees a Duo-specific
exception: both displays follow the orientations and windows the system
permits, without deliberately broadening ordinary iPhone orientation settings.
That exception is an agreed requirement pending implementation and verification,
not evidence that the existing portrait configuration provides it.

There is one OpenReader window. It can sit beside another app, but this work
does not add a second OpenReader window or a command to open one. The existing
rule of at most one Reading at a time remains unchanged.

## Why

The owner can download OpenReader on Mac but cannot enlarge its phone-sized
window. An iPad-sized reading experience and a resizable Mac window address
that limitation without asking the owner to learn another way of reaching the
Document, its Contents or its controls.

The earlier release deliberately kept only the tested phone layout. Keeping
the iPhone in portrait preserves that experience while the new work is checked
on iPad and Mac.

A resizable window and several windows solve different problems. Reading
beside another app needs only the former. Several OpenReader windows would
also need rules about which window controls the Reading and what each window
remembers, none of which is necessary to enlarge the page.

## What was given up

- **A dedicated large-screen arrangement now.** A permanent sidebar could make
  switching Documents or browsing Contents quicker, and facing pages could
  use a wide window differently. Both change the reading interface rather
  than merely let it fit the available space, so neither is part of this work.
- **Landscape on iPhone.** It could be useful on a phone held sideways, but it
  would add another layout to validate without addressing the owner's Mac
  window problem.
- **Several OpenReader windows.** The owner cannot keep two Documents open in
  separate app windows as part of this change. The benefit of doing so is
  deferred rather than bundled into support for a larger page.

## Revision: Margins controls the available reading window

The revised direction removes the automatic narrow reading column. A wider
window gives the text more room, and Margins controls the space at both sides
rather than the space inside a second, invisible page. Font Size does not grow
with the window. The Player, Library and Settings keep their separate widths.

The trade-off is longer lines in wide windows. Keeping a narrow default with
another width control was not selected: it would leave two controls deciding
what looks like the same margin. Margins is a percentage from zero to 25,
applied separately to each side of the available reading window. At the upper
limit, half of the window remains for the Document. The same chosen percentage
is kept across orientations and window sizes on a device, without syncing it
to another device; the actual space grows and shrinks with the window. This
replaces the initially discussed fixed distances and removes the need to clamp
a saved choice when the window narrows.

Holding a Margins button repeats slowly at first and faster after holding it
longer. Releasing or cancelling the gesture, closing the Drawer or reaching
an endpoint stops it; release adds no extra step. Font Size controls are not
changed. The Document's internal indents and centred content remain intact.
Each tap changes one percentage point, shown with a percent sign. Holding a
button increases the repetition speed, not the size of each step. A new
installation starts at five percent.

An existing fixed-distance choice is converted once, using the available
reading-window width when a Document is first opened after the update, rounded
to the nearest whole percentage. Only the chosen distance is converted, not
the automatic outer whitespace being removed. The converted percentage is
then kept across later rotations, resizing and launches. This preserves the
old choice as closely as whole percentages allow, rather than treating an old
number as a percentage or resetting every installation to the new default.

The revised behavior is implemented and verified on iPad, including rotation,
a narrow window, held adjustments and keeping the passage in view. The
highest accessibility text sizes still expose clipping in both existing
steppers; that separate accessibility limitation is not resolved here.

## Earlier trial: a wider window, not larger letters

The following reading-width policy describes the earlier trial, superseded by
the revised direction above. The separate control and list widths still stand.

The reading page has a maximum width and is centred in a wide window. A narrow
window uses the space available; a wide one gains whitespace outside the page
rather than ever-longer lines. Font Size remains the owner's choice and does
not grow with the window.

Margins now means the inset from the edges of this reading page, not all the
whitespace between the text and the window edges. Changing it still moves the
text even in the widest window. This revises decision 0056, which deliberately
accepted longer tablet lines to keep the screen-edge distance literal. What
is given up now is that literal distance: the extra outer whitespace is chosen
by the app rather than by the Margins control.

The Player sits at the bottom centre, with its own maximum width, so its
buttons do not spread across a large display. It still floats over the page;
showing or hiding it does not move the text. For the first version, the
collapsed Reading Button stays at the existing bottom-right window corner.

Library and Settings keep their single-column lists and navigation, centred
and limited to comfortable widths. They need not be as wide as the reading
page or the Player. None of these limits prevents a narrow window from using
all its available space.

## Drawers stay near the bottom of the app window

The revised requirement in issue #361 is agreed. Its implementation is
under verification; agreement is not full device acceptance. Every Drawer on iPad or Mac must rise from the bottom of the
current app window: Library and Document actions, Contents, Voice,
Appearance, Download and Word Lookup all follow the same rule. A small gap
in the device's own style is acceptable; a large blank region below a
floating Drawer is not. This replaces the trial's permission for the system
to choose an unrelated position within the window. The ordinary iPhone
keeps its existing Drawer behavior.

At the opening height, what the Drawer does not cover stays undimmed and in
use. Appearance must still let the owner judge changes on the text behind it,
and a Word Lookup must leave the visible selection within reach. Correcting
the position is not permission to turn a Drawer into a dialog that darkens
and blocks the page.

There are no close buttons anywhere on an iPad or Mac Drawer; the cross
is removed, not moved to the other corner. A touch drag down still closes
it. This does not remove Back, Share or other actions from the header.
On Mac, both Escape and dragging the top grabber down with a mouse or
trackpad must provide a way to close the Drawer. Clicking outside at the
opening height operates the page instead of closing the Drawer.

Drawer Height is the chosen share of the current app window's height,
not the physical display or a smaller system panel within the window.
The default remains 50 percent, with choices from 40 to 90 percent in
ten-percent steps. The same choice applies to every Drawer.

A wide-window Drawer is horizontally centred and limited to a comfortable
width, rather than stretched across the whole display. A narrow window
uses its available width. The accepted native candidate uses a width of about 580 points when there
is room; a narrower window uses its available width.

There are two resting heights. Dragging up expands the Drawer to nearly
the current window's full height without abandoning the width limit.
The remaining background is then dimmed and cannot be operated. Dragging
down returns to Drawer Height; dragging down from there closes it.

Rotation and window resizing retain the open Drawer and its current state.
At Drawer Height, its height is recalculated from the new window. An
expanded Drawer stays expanded. The list keeps the passage or entries
being viewed rather than jumping back to its beginning. Resizing must not
close and reopen the Drawer, pause or restart the Reading. Closing and
opening again returns to the chosen Drawer Height.

Keeping the device's own appearance remains the preference where it meets
these requirements; whether it can do so has not been established. The
native route and candidate width are accepted for implementation, with
remaining behavior and platform verification still required. If a
constrained window cannot accommodate the agreed behavior, that conflict
must return for a choice rather than silently changing the height rule,
blocking the opening-height background or adding a close button.

The system-drawn candidate's width and visible space below it are accepted
for the native route. On the tested portrait iPad the system leaves about
52 points below it; that is an accepted native margin, not a fixed distance
to impose on every window. The candidate retains the initial preview.
Acceptance of this shape is not evidence that the other window and Mac
requirements have been implemented or verified. In the native candidate,
clicking the shaded background while fully expanded returns the Drawer to
its opening height without operating the page or closing the Drawer. That
native contraction is accepted; an outside click need not leave the Drawer
fully expanded. The initial-height background remains directly usable.

### Earlier trial: position chosen by the device

The earlier trial let iPad and Mac use the system's own panel presentation,
with a visible close control for a mouse as well as a finger. Its opening
height was a share of the space available to that panel, not a promise about
its distance from the bottom of the app window. That position policy is
superseded by the revised requirement above.

## The same passage through a size change

Rotating or resizing does not pause, restart or repeat the Reading, change the
chosen Font Size, or write a new Reading Position. A page that was Following
continues to follow the speech at the owner's Line Position after reflow.

While Browsing, the text at the upper visible edge is the anchor: after the
lines rearrange, that passage stays near the top. The page does not jump back
to speech or to the chapter's beginning. The promise is about the same text,
not identical pixels through a change in line breaks. Return still goes back
to the Reading, and only speech moves its saved Reading Position.
