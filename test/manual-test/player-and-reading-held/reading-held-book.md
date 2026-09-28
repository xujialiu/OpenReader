# The Reading held on a real, long book (#68)

With "Shadow Slave — Chapters 1–250" (or another part from
`~/Works/epub_books`, **Real books** in [../README.md](../README.md)) already in the Library:

```sh
bash test/manual-test/player-and-reading-held/reading-held-book.sh SIMULATOR_UDID NEW_OUTPUT_DIR METRO_LOG [MARGIN]
```

The small fixture proves the mechanism; this proves it on "hundreds of spine
items, chapters several screens tall and a real navigation document" — what a
section boundary actually meets in the owner's own reading. A fresh mount's
Utterance count (`known`, from the harness `say`) is **session-relative**: the
same absolute number means a different place after a different resume anchor
(Pitfalls below), so the number of chapters this run crosses is whatever the
book's own resume anchor happens to leave MARGIN Utterances short of — not a
fixed chapter. Measured 2026-09-26: one run crossed from "Chapter 25" to
"Chapter 30" in about 6 Utterances of play; a session-relative index does not
mean chapters are evenly sized.

Before the real-touch suite runs (`ReadingHeldBookProbe.swift`, one
method, `testRealBookCrossesUnrenderedSectionWhileParked`), the script itself
opens the book and re-derives the seek target from THIS session's own
`known`, by the harness's `open`/`say`/`seek` commands (a handler action, not
a touch — reaching a chosen sentence in a 250-chapter book by real taps alone
is impractical), confirming the seek did not itself trigger the next
section's render before retrying with a larger margin. It leaves the app
sitting in that live, paused reader rather than persisting the place and
reopening it (Pitfalls below), so the probe's own first touch is Play, not a
tap to reopen. Every touch the probe itself performs — Play, the back arrow,
the Reading Button, Pause — is real, and it never assumes which chapter the
edge falls in: it only checks that the Library row's own quote of the
reading's place changes at all, which at that edge is only possible by
rendering fresh content. Measured 2026-09-26: `Executed 1 test, with 0
failures`, about 23 s of play (`Seeded … margin 6` to crossing to Pause).

It does not prove what specific chapter a fresh install would land on (that
depends entirely on the book's own saved place), or hold-time memory on a
real book (the spike in notes 2026-09-25 23:40 used one).
