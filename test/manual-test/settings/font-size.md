# Font Size against Documents that set their own sizes (#17)

Font Size is the size of every Document's body text (ADR 0030). The short fixture and 仙逆 set no body text size of their own, so they cannot show the difference between that and the old root percentage. `sized-fixtures.ts` writes two Documents that can, each with a first chapter of more than 2,000 non-space characters, so it is decided on its first page (`CHARACTERS_TO_DECIDE`):

```sh
npx tsx test/manual-test/fixtures/sized-fixtures.ts /tmp/openreader-sized-fixtures
```

- `Sized Fixture Rem`: `html { font-size: 62.5% }` with the paragraphs at `1.6rem`, so the body text is 16px, and its own `body { -webkit-text-size-adjust: 100% }`.
- `Sized Fixture Small`: `body { font-size: 12px }`.

Both have an `x-small` badge in each heading and a `12px` note.

To put them on a simulator without the picker, copy them into the app's `Documents/Inbox/` (`xcrun simctl get_app_container SIMULATOR_UDID top.xujialiu.openreader data`) and write the walkthrough harness's `{"seq":N,"do":"add","file":"Sized Fixture Rem.epub"}` to `Documents/harness.json`, with a new `seq` for every command. The Library entry is named after the file. `{"do":"shut"}` and then `{"do":"open","id":"sha256:…"}` open one. A `{"do":"js","code":"return …"}` answer arrives in the Metro log as `note="The highlight could not be drawn: PROBE …"`.

Read these in each section document: `getComputedStyle(…).fontSize` of `p`, `h1`, `.badge` and `.note`, and `getPropertyValue('-webkit-text-size-adjust')` of the root. `{"do":"settings","patch":{"appearance":{"font":null,"size":20}}}` changes the size through the same `setSettings` the sheet calls. The expected values are in `notes/NOTES_2026-09-21.md` (11:31). The Rem fixture's body text lands on the chosen size, with its heading, badge and note in proportion. The Small fixture's is 12px, and it reads 133.33% at 16. The first open of Small is shown at 12px until its first chapter has been counted, then redrawn once at 16. Each Document's decided size is in `Documents/body-text-sizes.json` (`{"version":1,"sizes":{…}}`). Delete an entry to have it counted again on the next open. The short fixture has 883 characters in all, so it is never decided and is counted again on every open.

The same measurement on an iPad simulator needs the patched library. `postinstall` applies `patches/@epubjs-react-native+core+1.4.8.patch`, which asks the reader's WebView for its mobile content mode. Without it, an iPad reports the percentage and draws every size unchanged (ADR 0030).

What this does not establish: the stepper's own touches, the number between − and +, the highlight still painting after a change, and the spoken Utterance staying centred. Those need real touches and screenshots.

## The stepper, the highlight and the iPad with real touches (`FontSizeProbe.swift`)

`FontSizeProbe.swift`, through `kit/run-probe.sh`: a new output directory generates the project, and an existing one reuses it.

```sh
bash test/manual-test/kit/run-probe.sh FontSizeProbe SIMULATOR_UDID /tmp/openreader-font-size-01 -only-testing:testStepperLadderDisabledEndsAndFontPage
```

- `testStepperLadderDisabledEndsAndFontPage` opens the short fixture with a real tap and walks the ladder 16 → 12 → 32 → 16, asserting every number between − and +. It also asserts that − is disabled at 12 and + at 32, that the "Use document appearance" line is gone, and the round trip through the Fonts page. It leaves the sheet open at 16 so the theme can be switched with the harness for light and dark screenshots of the same sheet. `testCloseAppearanceSheet` then closes it.
- `testHighlightPersistsAndRecentersAfterFontSizeChange` sets a highlight with a coordinate tap on the short fixture's body text, never pressing Play. It then takes the size to 24 in eight taps, screenshots before and after, and restores 16. Judge the re-centring from the two screenshots.
- `testStepFontSizeUpTo32` takes a reader that is already open, at 16, to 32 in sixteen taps. It is for comparing the page across Documents opened with the harness.
- `testFontSizeAndReaderBehaviourOnIPad` runs on the iPad. From a reader the harness opened, it opens and closes Contents, taps a word, swipes, and goes 16 → 24 → 16.

Prerequisites: the latest Debug app on this worktree's Metro, Font Size 16, and the short fixture in the Library. The two tests that start from an open reader need a Document opened first with the harness's `shut` and `open`. The coordinate taps were chosen from this fixture's own screenshots; a tap that lands between two lines silently does nothing, by design.

What it cannot establish:

- The first open of `Sized Fixture Small`, shown at 12px and then redrawn once at 16. That happens faster than `simctl io … screenshot` can catch.
- Whether a swipe scrolls epub.js's page. The iPad's synthetic swipe produced no visible scroll, which was not pursued.
