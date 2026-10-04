# One look for settings, and for the speed control

_The engineering half of this decision is
[ADR 0041](../adr/0041-settings-rows-and-the-speed-popover.md). Issue #48._

_[Design 0066](0066-every-drawer-rises-to-the-drawer-height.md) carries these
cards into every drawer: a drawer is the colour of a settings page, and its
cards the colour of a settings card._

_Revised in [decision 0068](0068-the-highlight-colours-are-the-owners.md): the
amber below, of the Privacy Policy link and of an action such as Test
connection, is now the colour of the spoken word's mark, made just dark or
light enough to be read._

## What the owner saw

Settings was drawn four different ways, a tap apart. Its front page and the list
of providers were full-width lists, each with its own row size and type size.
General was a set of grouped cards, the way the phone's own Settings draws its
pages. A provider's page was a form: bold labels over boxed fields, a switch
standing on its own, and a boxed button. Sync took General's cards and put the
provider page's boxed fields inside them, so each field was a box inside a box,
its label pressed against the line above it and its box running into the edge
of the card. That page is the one the owner singled out as the ugliest.

The speed drawer held two small square boxes around the number, the only square
buttons in the app, under a title set larger than the number they change. The
play button beneath it was slightly wider than it was tall, so it read as an
oval rather than a circle.

## Every settings page is grouped cards

Every settings page now uses General's grouped cards: grey headers, rounded cards
of rows, and any explanation set under the card it explains. The front page is
one card, and so is the list of providers. The app keeps its own colours, so in
the dark the settings pages are the same near-black as the page being read.

The cards are drawn to the phone's own measurements, taken from its Settings
rather than remembered (decision 0042): how far a card stands in from the edge
of the screen, how round its corners are, how tall a row is and how large its
words, where a separator starts and stops, and the grey of anything quieter
than a row's own name. One change that follows is visible at once: a group's
header is no longer small capitals, because the phone's own headers are not any
more; they are set as written, larger and in bold. Another is that the theme's
card in General has no header, since its one row already says Theme.

In the light theme the settings pages turn light grey and their cards white, as
the phone's own Settings does. Before, the cards were a faint grey on a white
page, sunk into it, while in the dark they already sat above it; now a card sits
above its page in both themes. This costs the settings pages the white the
Library keeps, which is the same difference the phone's own Settings has from
its Notes.

This gives up an earlier intention: that Settings and the Library be one kind of
list, so that there is one kind of list to learn. General had already left it
behind when it was rebuilt as cards. A page of switches and typed fields drawn
as a full-width list looks like a form on a website, and the phone's own
Settings, which draws every such page as cards, is what the owner holds these
pages up against.

Turned down:

- **Full-width lists everywhere, as in the Library.** It keeps one kind of list
  across the app, but switches, fields and explanations in full-width rows are
  the look the owner is objecting to, and the phone itself never draws settings
  that way.
- **Letting the phone draw the settings pages itself,** as it already draws the
  short menus for Theme and Alignment. The pages would match the phone's own
  Settings exactly and follow its text size, but every settings page would have
  to be rebuilt a second way, at several times the work and risk, for a result
  the owner would barely tell apart from cards drawn by the app.

## The front page says only what is not behind it

The front page is four rows. Providers says how many are enabled and Sync says
whether it is on, each on the right in grey, where the phone puts a row's
current value. General says nothing: the word `Theme` it used to carry described
what was behind the row rather than anything true of it, and had stopped being
the whole of it once General also held the removal of brackets. There are no
coloured icons beside the rows, because four rows need nothing to be found by.

Below that card, a second card holds two rows. Privacy Policy is set in the
amber the app uses wherever the phone would draw a link in its blue, and opens
the policy on the project's own site (decision 0017). Acknowledgements opens a
page of the app's own listing everything the app is built from, each with the
terms it came under (decision 0065). The version number sits under this last
card, in the same grey as any card's explanation.

## A field is one row

On a provider's page and on Sync, each field is one row of its card: its name on
the left and what was typed to the right, the values of one card starting at the
same place, as on the phone's own page for adding a mail account. A long address
shows its beginning and is cut short at the end until it is tapped. While a
field is being edited it carries the phone's own small clear button, as the
phone's own fields do, so a long address can be emptied at once.

Two fields are not like this, and for the same reason: the list of bracket pairs
in General and the list of Fish Audio voices the owner supplies are each
revealed by a switch, so each is a full-width line under its switch with no name
of its own. The switch above it already says what it is.

Turned down: **the name above the value,** two lines to a field. It shows more of
a long address, but these fields are typed once and rarely read again, the
secret ones show only dots whatever their width, and the pages would be half as
long again.

