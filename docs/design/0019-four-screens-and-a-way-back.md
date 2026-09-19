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

_General_ is, for now, empty, and it says so: the one thing it will hold is
whether the app is light or dark, and that has not been built. An entry that
admits it is empty is better than a switch that does nothing, and better than no
entry at all — the second would leave the owner wondering where such a thing
would ever go. The reading speed is deliberately not in it, even though it is
true of the whole app, because it is judged by listening to the change and so
belongs beside the book.

Each row in _Providers_ says what is behind it before it is tapped — "holds an
API key and a model", "holds an engine, the address of the server and the
headers of a gate in front of it" — and the one being used says instead what it
still needs before it can read anything. **Tapping a provider does not start
using it.** Looking at what a service would want and switching the voice that is
reading are two different intentions, and the second is the one an owner would
not notice having made. So there is a button, on the provider's own screen,
where what that provider needs is in front of them at the moment they choose.
Choosing gives up the voice, because a voice belongs to one service and no
other.

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

**Adding a very large book used to take about fifteen seconds, and no longer
does.** Recognising a document meant reading all of it, and for the owner's
34-megabyte novel that was fourteen seconds during which the app could not draw,
could not animate and could not say what it was doing — it looked stopped. That
was recorded here rather than hidden, and it has since been fixed by changing
what a book is recognised *by*: a book now carries a short list of everything
inside it, and reading that list is enough. The full measurement is in the
decision that owns it.

One thing the owner gains and one thing they lose. They gain that the same book
repacked — the same text, saved again by different software — is now recognised
as the book they were already reading, instead of arriving as a stranger. They
lose the guarantee that anything at all can be added: a file that is not really
a book, or one packed in a way this version cannot read, is now **refused by
name** rather than quietly given an identity it might not keep. The shelf says
which file was turned away and why, and nothing is added.

**A voice of your own can now be reached through a locked door.** The owner runs
a speech engine on a machine of their own, and that machine is not open to the
internet: something stands in front of it and turns away anything that does not
present a pass. Until this piece of work there was nowhere in the app to put that
pass, so the app could not reach the one voice the owner does not pay per word
for — and, quietly, no highlight the app had ever drawn on a phone had been
following a real voice. Every one had been driven by timings written for a test.
There is now a field for it, on the screen of the provider it belongs to, and it
is the difference between the app being refused at that door and the app reading
the book aloud.

The field is offered to the two kinds of provider that are an address the owner
typed, and to none of the three that are a company's service. A field that does
nothing is worse than no field: it is a question the owner will answer carefully
and then wonder about.

**The pass is kept where a password is kept, not where a preference is kept.**
This is the one decision here that costs the owner something. Everything else
they set is meant, one day, to follow them between their devices through a folder
they own; a pass that opens their own machine is not something to copy into a
folder and send to a third place, so it stays on the one phone, in the store the
phone keeps passwords in. Three consequences the owner will actually meet:

- It survives closing the app, when nothing else on those screens does yet.
- It does **not** follow them to another device. On a second phone it is typed
  again.
- An owner whose one door stands in front of two services types the pass twice,
  once for each. That is deliberate. The alternative is one copy that three
  services could be sent, which is the promise this app makes about API keys and
  should not quietly break for this.

It is shown as ordinary text while it is being typed, unlike the API key beside
it, and that is not an oversight. A pass of this kind is a name and a value
together, and a row of dots would hide the half the owner needs to read back to
check they pasted the right thing into the right place. Once saved it is never
shown again — the field is empty unless it is being typed into.

**A credential saved in one place now takes effect everywhere at once.** Saving a
key or a pass while a book is open used to change nothing the open book could
see: it went on believing there was no key, so the play button stayed dead, and
if it had already been refused at the door it went on being refused with the
right pass sitting in the phone. Both are now impossible. The cost is that saving
a credential stops whatever is being read, because what it was reading with has
changed — which is the same thing that already happens when the address of a
server is edited.

**Settings keeps what you typed when you leave it.** The panel it replaces had a
Done button; a screen has a back arrow and a swipe, and either of those throwing
away a freshly pasted key would be a new way to lose one. So leaving the screen,
however it is left, is what saves.

**Appearance opens and holds nothing yet.** It rises from the bottom over the
page, the page stays visible behind it, and it says in as many words that the one
thing it will hold has not been built. That is on purpose: the sheet is the part
of this decision that could be got wrong, and it is easier to see that the page
is still readable behind it now than after something is in it.
