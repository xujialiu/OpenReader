# A short choice opens where you tapped

_The engineering half of this decision is
[ADR 0035](../adr/0035-a-short-choice-is-the-systems-own-menu.md). It covers
Alignment in the reader's appearance panel ([design 0034](0034-lines-that-meet-both-margins.md))
and Theme in General._

## What changed

A row whose value is one of a few now opens the phone's own small menu, at the
row, with the choices listed and a check beside the one in force. Choosing one
closes the menu and applies it at once. A tap anywhere else closes the menu and
chooses nothing. There are two such rows: **Theme** in General, and
**Alignment** in the panel that changes how a book looks.

Until now Theme's row opened a panel that rose from the bottom of the screen
with its three choices in it. Its row already carried the small up-and-down
mark the phone itself puts on a row that opens a menu, so the row promised one
thing and did another. Alignment would have made that worse: it sits in a panel
that has already risen from the bottom, and a second panel for two choices
would have risen on top of the first.

## Why a menu at the row

- **The page stays in view.** Alignment is judged by looking at the text. The
  menu is small, opens beside the row, and closes the moment a choice is made,
  so the text behind the panel changes while it is still in sight.
- **One mark means one thing.** The up-and-down mark now always opens a menu, as
  it does everywhere else on the phone.
- **Nothing else closes by accident.** A tap outside the menu closes the menu
  alone. It does not also close the panel behind it, which was the one thing
  that had to be tried before this was chosen, and it was.

The choices keep a fixed order even when the menu opens upward from near the
bottom of the screen, where the phone would otherwise list them in reverse:
Left is always above Justify, and Light above Dark above Match Device.

## What it costs

- **The icons in these menus are the phone's own.** Theme's sun, moon and
  half-filled circle, and Alignment's two pictures of lines, are drawn by the
  phone, not in the app's own set, so they look slightly different from the
  app's other icons. A menu of the phone's own takes only the phone's own
  pictures.
- **The app now carries a piece of the phone's own interface.** It had to be
  built into the app, not added to it afterwards, so the first version with it
  had to be installed afresh, on the phone as well as on the test devices.
- **While a menu is open, its row looks empty.** The phone turns the row into
  the menu as it opens, and turns it back as it closes.

## Turned down

- **A page inside the panel, as the font list is.** It moves the owner to a new
  page to pick one of two words, which is navigation rather than a choice at
  the row, and the owner asked for the choices to pop up.
- **A second panel over the first, as Theme had.** It covers more of the page
  being judged, and the app deliberately never stacks one panel on another.
- **Keeping Theme's panel and giving only Alignment the menu.** The same mark
  would have done two different things a few screens apart.