## Help is in the empty field

The last two question-mark buttons, beside the extra headers and beside Fish
Audio's own voices, are removed, as the others were in decision 0026. What each
field expects is written in it while it is empty: `Name: value; Name: value` for
the headers, and that voices are IDs or links separated by spaces or commas.

The sentence that the headers are sent only to their provider's address leaves
the screen. It is a promise the app keeps, and nothing the owner does depends on
having read it.

## A setting that freezes others is laid out one way

Three settings freeze what they guard while they are on: a provider's setup,
Sync, and the removal of brackets. They now share one arrangement.

- **The switch comes first.** Sync's switch moves above its folder, where a
  provider's already was.
- **Its name does not change.** A provider's switch used to be labelled
  `Enabled` or `Disabled` as it moved, which only repeated what the switch
  itself shows; it now always reads `Enabled`.
- **The line under its name says what is happening now.** While the setting is
  on, `Turn off to edit.`; while a connection is being checked, `Testing…` or
  `Checking the folder…`. Before, the three pages each said the first of these
  differently, and Sync and General said it all the time, even while their
  fields could be typed into. It sits in the switch's own row because decision
  0026 found that, placed apart from its switch, it read as an instruction for
  the field beside it.
- **The outcome is the line under the switch's card.** On a provider's page,
  `Test connection` moves up into the switch's card as a row of its own in the
  app's amber, so enabling and testing, which end in the same result, both have
  that result directly beneath them. On Sync, what the last sync did, or why the
  switch would not stay on, is the line under its card. In General, a refused
  list of bracket pairs is said under its card.

General keeps one standing sentence under its card: downloaded sentences the
change alters are read online until their chapters are downloaded again, and
switching back plays their saved audio again. Nothing else on any screen shows
that, and without it a chapter downloaded before the change would stop, with no
network, on its sentences with brackets, with nothing to say why.

_Revised on 2026-10-05 (#135): the sentence used to say that chapters already
downloaded keep the audio they were saved with until they are downloaded again,
which read as though they went on playing it after the change._

## The speed opens in a small bubble at the number

Tapping the speed at the end of the player opens the phone's own small bubble
just above it, holding the minus, the speed and the plus in one row. It closes
when anything outside it is tapped, or the speed is tapped again, and a tap
outside does nothing else: it does not also press the button it lands on. How
the speed changes is as before: each tap changes it by 0.05, from 0.50 to 4.00
times, holding a button keeps going, and the change is heard at once.

The speed shown in the player itself is set a size larger than before, a step
above the name of the voice beside it. It had been the smallest thing on its
row.

A first version kept the drawer and filled it: two large round buttons around
a number more than twice the size of anything in the player, in a drawer taller
than the player it adjusted. The owner found it worse than what it replaced: the
drawer and the player were drawn to two different scales, one over the other.
The bubble is drawn to the player's: its number is the size of ordinary text,
only a little larger than the player's own, and its buttons are small round ones
of the player's family.

The bubble is the phone's own, as the menus for Theme and Alignment are
(decision 0035, decision 0042), so it is see-through glass like the phone's
other bubbles, and what lies behind it shows through, blurred. The buttons
inside it are the app's own, so that holding one keeps the pace the reading page
can keep up with.

Turned down:

- **Keeping the drawer, at the player's height.** A panel the size of the player,
  rising over it, for one number.
- **Turning the player's own row into the stepper while the speed changes.** It
  hides the sentence and paragraph controls meanwhile, and brings back into the
  player the buttons decision 0026 took out of it.
- **The phone's own stepper inside the bubble.** It would repeat at the phone's
  pace rather than the one the reading page can keep up with. The app's buttons
  turned out to work inside the phone's bubble, holding included, so it was not
  needed.
- **A slider or a row of preset speeds.** Decision 0026 chose a stepper over
  presets because people settle on a pace of their own, rarely one of five. The
  owner's objection was to how the control looks, not to how it works.

This revises decision 0026, which opened the speed in a drawer from the bottom
of the screen and listed it among the drawers that close by dragging their
handle.

## The way back is an arrow

Every screen reached from another shows its way back as the arrow alone, without
the name of the screen behind it, as the phone's own Settings now does. The
reader already did. The phone's screen reader calls each of them Back, as it
already called the reader's. The phone's own Settings reads out the name of the
screen behind instead, and that is the one way these arrows differ from it.

## The play button is a circle

The play button becomes a true circle at the height the player already has.
A larger circle was turned down: it would make the player taller, and every
point of player height is a point of the page it covers.
