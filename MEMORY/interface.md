# What the interface is allowed to say

**The interface says a thing once, or not at all.** Prefer removing a line to
rewording it, and prefer showing nothing to showing a sentence the owner can
already see the answer to.

A line earns its place only if it says something the owner cannot read off the
screen without it. Three kinds fail that test and are removed on sight:

- **A caption on a symbol that already means it.** A check beside the word
  `Downloaded` says it twice; the check alone is the word.
- **A sentence that describes the state it sits next to.** The marked row in the
  contents does not need `The marked row is the one being read.` under it. The
  two sentences that say the mark is *approximate* stay, because that is the one
  thing the mark cannot show.
- **A standing notice repeated on every visit.** `Generating audio may incur
  speech service charges.` above every download is read once and then never
  again, so it costs space on every screen after the first and buys nothing.

What stays is what carries a fact: a count, a size, a name, a failure, a warning
the owner has not already been given. **A count is not a banner** — `2 chapters
downloaded` is a fact and stays; `Whole document downloaded` beside it is the
same fact in other words and goes.

This applies to the words *and* the space they take. On a phone every removed
line is a line of the list the owner came for.

**One standing line is kept on purpose**: the star line under the Author's card
on the front page of Settings (`STAR_LINE`, design 0072). The owner chose it;
do not remove it under this rule.

## How the interface looks

**Native first**: before designing or restyling a screen, control or drawer,
read [design 0042](../docs/design/0042-the-app-follows-the-phones-own-look.md).
Let the phone draw it where it can; otherwise copy the phone's own look,
measured from the phone rather than remembered.
