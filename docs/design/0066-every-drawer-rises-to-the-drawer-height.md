# Every drawer is the phone's own, and rises to the Drawer Height

_The engineering half of this decision is
[ADR 0066](../adr/0066-every-drawer-rises-to-the-drawer-height.md). Issue #117.
It revises what decisions [0026](0026-a-coherent-reading-interface.md),
[0027](0027-whole-document-offline-narration.md),
[0042](0042-the-app-follows-the-phones-own-look.md) and
[0051](0051-looking-up-words-and-translating-text.md) say about drawers. The
cards of [decision 0041](0041-one-look-for-settings-and-the-speed-control.md)
stay on the Settings pages and do not come into the drawers._

## What the owner saw

Every drawer was drawn on its own. Two drawers a tap apart, Appearance in the
reader and the same book's actions, put their titles at the same place and
then disagreed about everything under them: how far in a row's words start,
how tall a row is, and whether there is a line between rows, or under the last
one. Across the app's drawers there were four different distances from the
edge and four different row heights. None of them looked like the phone's own
drawers, which the owner holds the app up against (decision 0042).

Each drawer was also as tall as whatever it held. Rename was a short strip,
Download nearly reached the top of the screen, and anything added to a drawer
made it taller and covered more of the page. The highlight colours, which are
to go into Appearance next, would have done exactly that.

## Every drawer is the phone's own

Every drawer in the app becomes the phone's own: Contents, Voice, Appearance and
Fonts, a book's actions with Rename and Download, and the drawer a looked-up
word opens in. The phone moves it, rounds its corners and answers
a swipe on it. The app fills it.

They are alike, and in the phone's style. What a drawer is made of, its two
heights, how far its words stand in from the edge, how tall a row is, where a
line between rows starts, and its colours, is set down once for the whole app
and taken by every drawer from there. A new drawer, or a new row in an old one,
is drawn to the same values without anyone choosing them again.

## Two heights

A drawer rests at one of two heights.

- **The Drawer Height.** The owner's own, chosen in General, in the card with
  the Theme, as a second row called Drawer height. It is a share of the whole
  screen, measured from its bottom edge, from 40 % to 90 % in steps of ten. It
  starts at 50 %, half the screen. It is the same for every drawer, and like
  every setting it belongs to this phone.
- **Nearly full.** The drawer's top comes up almost to the top of the screen,
  below the clock and the battery, as the phone's own drawers do.

A drawer opens at the Drawer Height every time, whichever height it was left
at. Swiping up on it takes it to nearly full; until then, the swipe grows the
drawer rather than moving the list in it, and only once it is full does a list
scroll. Swiping down does the reverse: a full drawer goes back to the Drawer
Height, and a drawer at the Drawer Height closes.

What does not fit scrolls inside the drawer. A drawer is never taller than its
height because of what it holds.

Contents opens at the chapter being read rather than at the top of the book, and
the phone grows a drawer from its list only when the list is at its top. So a
swipe up on the chapters scrolls them, and Contents is made full by dragging its
title.

## One drawer at a time

Only one drawer is open at once, anywhere in the app. Because the page stays in
use under a drawer, the buttons that open other drawers can still be pressed: the
book's actions while Contents is open, say. Pressing one puts the open drawer
away and brings up the one asked for. The phone shows only one of its drawers at
a time, and the first version showed nothing at all, then left the button dead
until the book was closed and opened again.

## The page behind stays in use

At the Drawer Height the page above the drawer is not dimmed, and it still
answers a touch. The owner can watch the page change as a font, a size or a
margin is chosen, and when the highlight colours arrive they will be chosen
against the very page they colour. While the lookup drawer is at the Drawer
Height, the selection on the page above it stays within reach. When it is full,
the page cannot be touched, where the old lookup drawer's tallest height left a
strip of the page in use.

A full drawer covers almost all of the page, and the little that shows above it
is dimmed, as the phone does, and does not answer a touch.

A tap outside a drawer no longer closes it. At the Drawer Height the tap goes to
the page; above a full drawer it does nothing. A swipe down closes a drawer.

The page does not move to make room for a drawer. When a drawer covers the line
being read, it is left covering it. The page is in use, so the owner can push it
up to see the line, or swipe the drawer down; moving the page by itself whenever
a drawer opened was more than this was worth.

## The top of a drawer

Every drawer's title is centred above it, as the phone centres a title over a
page of settings. The one exception is the first page of a book's actions,
which keeps the book's name on the left, with Share at the right of it
(decision 0059).

A page reached from another page in the same drawer has a round back button on
its left, drawn like the phone's: Fonts from Appearance, and in a book's actions
Appearance, Fonts and Download from the menu. Until now only Fonts had one; the
other pages could be left only by closing the drawer and opening it again.

There is no close button anywhere, because a swipe down closes a drawer. That is
how the phone expects its own drawers to be put away.

## What is in a drawer

Rows sit straight on the drawer, one under another, as the chapters do in
Apple Books' table of contents: no box around them, the words about a
finger's width from each edge, and a thin line under every row, the last one
included. A one-line row is the same height everywhere, and a title too long
for one line is shown in full over as many lines as it needs, so a row grows
rather than cutting its words short. The words are a little smaller than the
app's body text, as Books sets them.

