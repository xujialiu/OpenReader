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

## What was decided while building it

**"How far through" is the last sentence read, not a number.** Each entry shows
the words the reading stopped on, in quotation marks. A percentage was the
obvious thing and it was turned down twice over: working one out means the app
first reading the whole book end to end, which on the owner's own two-thousand
chapter novel is the slowest thing it does; and any figure arrived at more
cheaply would be a guess, which this app does not make about where the voice is
and should not make about where the reader is either. A sentence the owner
recognises answers what they are actually asking, which is "which of these am I
in the middle of".

**The shelf keeps the book, not a pointer to it.** Adding a document copies it
into the app. This is not what was planned — the plan was to remember where the
owner's file lives and go back to it — and it changed for a reason the owner can
check: on this platform, an app that is handed a document is handed a copy of it
before it can look at the original at all, and there is no supported way to ask
for lasting permission to the original. So the choice was between keeping the
copy the system already made and losing it. What the owner's own file was
promised is unchanged: it is never moved, never altered, and stays exactly where
they keep it, and deleting the app takes the app's copy with it and leaves
theirs.

One consequence worth stating: the same book added twice, from two places, is
one entry, because a document is recognised by what is in it rather than by
where it came from. The second add changes nothing except which end of the shelf
it sits at.

**Adding a very large book takes about fifteen seconds, and the app does nothing
while it does.** Recognising a document means reading all of it, and for the
owner's 34-megabyte novel that is fourteen seconds during which the app cannot
draw, cannot animate and cannot say what it is doing — it looks stopped. It is
paid once, when the book is added; opening it again afterwards is instant. It is
recorded here rather than hidden because an app that looks stopped is the one
thing this project's own rules say not to ship quietly, and because the fix is a
piece of work in its own right rather than a line in this one.

**Settings keeps what you typed when you leave it.** The panel it replaces had a
Done button; a screen has a back arrow and a swipe, and either of those throwing
away a freshly pasted key would be a new way to lose one. So leaving the screen,
however it is left, is what saves.

**Appearance opens and holds nothing yet.** It rises from the bottom over the
page, the page stays visible behind it, and it says in as many words that the one
thing it will hold has not been built. That is on purpose: the sheet is the part
of this decision that could be got wrong, and it is easier to see that the page
is still readable behind it now than after something is in it.
