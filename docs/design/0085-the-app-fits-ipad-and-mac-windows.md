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

## A wider window, not larger letters

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

## Drawers follow the device

The iPhone keeps its existing Drawer behavior. On iPad and Mac, Drawers prefer
the system's presentation rather than copying every phone measurement and
gesture. They have a visible close control that can be used with a mouse as
well as a finger. Their opening height is the owner's chosen share of the
space available to the system panel, not a promise about its distance from
the bottom of the whole display.

At the opening height, Appearance must still let the owner judge changes on
undimmed text behind it. A system presentation that cannot provide that, or a
usable close control, must come back to the owner for a choice; it is not
permission to silently abandon the preview. This makes decision 0066's exact
phone geometry and swipe-only dismissal phone-specific. It does not turn a
Drawer into a permanent sidebar.

## The same passage through a size change

Rotating or resizing does not pause, restart or repeat the Reading, change the
chosen Font Size, or write a new Reading Position. A page that was Following
continues to follow the speech at the owner's Line Position after reflow.

While Browsing, the text at the upper visible edge is the anchor: after the
lines rearrange, that passage stays near the top. The page does not jump back
to speech or to the chapter's beginning. The promise is about the same text,
not identical pixels through a change in line breaks. Return still goes back
to the Reading, and only speech moves its saved Reading Position.
