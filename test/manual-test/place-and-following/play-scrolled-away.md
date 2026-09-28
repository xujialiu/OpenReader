# Play with the page scrolled away, and a place on a chapter heading (#50, #51)

**#50.** `follow-probe.cjs` measures the page from the moment Play is pressed:
every scroll, every display, every section adopted, every problem the program
posts, and then where the two highlights are:

```sh
node test/manual-test/place-and-following/follow-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [SECONDS]
```

Prerequisites: a reader open, the reading **paused on a sentence of spine item
SECTION after its Clip has started**, the simulator silenced, and METRO_LOG, the
file this tree's Metro writes to. On `Cultivation Online 2001-2044`, go to that
place with `{"do":"section","section":6}` followed by thirteen
`{"do":"skip","target":"next-paragraph"}`, which lands on "Suddenly, a golden
energy surged…" (Block 6.13). Then play until the status line reads
`level=word`, and pause. The script scrolls up 1,500 px at a time until SECTION
is off the page, checks the silence, plays for SECONDS (default 2.5), reads, and
pauses.

GREEN (exit 0) means no problem was posted and the Utterance's highlight lies
between 0 and the container's height. Measured with the fix on 2026-09-23: the
section's content hook at +17 ms, epub.js's `moveTo` +958 px at +20, the
centring −281 px at +29, and the Utterance at 283..342 of 758. Before the fix
the same run read the Utterance at −724..−665 and the problem "Block 6.13 is in
section 6, which is not on the page". For the variant after a renumbering
(#46), reopen the book on that sentence instead of jumping there: the scroll up
reports sections 5, 4 and 3 above the paused reading, and the result must be
the same.

**#51.** On the same book: `{"do":"section","section":20}`, then `shut`.
`Documents/library.json` now holds `epubcfi(/6/42!/4/2/2/2)`, "Chapter 2018:
Entering the Starry Sky", with no prefix or suffix. Open the book again. With
the fix, the status line reads `section=20` and "Resumed at the sentence the
reading stopped on.", and the heading is highlighted on Chapter 2018. Before
the fix it read `section=2`, the contents page's line, and "The paragraph this
book was left in is not where it was…".

What neither proves: a real touch on the Player or on the page, since both go
through the harness; or a section that is slow to load. In the runs with the
fix, every section arrived within 20 ms of its display. The first run, before
the fix, took 585 ms, and nothing since has repeated that.
