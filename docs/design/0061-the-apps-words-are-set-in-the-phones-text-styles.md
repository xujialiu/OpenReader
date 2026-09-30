# The app's words are set in the phone's text styles

_The engineering half of this decision is
[ADR 0061](../adr/0061-one-file-holds-every-text-size.md). Issue #99. It is
decision 0042 applied to the size and weight of text._

## What the owner asked for

Every place in the app that set words chose its own size and weight. A list of
them all found nine sizes and four weights, and the same kind of text looked
different from one place to the next:

- A book's name was set three ways: a little heavier than the rest in the
  Library, larger and bold as a drawer's title, semibold above the page.
- A row in a drawer was a different size in the book's actions and in
  Appearance than in Contents, and both were smaller than a row in Settings.
- Some sizes and one weight were not ones the phone ever uses.

The owner asked for one standard, written down once, that every piece of text
refers to, and chose the phone's own.

## The phone's text styles

The phone has a short list of named text styles, each a size and a weight,
and uses them in its own apps. The app now uses the same list and nothing
else. Every piece of text is one of them:

- **Headline**, semibold: a book's name, wherever it appears, every drawer's
  title, every title above a page, a group's heading in Settings, the speed in
  its bubble.
- **Body**: a row, and what the row says on its right; a field; a plain button.
- **Subhead**, a size smaller: a line that goes with a list, such as the voice
  line above the chapters in Download, the filter chips in Voice, a row's note
  in Settings, the voice name in the player.
- **Footnote**, smaller still: progress under a book's name, notes, footers,
  lines that say how a download went.
- **Caption**: the player's own short notes.
- A larger style for the Library's empty state, and one for the word being
  looked up until that follows Appearance (below).

A row that is chosen or being read, such as the chapter being read in Contents,
takes the same style in its heavier weight, as the phone does.

So a book's name is now the same in the Library, in its drawer and above its
page. The drawers' titles came down a size to match the titles above every page,
and their rows came up to the size of a row in Settings.

## How far apart the lines are

The phone's published table gives each style a line spacing as well. The phone
does not use it for its own text. Measured in its own Settings, a footer's
lines are closer together than the table says. The app follows what the phone
does, not what the table says: every style's lines are as far apart as the
letters themselves need. Two-line names and notes sit a little closer than in
the first trial, which used the table.

## What is not the app's

The page is not set in these styles. Its text is the owner's Appearance: the
font and size chosen there. A word looked up on the page, and the meanings or
translation the lookup finds, are read as part of the reading, so they will
follow Appearance too, not these styles (issue #98). The lookup drawer's own
buttons and notes stay in the app's styles.

## Turned down

- **A smaller list of the app's own.** Fewer sizes would have been easier to
  choose between, but every one would have been the app's invention, argued
  about on its own, and different from the phone around it. Decision 0042
  already says the phone's look wins.
- **The table's line spacing.** Tried first. It set lines further apart than
  the phone's own apps do.
- **Changing only the drawers and the Library.** That was the first trial. It
  left the settings pages, the player and the titles above the pages with sizes
  of their own, which is what the owner asked to be rid of.

## What it costs

- **Long names are cut sooner in drawers.** A drawer row's words are larger
  than before, so a long chapter name in Contents or Download reaches the end
  of its line, or its second line, a few letters earlier.
- **One change moves everything.** Because every piece of text refers to a
  style, changing a style changes every place that uses it. That is the point,
  but it means a size cannot be nudged in one drawer alone.
- **The table is the phone's today.** The sizes are the phone's at its default
  text size, read from Apple's published table. When the phone's styles change,
  the list has to be read again.
- **Larger text grows evenly.** When the owner makes the phone's text larger,
  every style here grows by the same share. The phone grows its own styles by
  different amounts, small text more than large. This has not been measured,
  except for the titles above pages: those grow exactly as the phone's own do,
  from 17 points to 21 and no further (issue #100).
