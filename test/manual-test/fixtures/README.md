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

Each file's own header says what it holds and why. When a generated book is
too tidy to show the behaviour, use a real one instead (**Real books**).