The first version put the rows in rounded cards set in from the edges, like the
app's Settings pages. The owner turned it down on the phone, beside Books: the
card was a frame around the list for nothing, its inset and the card's own
margin together pushed the words a third further from the edge than Books puts
them, so fewer of them fitted on a line, and a long chapter title was cut off
with an ellipsis. The Settings pages keep their cards; the drawers do not use
them anywhere.

Where the phone can draw a row itself, a font, a size, the margins, the
alignment, a short menu, it does, to the same distances from the edge. Where it
cannot, the app draws the row to the same values, so the two kinds sit together
without a seam.

_Revised in [decision 0068](0068-the-highlight-colours-are-the-owners.md): the
app's own marks in a drawer, said below to be amber, follow the colour of the
spoken word's mark._

The colours are the app's own, as everywhere else (decision 0042). In the light
theme a drawer is the colour of a Settings page. In the dark theme it is one
step lighter than the page: a Settings page in the dark is the colour of the
book's own page, and a drawer that colour could not be told from the page it
rose over. The phone's own dark drawers are lighter than the page for the same
reason. The colours are solid. The drawer follows the app's Theme, not the
phone's. The app's own marks in it, a chosen row or a check, are amber. The
phone's own controls and dialogs over a drawer keep the phone's colours. Given
the app's amber, the phone drew Rename's Save button in amber whether or not
it could be pressed, so a blank name looked as if it could be saved.

## Drawer by drawer

- **A book's actions.** Appearance, Rename and Download are rows of the list,
  and a row that opens a page carries an arrow at its right. Delete, which the
  Library offers and the reader does not, is in red, the last row.
- **Rename** is no longer a page of the drawer. It is the phone's own small
  dialog with a field in it, rising over the drawer: Cancel goes back to the
  menu, Save renames the book and closes the drawer, and Save cannot be pressed
  while the name is blank, which the phone shows by greying it. The owner asked
  for a dialog: a new name is one short answer, and the phone asks for one of
  those in a dialog, not on a page. The field starts with the current name and
  the cursor at its end, not with the name selected. The phone's own dialog
  will not select it, and the owner chose the phone's dialog over a copy of it
  that could.
- **Voice.** The rows of small buttons for the provider and the language become
  two rows, Provider and Language, each opening a short menu, above the list of
  voices. A menu row reaches only as far as its words: a menu over a row as
  wide as the drawer took the whole drawer off the screen while it was open.
  Appearance's Alignment is the same kind of row.
- **Download** is laid out as Contents is, at the owner's word: the same rows,
  titles in full, the same indent and the same mark for the chapter being read,
  with each row's own circle, check or ring at its right. Manage downloads
  becomes a page of its own, titled Manage, with the back button, reached from
  the line that counts the chapters downloaded; the link that read Back to
  downloads goes. Select all, and
  Deselect all, move up into the drawer's top, on the right. Download selected
  stays fixed at the bottom of the drawer whatever the list is scrolled to.
  Pause all, and Resume all, go on the line that says how the download is
  going.
- **The lookup drawer** takes the same two heights. It used to have its own, just
  under half of the page and nearly the whole of it. Its switch between
  Dictionary and Translation is the phone's own two-part switch, centred where a
  title goes, and its down-arrow close button goes. A drag that starts on the
  switch does not move the drawer; a drag from the grabber or beside the switch
  does.

## What it costs

- **Fewer rows at once.** At 50 %, Contents and Download show fewer chapters
  than the drawers they replace, which were taller than half the screen. The
  owner can raise the Drawer Height, or swipe a drawer up when it is open.
- **The first swipe grows the drawer.** In a long list at the Drawer Height, the
  first swipe up makes the drawer full instead of moving the list, and only the
  next one scrolls. That is how the phone's own drawers behave, and the app
  cannot ask them for the other way round.
- **A tap outside does not close.** At the Drawer Height a tap on the page lands
  on the page. Putting a drawer away is always a swipe down.
- **A covered line stays covered.** At a tall Drawer Height a drawer can hide the
  line being read, and nothing moves it into view.
- **What the phone draws, it draws its way.** The corners, the
  movement and the dimming are the phone's, and they change when the phone's
  look changes. The rows the app draws itself match the phone they were
  measured on, and fall behind if the phone changes them (decision 0042).

## Turned down

- **Keeping the app's own drawer, with the phone's values copied in.** Every
  drawer would have looked alike, but the way it follows a finger, slows and
  settles would only ever have been an approximation of the phone's, and it
  would fall further behind each time the phone changed.
- **One height for every drawer.** It is simpler, but the owner wants to be able
  to swipe a drawer up for more room when a list is long.
- **Dimming the page at the Drawer Height**, as the phone does unless asked not
  to. The page could not have been judged under it, nor highlight colours
  chosen: in the dark theme the phone's dimming takes away nearly half of the
  page's light.
- **The phone's see-through glass for the drawer.** The phone draws a
  half-height drawer as glass, with the page showing through it, blurred. The
  owner chose the app's own solid colours instead.
- **Each drawer finding its own height.** That is what the app did, and it is
  why every drawer was a different size and grew with every row added to it.
- **Rows in rounded cards, like the Settings pages.** Built first, and turned
  down on the phone beside Books: a frame around the list, wider margins, fewer
  words on a line, and long titles cut short.
