# Four screens, and a way back from every one of them

_The engineering half of this decision is
[ADR 0019](../adr/0019-a-native-stack-and-a-persisted-library.md)._

Until now the app was one screen. It opened on whatever document was last
picked, and a settings panel slid up over it. That was enough while the only
question was whether a document could be read aloud at all. It answers none of
these: where do I go to open a _different_ book, how do I get back to the one I
was reading, and where do the settings that belong to a provider live when there
are six providers.

## What the owner sees

**The shelf is the front door.** Opening the app shows the documents already
opened, most recent first, each with its title and how far through it the
reading got. Tapping one opens it where it was left. Two buttons sit at the top:
one adds a book, one opens the settings.

**The reader is a screen you arrive at and leave.** It carries a back arrow, the
book's own name, and one more control on the right for how the page looks. Back
goes to the shelf; the reading stops, and the place is kept.

**Settings is a list, not a panel.** It has two entries. _General_ holds what is
true of the whole app. _Providers_ lists the voices available and opens one at a
time, so that the key, the model and the voice for a provider are on a screen of
their own with that provider's name at the top — rather than every provider's
fields stacked on one long panel where five sixths of them do not apply.

**Appearance opens upward from the reader.** It is a short list that rises from
the bottom of the screen over the page, so the text stays visible behind it and
the effect of a change is seen as it is made. It holds one item for now.

## What this gives up

**A second tap to reach a book.** Before, the app opened straight into the
document being read; now it opens onto the shelf. For someone who reads one book
at a time, that is one extra tap every time the app is opened, in exchange for
the first way of reaching a _different_ book that does not go through the file
picker. The alternative — opening straight into the last document, with the
shelf behind a button — was rejected because it makes the app's own front door
depend on which document happens to be last, and because an app that opens into
a book with no visible way out is the thing being fixed.

**A settings screen that takes longer to sweep.** Everything is now two taps
deep instead of one scroll. That is the cost of not showing an owner of one
provider the fields of five others, and it is paid every time settings are
opened. It is judged worth it because the fields that do not apply are not
merely clutter: they are questions the owner cannot answer and cannot tell are
not being asked of them.

**The shelf can be wrong.** It remembers documents, and a document can be moved,
renamed or deleted outside the app. An entry that no longer points at a file
says so when it is tapped rather than pretending; it is not silently removed,
because a file that is temporarily unreachable is not the same as one the owner
threw away, and quietly forgetting books would be worse than showing one that
cannot be opened today.
