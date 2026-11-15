# Font Size against Documents that set their own sizes (#17)

Font Size is the size of every Document's body text (ADR 0030). The short fixture and 仙逆 set no body text size of their own, so they cannot show the difference between that and the old root percentage. `sized-fixtures.ts` writes two Documents that can, each with a first chapter of more than 2,000 non-space characters, so it is decided on its first page (`CHARACTERS_TO_DECIDE`):

```sh
npx tsx test/manual-test/fixtures/sized-fixtures.ts /tmp/openreader-sized-fixtures
```

- `Sized Fixture Rem`: `html { font-size: 62.5% }` with the paragraphs at `1.6rem`, so the body text is 16px, and its own `body { -webkit-text-size-adjust: 100% }`.
- `Sized Fixture Small`: `body { font-size: 12px }`.

Both have an `x-small` badge in each heading and a `12px` note.

To put them on a simulator without the picker, copy them into the app's `Documents/Inbox/` (`xcrun simctl get_app_container SIMULATOR_UDID top.xujialiu.openreader data`) and write the walkthrough harness's `{"seq":N,"do":"add","file":"Sized Fixture Rem.epub"}` to `Documents/harness.json`, with a new `seq` for every command. The Library entry is named after the file. `{"do":"shut"}` and then `{"do":"open","id":"sha256:…"}` open one. A `{"do":"js","code":"return …"}` answer arrives in the Metro log as its own line, `HX PROBE …` (#113).

Read these in each section document: `getComputedStyle(…).fontSize` of `p`, `h1`, `.badge` and `.note`, and `getPropertyValue('-webkit-text-size-adjust')` of the root. `{"do":"settings","patch":{"appearance":{"font":null,"size":20}}}` changes the size through the same `setSettings` the sheet calls. The expected values are in `notes/NOTES_2026-09-21.md` (11:31). The Rem fixture's body text lands on the chosen size, with its heading, badge and note in proportion. The Small fixture's is 12px, and it reads 133.33% at 16. The first open of Small is shown at 12px until its first chapter has been counted, then redrawn once at 16. Each Document's decided size is in `Documents/body-text-sizes.json` (`{"version":2,"sizes":{…}}`, ADR 0092). Version-1 answers are automatically ignored and remeasured because Contents or small print could have established them before prose. Delete an entry to have it counted again on the next open. The short fixture has 883 characters in all, so it is never decided and is counted again on every open.

The same measurement on an iPad simulator needs the patched library. `postinstall` applies `patches/@epubjs-react-native+core+1.4.8.patch`, which asks the reader's WebView for its mobile content mode. Without it, an iPad reports the percentage and draws every size unchanged (ADR 0030).

What this does not establish: the stepper's own touches, the number between − and +, the highlight still painting after a change, and the spoken Utterance staying centred. Those need real touches and screenshots.

## Real Documents with front matter longer than the threshold (#363)

Use the owner's original `Atomic Habits.epub` and `My Vampire System 1-250.epub`, copied into a session-owned simulator through the **Real books** recipe. Keep the originals unchanged and outside the repository. The current Debug app and a connected worktree-specific Metro are prerequisites; no Provider or playback is required.

1. Open each Document from its beginning, then browse to prose (Atomic Habits' introduction, spine 5; My Vampire System's first chapter, spine 2). At Font Size 24 the computed dominant prose size must be within 0.03px of 24 in both. Before #363, Atomic Habits reads 30.016px because its copyright/Contents already cross the 2,000-character threshold. The reader's manager renders ahead on its own: a fresh open of Atomic Habits reports `rendered=4/78` in the status line — copyright (2) and Contents (4) sampled through the production bridge — and must hold no `body-text-sizes.json` at that point, where the old sampler already held 12. Measured 2026-11-16 (#363 full-app verification, notes/NOTES_2026-11-16.md): no cache after front matter, prose decides 15.01, and the probe's dominant sizes are 15.997868/23.996803/31.995735 at chosen 16/24/32; My Vampire System decides 16 and computes exactly 16/24/32. Heading/body ratios are constant across sizes (Atomic's introduction 24:15.008 etc.; its small-caps sample keeps a constant 0.70 of body).
2. Read computed sizes without copying book text:

   ```sh
   node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{}' --code-file test/manual-test/settings/body-text-probe.js
   ```

   Read the fresh `HX PROBE` answer from the Debug Log/Metro and match `section` to the prose section, not an adjacent Contents/cover view. The probe reports dominant size/count, smallest sampled size, headings and adjustment, not semantic Body Text eligibility. It scans up to 5,000 non-space characters plus the node reaching that bound. It is a measurement, not a touch test.
3. Check Font Size 16, 24 and 32 on both. Heading/body and note/body ratios must stay constant where those elements exist. Use real Appearance stepper touches for at least one change, then check the visible page and computed result. Do not flatten special sizes.
4. Reopen both and confirm the version-2 cache supplies approximately 15.01px for Atomic Habits and 16px for My Vampire System. A small rounding error in the final size is expected from the existing hundredth-pixel baseline rounding. Reopening leaves the cache bytes unchanged — the answer was supplied by the cache at first paint, not re-decided. For migration, terminate only the session-owned app, stage a version-1 `body-text-sizes.json` with Atomic Habits wrongly recorded as 12px, then relaunch/open prose. Require a version-2 corrected answer and the same chosen Appearance. Preserve/compare the session's settings and Reading Positions around this check; no owner-device file may be edited. Measured 2026-11-16: the staged v1 entry was discarded, Atomic was remeasured 12 → 15.01 in a version-2 file, settings were semantically identical across the migration and the Library/positions fields were unchanged (both books' positions are null without playback; positions are written from the reading's place, and no speech was run just to create one).

5. Set a paused sentence highlight, change size through Appearance, and verify the highlight still paints on the same text after reflow. This needs real input and a screenshot, not only a correct `CSS.highlights` range.

A standalone WKWebView replay of original XHTML/styles/resources can isolate sampling failures, but its stand-in rendition/manager is not full-app acceptance. The host stand-in tests cover eligibility and old-cache rejection, not drawn sizes. A still-unmarked non-body passage styled as prose remains an evidence limit (ADR 0092).

## The stepper, the highlight and the iPad with real touches (`FontSizeProbe.swift`)

`FontSizeProbe.swift`, through `kit/run-probe.sh`: a new output directory generates the project, and an existing one reuses it.

```sh
bash test/manual-test/kit/run-probe.sh FontSizeProbe SIMULATOR_UDID /tmp/openreader-font-size-01 -only-testing:testStepperLadderDisabledEndsAndFontPage
```

- `testStepperLadderDisabledEndsAndFontPage` opens the short fixture with a real tap and walks the ladder 16 → 12 → 32 → 16, asserting every number between − and +. It also asserts that − is disabled at 12 and + at 32, that the "Use document appearance" line is gone, and the round trip through the Fonts page. It leaves the sheet open at 16 so the theme can be switched with the harness for light and dark screenshots of the same sheet. `testCloseAppearanceSheet` then closes it.
- `testHighlightPersistsAndRecentersAfterFontSizeChange` sets a highlight with a coordinate tap on the short fixture's body text, never pressing Play. It then takes the size to 24 in eight taps, screenshots before and after, and restores 16. Judge the re-centring from the two screenshots.
- `testStepFontSizeUpTo32` takes a reader that is already open, at 16, to 32 in sixteen taps. It is for comparing the page across Documents opened with the harness.
- `testHighlightPaintSurvivesSizeChangeOnOriginalBook` is the #363 original-book variant of the highlight test: a real tap on the open prose section sets the paused sentence, eight real stepper touches take 16 to 24, and before/after captures judge the paint (see the recipe section below).
- `testFontSizeAndReaderBehaviourOnIPad` runs on the iPad. From a reader the harness opened, it opens and closes Contents, taps a word, swipes, and goes 16 → 24 → 16.

Prerequisites: the latest Debug app on this worktree's Metro, Font Size 16, and the short fixture in the Library. The two tests that start from an open reader need a Document opened first with the harness's `shut` and `open`. The coordinate taps were chosen from this fixture's own screenshots; a tap that lands between two lines silently does nothing, by design.

What it cannot establish:

- The first open of `Sized Fixture Small`, shown at 12px and then redrawn once at 16. That happens faster than `simctl io … screenshot` can catch.
- Whether a swipe scrolls epub.js's page. The iPad's synthetic swipe produced no visible scroll, which was not pursued.

## Full-app verification of #363 with real touches (`FontSizeProbe.swift`)

`testHighlightPaintSurvivesSizeChangeOnOriginalBook` and `testStepFontSizeUpTo32` cover the original-book interactions: the first assumes the harness has already opened a reader on a prose section at Font Size 16, sets the paused-sentence highlight with one real coordinate tap (dy 0.55 chosen from this run's own screenshots — a tap between two lines silently does nothing), walks 16 → 24 with eight real stepper touches (native `24` readback), judges the paint from before/after captures, and restores 16; the second walks an already-open reader from 16 to 32 with sixteen real touches. Measured 2026-11-16 on Atomic Habits' introduction: the tap's sentence ("The collision sent the soft tissue…") stayed painted across the 24px reflow with `overflowX` 0 at 16/24/32, and the touched size computed 31.995735 against chosen 32. Evidence limits: the after-reflow capture shows the More actions sheet over the page's lower half — the drawer's `Back from Appearance` returns to that sheet rather than closing it (the sheet's `Sheet Grabber` drag is the close) — while the highlighted sentence's first lines stay visible; and an AXe raw-touch round trip (`axe touch`/`axe tap`) set the highlight unreliably beside XCUITest's coordinate tap, so the JS-level same-text hash comparison across the reflow was not completed — the recipe's screenshot judgment is what this verification rests on. The Appearance sheet's dismissal control is `Back from Appearance` on this tree; the pre-#363 probes' `Close Appearance` taps were renamed accordingly, and `testCloseAppearanceSheet` closes through the grabber.
