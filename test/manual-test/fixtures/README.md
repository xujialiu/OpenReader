# Fixtures

EPUB generators for the device tests. Each writes its book into an output
directory and adds nothing to the app; load it the way any fixture is loaded
(the top README's **Real books** says how):

```sh
npx tsx test/manual-test/fixtures/NAME.ts OUTPUT_DIRECTORY
```

- `short-test-fixture.ts`: `A Short Test of Reading Aloud`, two chapters and
  17 speakable Utterances. Most probes expect it in the Library.
- `boundary-fixture.ts`: two short chapters, for reading across a downloaded
  chapter into one that is not.
- `pause-order-fixture.ts`: five short chapters, for the download order and
  pause checks (#56).
- `pause-gap-fixture.ts`: one paragraph of three sentences, for the two pauses
  (#60).
- `stat-line-fixture.ts`: short lines, for the Fish language hint and brackets
  (#23, #25).
- `alignment-fixture.ts`: every alignment a book uses (#32).
- `sized-fixtures.ts`: two books that set their own text sizes (#17).
- `scroll-fixture.ts`: a long contents page and tall chapters, for fast
  scrolling (#34).
- `leading-strip-fixture.ts`: laid out like the owner's web novels, for the
  highlight's leading strip (#35).
- `script-and-quote-fixture.ts`: a chapter with seven forms of a Document's own
  script, each posting `SCRIPT RAN: …` as a problem if it runs, and a chapter whose
  heading id holds an apostrophe, for ADR 0077.
- `declared-language-fixture.ts`: two one-chapter books declared `de-DE` and
  `nan`, for splitting by a declared language however it is written (#182,
  #185).
- `segmentation-fixture.ts`: seven one-chapter books holding the accepted
  sentence-boundary batch's own examples (#240/#245/#241/#242) — CJK stops
  before digits and lowercase Latin (`zh`, `ja`), `no`/`me` sentence-final
  words beside `Dr. Smith` and `No. 5` (`en`), ASCII/spaced ellipses with their
  capitalized and Unicode controls (`en`), and the same German paragraph
  declared `deu`, `ger` and `de`. Books 2 and 4 are the ones the preparation-
  migration record downloads under pre-batch rules.
- `issue86-fixture.ts`: five short chapters and a text-less volume page, for
  the #86 skip/Contents measurements (`../player-and-reading-held/skips-while-playing.md`). Its contents
  are an **NCX on purpose**: epub.js spells an xhtml nav's hrefs with the nav
  file's folder joined on (`tocPath.join`), so against manifest hrefs like
  `first.xhtml` every row of a `properties="nav"` fixture comes out
  unreachable (`contents.unreachable`) and the sheet says no row can be
  followed — while an NCX's `src` is kept as written and matches. The owner's
  books are NCX; make NCX contents in any fixture whose rows must open.
- `nested-volumes-fixture.ts`: `Nested Volumes Fold Check`, an NCX of three volumes each holding three chapters (twelve
  drawer rows, volumes at depth 0), so the Download drawer shows a fold arrow (`Collapse Volume N` / `Expand Volume N`) that
  no flat book or the owner's web novels have (#334, #335: `../downloads/two-finger.md`, `testDrawerFoldArrows`).
- `positions-copies-fixture.ts`: two books for the position verification of
  #249/#250/#282/#283 (`../sync/positions-late-adoption-and-copies.md`).
  `Positions and Copies` holds `Go. Go. Stop now.`, 100 ×
  `Is this number N? Yes.` (the 65th-and-later copy) and 100 bare `Yes.`
  (indistinguishable); `Named Places` holds the confusion pairs
  `Chapter 1`/`Chapter 10`, `7`/`1907` and `第1章`/`第10章`, each pair in a
  chapter of its own so the fallback search cannot tie across look-alikes.

Each file's own header says what it holds and why. When a generated book is
too tidy to show the behaviour, use a real one instead (**Real books**).
