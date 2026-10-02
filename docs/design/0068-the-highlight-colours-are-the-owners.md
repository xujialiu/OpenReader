# The Highlight Colours are the owner's, the same in light and dark

_The engineering half of this decision is
[ADR 0068](../adr/0068-the-highlight-colours-are-the-owners.md). Issue #118; the
owner's decisions are in the plan comment there, of 2026-10-01. It revises what
decisions [0022](0022-reading-in-the-dark.md),
[0027](0027-whole-document-offline-narration.md),
[0041](0041-one-look-for-settings-and-the-speed-control.md),
[0042](0042-the-app-follows-the-phones-own-look.md) and
[0066](0066-every-drawer-rises-to-the-drawer-height.md) say about the mark on a
dark page and about the app's amber._

## What the owner saw

The marks that follow the voice were fixed. Two marks are drawn: a pale one over
the sentence being read, and a stronger one over the word being spoken. On a
light page the sentence was a pale amber and the word a deeper amber. On a dark
page both were solid blues: a muted blue-grey for the sentence and a vivid blue
for the word (decision 0022). Nothing in the app let the owner change either
pair.

So switching the Theme changed the colour of the reading although the owner had
chosen neither colour. A mark that suited the owner's eyes on one page could not
be carried to the other, and a mark that did not suit them could not be changed.

Everything else the app marks as live was amber in both themes: a check, the
chapter being read in Contents and Download, a link, an action on a settings
page, the ring of a chapter being downloaded. So was the faint wash behind the
small **A** in the player that says the page is following the voice. In the
dark, the page said "this is being read" in blue while the A beside it, which
stands for that very word, and every other mark around the page said "this is
chosen" in amber.

The desktop Zotero-TTS plugin already lets its owner choose a colour and a
strength for each of the two marks.

## The owner chooses both marks, once for both pages

The sentence's mark and the word's mark are each a colour and a strength, and
both are the owner's. A strength runs from nothing to solid, and nothing is
allowed: a word at nothing leaves the reading marked by its sentence alone, and
a sentence at nothing leaves only the word.

The choice is the same under the light and the dark Theme. Changing the Theme
changes the page and the app around it, never the colour of the reading. The
choice is part of Appearance, so it belongs to the owner rather than to a book,
and one choice marks every book.

## The two looks the app had become presets

The two looks the app has had are offered above the owner's own choices, so that
going back to either is one tap:

- **Amber**, the light page's mark as it was.
- **Blue**, the dark page's two colours, now at amber's strengths instead of
  solid, so that the two presets differ only in colour.

**Blue is the default**, for a new install and for an owner who had never
chosen, because it is the only one of the two whose spoken word stays readable
on both pages. Black letters on Blue's word on a white page read more clearly
than the app asks of its own words, and the light letters of a dark page read
better on it than they did on the old solid blue. Amber is a bright colour,
and the dark page's light letters on Amber's word are hard to read.

## Where the choice is made

_Revised with the owner on 2026-10-02, #122: the original section crowded
Appearance, and its colour picker covered the sample just when it was needed._

Appearance has one **Highlight** row below Alignment, with a chevron. It opens
its own page in the same drawer, just as Font does; Back returns to Appearance.
The drawer still leaves the document above it in view and in use at the drawer
height (decision 0066), and a change reaches the document at once.

At the top is a **short sample sentence**, on the page's own colours and in the
chosen reading font, with a word marked over the marked sentence. It prefers
one line and never occupies more than two; the sample is shortened rather than
its letters made smaller. It works while reading is paused, without starting
speech. Both marks stay visible throughout editing, including when the controls
below need to scroll.

Below it, the phone's **Sentence | Word** control switches which mark is being
edited, without moving the sample or opening another page. Colour and strength
are adjusted inline, using the phone's sliders. Red, green and blue together
can reach any colour; strength runs from nothing to solid. No new window covers
the sample. Changes are applied and kept as they are made; Back is not Cancel.

The two small preset tiles remain on this page, Amber then Blue, about a fifth
of the width and set to the left. Each shows "Aa" as the spoken word would look
on the page. The tile whose four values match the current choice has a ring in
its word's colour. Neither is named on screen; VoiceOver reads Amber and Blue.
They remain shortcuts for both marks, not just the one currently being edited.

