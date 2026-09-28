# Reading across the end of a downloaded chapter, and a place kept across a renumbering (#26, #45, #46)

`boundary-fixture.ts` writes `Boundary Fixture.epub`: two chapters in two spine
files, a heading and four sentences each, all different, so Utterances 0–4 are
chapter one and 5–9 chapter two.

```sh
npx tsx test/manual-test/fixtures/boundary-fixture.ts OUTPUT_DIRECTORY
```

Load it like any fixture (**Real books** in [../README.md](../README.md)). Download chapter one alone,
without the sheet, through the app's own runtime; it synthesizes that chapter's
five sentences for real, and nothing plays:

```sh
node test/manual-test/kit/download-chapter.cjs DOCUMENT_ID "Boundary Fixture" fish VOICE_ID --list
node test/manual-test/kit/download-chapter.cjs DOCUMENT_ID "Boundary Fixture" fish VOICE_ID nav.0
```

`VOICE_ID` is the app's own id, locale first (`en/<model id>` for Fish): a bare
model id is refused as an unknown voice. The same script downloads a chapter of a
real book, which is how the #46 runs below had Chapter 2003 of `Cultivation
Online 2001-2044` saved and Chapter 2004 not.

**#26 at the boundary.** The failure needs a connection that has idled for more
than about 60 s but that iOS has not yet closed: measured 2026-09-23, it failed
107 s and about 70 s after the last request to `api.fish.audio` and not about
3 min after (`notes/NOTES_2026-09-23.md`). So restart the app (its launch asks
Fish for voices, which is the last request), wait 90–100 s with the reader open,
seek to Utterance 3 and play: chapter one's last two sentences come from disk in
about 0.1 s each, and the requests for 5 and 6 are what is being tested. Before
the fix both failed after about 6.4 s and the reading stopped on chapter two's
heading. Stop as soon as Utterance 6 has started or the reading has stopped.

**#45.** With a reading paused mid-chapter, the harness's `breakfetch` on
`api.fish.audio` refuses every request from the one named, and `unbreakfetch`
lifts it (`src/app/walkthrough-harness.ts`). Play until the reading stops on a
refused sentence with at least two refused, lift the refusal, press Play once:
the reading must go past all of them.

**#46.** On a real book, choose a chapter in Contents whose predecessor has not
rendered, or leave a book with its place in a middle chapter and open it again.
Before the fix the status line became `utterance=null` with "The document
rendered its sections out of reading order…", and Play read the book's first
page. The Library's stored place is in `Documents/library.json`, or in the
harness's `{"do":"shelf"}` answer.

What none of it proves: whether the owner's phone meets #26 at all, which
depends on its own network path, or anything about real touches.