Choosing a colour or a strength that matches neither preset takes the ring off
both tiles. Nothing is lost: the tiles are a quick way to two choices, not a
mode the app is in.

## The app's accent follows the word's colour

Where the phone would draw a check, a link or an action in its own blue, the app
drew it in amber, the colour its mark was painted in, so that one colour meant
"this is live" everywhere (decision 0042). It still does, and that colour is now
the owner's: **everything the app drew in amber follows the colour of the word's
mark**. That is the checks, the chapter being read in Contents and in Download,
the links, the actions on the settings pages, the ring of a download, and the
drawers' own marks.

The word's colour as it is would not always be readable as a check or as the
words of a link. Pale yellow on a white page cannot be read, and a deep blue on
the dark page reads poorly. So the app keeps the colour's hue and makes it darker
on a light surface, or lighter on a dark one, **only as far as it must to be read
clearly against what it is drawn on**, and no further. A colour that can already
be read is left as it is. With Blue, the default, the accent on a light page is
the word's own blue.

**The player's A takes the word's own mark**: the word's colour at the word's
strength, exactly as the spoken word is marked on the page. The A stands for
the word the page is following, so it now looks like that word. With the word's
strength at nothing, the A shows no mark either.

## What it costs

- **Amber on a dark page is hard to read, and the app allows it.** The dark
  page's light letters on Amber's bright word mark are dim against it, far below
  what the app asks of its own words. This is what decision 0022 turned away
  from, and it comes back the moment the owner chooses Amber in the dark. It is
  accepted because what the page is painted with is now the owner's to choose,
  and Blue, the default, does not have the problem. The same is true of any
  colour the owner picks: the app does not stop a choice that is hard to read.
- **A weaker sentence mark on the dark page.** Blue at amber's strength is a
  faint tint on the near-black page, barely set apart from it, where the old
  solid blue-grey stood out clearly. On the light page it is a pale blue-grey,
  a little plainer than the pale amber was. An owner who wants it stronger
  raises it.
- **The accent is no longer one fixed amber.** The checks and links change
  whenever the word's colour does, and are a different shade on the light and
  the dark page. A colour chosen for the page can sit oddly on the app around
  it: a red word makes every check look like a warning, and a grey one makes
  them look switched off. By default the app's accent is now blue, close to the
  phone's own.
- **No names on the tiles.** The tiles show only "Aa" and a ring, so on the
  screen the two presets are told apart by their colour alone.
- **Sliders rather than the complete colour picker.** Keeping the sample visible
  takes priority over the phone's grid, spectrum and eyedropper. All colours
  remain available, but mixing red, green and blue takes more adjustment than
  pointing at a spectrum. The two presets remain the quick choices.

## Turned down

- **Separate colours for each Theme.** The owner would have chosen four colours
  and four strengths instead of two of each, and switching the Theme would still
  have changed the colour of the reading. That is the problem this decision
  exists to remove.
- **Recolouring the word's letters when they would be hard to read.** The app
  could have set the spoken word in dark letters whenever its mark was too
  bright for the page's light ones. That is what the first dark page did, and the
  owner turned it down then (decision 0022): the one word being followed became
  the only dark word on a light-lettered page, and looked like a word that had
  changed colour rather than the same text marked.
- **A fixed palette of swatches only.** A handful of colours to tap would have
  been simpler to draw, but the owner could not have matched the desktop
  plugin, which takes any colour, or the mark they find comfortable. The two
  presets give the quick taps; the picker gives everything else.
- **A picker covering the sample.** Closing it to judge a colour, then reopening
  it to adjust again, defeats the purpose of the preview. The owner chose
  always-visible feedback over keeping the complete picker.
- **Separate Sentence and Word editing pages.** They could each repeat the
  sample, but switching between the marks would require going back and in again.
- **A separate strength stepper beside each colour.** Strength is already
  adjusted by one slider; another control would duplicate it.
- **The accent staying amber.** The A would have kept saying "following" in a
  colour other than the word it stands for, and with Blue as the default every
  page would have been marked in blue inside an app whose every check was amber.
