# Settings screens

## Settings against the phone's own Settings (#48, design 0042)

Design 0042 draws the settings pages the phone's way, measured from the phone
rather than remembered, and `SETTINGS` in `src/app/controls.tsx` holds the
numbers. Two runners make the comparison cheap to repeat when the phone's look
changes; each runs its probe once in the light appearance and once in the dark,
then gives the simulator back the appearance it had:

```bash
bash test/manual-test/settings/native-reference.sh SIMULATOR_UDID /tmp/openreader-native-01
bash test/manual-test/settings/design-shots.sh SIMULATOR_UDID /tmp/openreader-design-01
```

- `native-reference.sh` (`NativeReferenceProbe.swift`) opens only the phone's
  own Settings: its front page, General, General › About, and General ›
  Keyboard at the top and scrolled down, which is where a section header over a
  card and a footer under one can be measured.
- `design-shots.sh` (`DesignShotsProbe.swift`) walks OpenReader's Settings,
  General, Providers, Fish Audio, OpenAI Compatible, Sync empty and filled with
  sample values (never switched on, and emptied again afterwards), a reader's
  player and its speed bubble. It never presses Play. The same probe's
  `testSpeedBubble` checks the bubble (one tap is 0.05 each way, a hold
  repeats, the speed is put back, and a tap on Contents while it is open only
  closes it), and `testBackButtonLabels` that every back arrow is labelled
  `Back`; run either with `-only-testing:LockScreenProbe/DesignShotsProbe/<name>`
  as `design-shots.sh` runs its own.

Screenshots land in `<dir>/<appearance>/attachments/`, named by
`manifest.json`. Measure with PIL at the screenshot's own scale (3 pixels to
the point on an iPhone 17): sample a colour in the middle of a surface, and
take a card's edges at its vertical middle, since its rounded top cuts in.

- **The simulator's Settings has no page of labelled text fields.** iOS 27.0's
  simulator has no VPN configuration and no Mail, the two places the phone sets
  up an account in rows of `Label  value` fields, so `NativeReferenceProbe`
  captures neither, and the field rows' value column is the one thing on these
  pages not checked against a measurement.

A third runner covers what the two above do not — real touches on the freeze
rule itself, not just its resting screenshots:

```bash
bash test/manual-test/settings/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-01 -only-testing:testFailurePathsNoCredentials
bash test/manual-test/settings/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-02 -only-testing:testSyncRefusalPathAlone
bash test/manual-test/settings/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-03 -only-testing:testFishVoicesFieldAndEnableDisableCycle
bash test/manual-test/settings/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-04 -only-testing:testPressedRowHighlightsEdgeToEdge
bash test/manual-test/settings/provider-freeze.sh SIMULATOR_UDID /tmp/openreader-freeze-05 -only-testing:testDynamicTypeSpotCheck
```

`ProviderFreezeProbe.swift` (independent #48 verification, 2026-09-23):

- `testFailurePathsNoCredentials` — a bogus OpenAI key and an unreachable
  OpenAI Compatible address (in practice both are refused by a client-side
  "needs a model" check before either would reach the network — see
  Pitfalls, Sync's own timeout gap), then Sync against an address that cannot
  resolve. Each must end its switch off with a reason under the first card
  and its fields still editable; leaves every provider disabled and Sync
  empty. Prefer `testSyncRefusalPathAlone` for Sync alone — it waits for the
  check to *begin* before waiting for it to end (see Pitfalls) and is faster.
- `testFishVoicesFieldAndEnableDisableCycle` — needs the real key in
  `/tmp/openreader-fish-key.txt` (skips itself otherwise). The Voices field
  revealed by Manual voices, while unlocked: its placeholder, that it raises
  the keyboard, and that it stays reachable above it. Then the real
  enable/disable cycle: `Testing…` best-effort caught live, `Turn off to
  edit.`, `Connection successful`, the fields and the whole Voice sources
  card locked, the eye toggle's existence (never tapped — no capture here can
  then show the key), the Providers/Settings counts, and disabling again.
  Ends with Fish disabled and no stored key. If it fails partway (it did
  once, on an unrelated assertion — see Pitfalls), Fish may be left enabled
  with a real key stored: `testVoiceSourcesLockIsFunctionalThenCleanUp`
  reads the live state rather than assuming it, and disables/clears either way.
- `testPressedRowHighlightsEdgeToEdge` — a mid-hold screenshot taken from a
  background queue during `press(forDuration:)`, rather than a video
  recording, to catch a pressed `NavigationRow`'s highlight.
- `testDynamicTypeSpotCheck` — captures only, judged by eye; run with
  `xcrun simctl ui UDID content_size extra-extra-large` set first and
  restored after (the caller's job, not the probe's).
- `testReturnToLibrary` — walks back to the Library from wherever the app was
  left, for ending a session cleanly.

## Font Size against Documents that set their own sizes (#17)

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

### The stepper, the highlight and the iPad with real touches (`FontSizeProbe.swift`)

`font-size.sh` runs `FontSizeProbe.swift`. It has the same shape as `general-fonts.sh`: a new output directory generates the project, and an existing one reuses it.

```sh
bash test/manual-test/settings/font-size.sh SIMULATOR_UDID /tmp/openreader-font-size-01 -only-testing:testStepperLadderDisabledEndsAndFontPage
```

- `testStepperLadderDisabledEndsAndFontPage` opens the short fixture with a real tap and walks the ladder 16 → 12 → 32 → 16, asserting every number between − and +. It also asserts that − is disabled at 12 and + at 32, that the "Use document appearance" line is gone, and the round trip through the Fonts page. It leaves the sheet open at 16 so the theme can be switched with the harness for light and dark screenshots of the same sheet. `testCloseAppearanceSheet` then closes it.
- `testHighlightPersistsAndRecentersAfterFontSizeChange` sets a highlight with a coordinate tap on the short fixture's body text, never pressing Play. It then takes the size to 24 in eight taps, screenshots before and after, and restores 16. Judge the re-centring from the two screenshots.
- `testStepFontSizeUpTo32` takes a reader that is already open, at 16, to 32 in sixteen taps. It is for comparing the page across Documents opened with the harness.
- `testFontSizeAndReaderBehaviourOnIPad` runs on the iPad. From a reader the harness opened, it opens and closes Contents, taps a word, swipes, and goes 16 → 24 → 16.

Prerequisites: the latest Debug app on this worktree's Metro, Font Size 16, and the short fixture in the Library. The two tests that start from an open reader need a Document opened first with the harness's `shut` and `open`. The coordinate taps were chosen from this fixture's own screenshots; a tap that lands between two lines silently does nothing, by design.

What it cannot establish:

- The first open of `Sized Fixture Small`, shown at 12px and then redrawn once at 16. That happens faster than `simctl io … screenshot` can catch.
- Whether a swipe scrolls epub.js's page. The iPad's synthetic swipe produced no visible scroll, which was not pursued.

## Text Alignment and the menu it opens (#32, #33)

Text Alignment reaches body text and passes over what a Document placed itself
(ADR 0034). `alignment-fixture.ts` writes a Document with one element for each
way a book aligns a line, each with an id; its header lists them and what each
should compute under Left and Justify:

```sh
npx tsx test/manual-test/fixtures/alignment-fixture.ts /tmp/openreader-alignment-fixture
```

Copy `Alignment Fixture.epub` into the app's `Documents/Inbox/` and `add` it
with the harness, as for the sized fixtures above. With it open (`shut`, then
`open` by its Document Id), this harness `js` probe answers with every id's
computed `text-align`, a `*` where the program marked it as the Document's own,
and the section's height:

```js
var ids=['h-plain','h-centred','h-block','h-left','p-plain','p-left','p-justify','break','verse','verse-1','verse-2','signature','end','inline','legacy','li','td-word','td-num'];
var c=rendition.getContents()[0]; var d=c.document; var w=c.window;
return ids.map(function(id){var e=d.getElementById(id); if(!e) return id+'=?'; return id+'='+w.getComputedStyle(e).textAlign+(e.hasAttribute('data-openreader-own-alignment')?'*':'');}).join(' ')+' h='+d.body.scrollHeight;
```

Switch with `{"do":"settings","patch":{"appearance":{"font":null,"size":16,"textAlignment":"left"}}}`
and probe again. The answers of 2026-09-22 are in `notes/NOTES_2026-09-22.md`
(12:46): marked elements unchanged, body text `justify` or `start`, and the same
height under both. The page program is baked in when the reader opens, so after
changing `highlighter.ts` shut and reopen the reader before probing. A
program that opened before the change has none of it.

`alignment.sh` runs `AlignmentProbe.swift`, the same shape as
`font-size.sh`. None of its methods presses Play.

```sh
bash test/manual-test/settings/alignment.sh SIMULATOR_UDID /tmp/openreader-alignment-01
```

- `testChooseFromMenuInsideDrawer` opens the short fixture's Appearance drawer
  with real taps. It opens the Alignment menu and requires both items. It
  chooses the one not in force and requires the menu gone, the drawer still open
  and the row saying the new value, then chooses back.
- `testDismissWithoutChoosing` opens the menu and taps the drawer's title, then
  opens it again and taps the page above the drawer, where the backdrop that
  closes the drawer is. It requires the first to close only the menu, and
  records whether the drawer survived the second (`backdrop-tap-result`). On
  2026-09-22 it did.
- `testHighlightSurvivesASwitch` needs `Alignment Fixture` in the Library, open
  at the top of its chapter. It taps its first paragraph at normalized
  (0.5, 0.36), which sets the highlight without playback, then switches Left and
  back through the menu, photographing each. The judgement is the screenshots:
  the same words highlighted at the same height.

What it cannot establish: whether VoiceOver reads the row as a button (XCTest
sees the trait, not speech), and anything about a right-to-left Document,
since none is here.

Two more methods, added during independent #32/#33 verification (2026-09-22),
not part of the issue's own plan:

- `testXianniChapterOneBothAlignments` swipes forward from 仙逆's cover (four
  `app.swipeUp()`s, screenshotting every step, since a synthetic swipe's
  distance on this content was not known in advance — the first two can still
  read "Laying the document out…", and the fourth is what lands with `第1章
  离乡` at the top of the screen) and photographs chapter 1 under Justify,
  then Left through the menu, then restored. A pixel diff of the Justify and
  Left screenshots (2026-09-22) found no difference above y=1880 (the cover,
  the decorative pages and the centred chapter title/number) and 71,205
  differing pixels of 3,162,132 (2.3%) below it, confined to the paragraph
  text; the restored-Justify screenshot was byte-identical to the original.
  CJK justification is a small, real effect — inter-character spacing on a
  non-final line, not the ragged-versus-flush difference an English fixture
  shows — so judge it by a diff, not by eye alone.
- `testAppearanceAndAlignmentMenuInLightTheme` switches the app to Light
  through General's Theme menu, opens the short fixture's Appearance drawer
  and the Alignment menu there, dismisses without choosing, and restores
  whichever theme the device had. Confirms the drawer and the native menu are
  both drawn light, not only dark.

Independent verification also found `GeneralFontsProbe.testFontsPageListAndBackButton`
failing for a reason unrelated to #32/#33: see **Pitfalls**, XCTest.

## The two Pauses: General's Reading aloud card, and the gap itself (#60, ADR 0047)

`pause-menu.sh` runs `PauseMenuProbe.swift`, the same disposable-project shape
as `alignment.sh`:

```sh
bash test/manual-test/settings/pause-menu.sh SIMULATOR_UDID /tmp/openreader-pause-menu-01 \
  -only-testing:testReadingAloudCardLayoutAndBothThemes \
  -only-testing:testSentencePauseMenuRealTouches \
  -only-testing:testParagraphPauseMenuRealTouches
```

Real touches, from a fresh launch each method: General's layout (Theme's card
with no header, the "Reading aloud" header over exactly the two Pause rows, the
bracket card directly below with no header of its own), each row's own
accessibility label at the fresh-install default (`Pause between sentences, 0
ms` / `Pause between paragraphs, 200 ms`), both themes, then each menu in turn —
all ten values present in top-to-bottom screen order (a `frame.origin.y`
comparison between consecutive items, which is what would catch
`menuOrder('fixed')` being dropped), the default checked, choosing updates the
row, and choosing back restores it. Never presses Play.

A fourth method needs a larger Dynamic Type set before it runs and restored
after, the same convention `ProviderFreezeProbe.testDynamicTypeSpotCheck` uses:

```sh
xcrun simctl ui SIMULATOR_UDID content_size extra-extra-large
bash test/manual-test/settings/pause-menu.sh SIMULATOR_UDID /tmp/openreader-pause-menu-02 \
  -only-testing:testParagraphMenuAtLargerDynamicType
xcrun simctl ui SIMULATOR_UDID content_size large
```

It records the paragraph row's own screen position before opening the menu —
**measured 2026-09-25 at `extra-extra-large`**: `origin.y=303.3, height=53.0`
against an `app.frame.height` of `874.0`, so the row sits at about 35-41% down
the screen, not near the bottom. The drawn row's `settingRow` style has only a
`minHeight`, but `ChoiceMenu` gives its host the fixed row height
(`SETTINGS.rowHeight`, 53), so a `ValueRow` never grows and its label cannot
take a second line (below). The
ten-item menu itself still opened with every value present and in the declared
top-to-bottom order (`assertMenuOrder`, reading each item's own
`frame.origin.y`) — the regression `menuOrder('fixed')` guards against was not
reproduced here, but neither was the specific "opens upward near the bottom"
geometry the risk names; General's content was too short to test that
sub-case this way.

Choosing `2000 ms` is what shows the other named risk. **Measured 2026-09-25 at
`extra-extra-large`, a clean single run** (notes, 00:01;
`general-larger-dynamic-type` and `paragraph-row-2000-larger-dynamic-type` in
this run's own captures): the
sentence row drew in full, `Pause between sentences   0 ms`, but the paragraph
row drew as `Pause between paragrap[…]  200[…]…` at rest and `Pause between
paragrap[…]  2000…` after choosing `2000 ms` — the label itself cut mid-word
("paragraphs" losing "hs"), and the value losing its unit entirely behind an
ellipsis. The row's own accessibility label was unaffected the whole time —
`paragraphRow(app).label` read the full `Pause between paragraphs, 2000 ms`
in the same run the drawn text was clipped — so a VoiceOver user hears the
whole sentence and a sighted one reads a clipped line. `ValueRow`'s label and
value are both `flexShrink: 1` competing for one row's width with a `gap: 12`
and no `LabelColumn` (that measured-width mechanism is `FieldRow`'s only);
`Theme`'s row (`Theme` / `Match Device`) fit at the same size because its label
and value are each shorter than the paragraph row's, so this looks like a
pre-existing property of `ValueRow` generally, first exposed by a label as
long as `Pause between paragraphs` paired with a 4-digit value. Not reproduced
at the standard default size, where both rows read in full (see the two prior
methods' own captures). The most extreme accessibility content sizes
(`accessibility-…-large`) are not this probe's target and were not measured
cleanly: a first look at `accessibility-extra-extra-extra-large` produced
visuals that looked like two screens' text overlapping, but that look followed
navigating to `General` twice in a row through the harness's
`{"do":"go","route":"General"}` without going back first, which is not a
navigation a real touch would ever produce — not trusted as a genuine
rendering defect, and not pursued further.

A fifth method chooses `300 ms` and `1500 ms` by touch, relaunches, and reads
both rows again. It leaves them chosen, so `settings.json` can be read in that
state afterwards; put the defaults back when done.

```sh
rm -f "$(xcrun simctl get_app_container SIMULATOR_UDID top.xujialiu.openreader data)/Documents/harness.json"
bash test/manual-test/settings/pause-menu.sh SIMULATOR_UDID /tmp/openreader-pause-menu-03 \
  -only-testing:testPauseValuesPersistAcrossRelaunch
```

**Remove `harness.json` first**, or the run measures the harness. The app
re-runs the file's last command at every launch (**Pitfalls**, "The walkthrough
harness re-runs its last command on every launch"), and `pause-gap.cjs` below
leaves a `settings` patch or a `seek` there. On 2026-09-25 this method failed at
00:08 (`Pause between sentences, 0 ms` after the relaunch) because the file
held `{"do":"settings","patch":{"pauses":{"sentenceMs":0,"paragraphMs":200}}}`,
and passed at 00:22 while it held a patch of the same `300`/`1500` the method
chooses, which a replay produces as well. Neither run said anything about the
app. With the file removed it passed at 01:04 (notes, 01:02 and 01:04).

`pause-gap-fixture.ts` and `pause-gap.cjs` measure the pause itself, not the
menu. Neither `A Short Test of Reading Aloud` nor `Pause Order Fixture` (this
directory's other generated fixtures) can show the **sentence** pause: both
put exactly one sentence in every `<p>`, so every adjacent pair of Utterances
in either one starts a new Block, and only the **paragraph** pause is ever in
play. `pause-gap-fixture.ts` writes one paragraph with three sentences, so
Utterances 1-2 and 2-3 share a Block while 0-1, 3-4 and 4-5 each start a new
one — both cases in six short Utterances:

```sh
npx tsx test/manual-test/fixtures/pause-gap-fixture.ts /tmp/openreader-pause-gap-fixture
```

Add it the way any fixture is loaded (**Real books**, above): copy into
`Documents/Inbox` and `{"seq":N,"do":"add","file":"Pause Gap Fixture.epub"}`.

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID   # once; pause-gap.cjs also `set`s and `check`s immediately before its own Play
OPENREADER_METRO=http://127.0.0.1:PORT node test/manual-test/settings/pause-gap.cjs SIMULATOR_UDID \
  "$(xcrun simctl get_app_container SIMULATOR_UDID top.xujialiu.openreader data)" \
  DOC_ID SENTENCE_MS PARAGRAPH_MS START_UTTERANCE [TRANSITIONS=1]
```

A targeted handler probe (CDP), not a touch test: it patches
`settings.pauses` and opens the Document through the same file-based harness
`shell.tsx` answers (from the Library, one command at a time, so a fresh
engine is built after the patch — ADR 0047's own rule), then switches to CDP
alone for `seek`/`Play`/`Pause` and all timing, polling `status().utterance`
about every 25-30 ms (the harness file's own poll is 250 ms, and the reader's
on-screen log line is 500 ms — both too coarse for a ~1000 ms gap). It prints
one `SAMPLE t=… u=… playing=… level=…` line per poll and one `TRANSITION a ->
b at t=…` line per Utterance change, then a `RUN …` summary; run the same pair
twice under different settings and diff the `TRANSITION` timestamps — the
Utterance's own speech duration is the same both times once its Clip is
cached, so the difference isolates the gap. Requires an enabled Provider with
Word Timings and a chosen Voice already set (`{"do":"voice",...}`) and the rate
at 1.0 (`{"do":"rate","rate":1}`), both one-time, session-wide setup outside
this script.

Time the intervals **between** transitions rather than one transition from
Play. From Play, the time also holds the start-up: the first Clip's fetch and
decode, which differs from run to run. Started on Utterance 1 with
`TRANSITIONS=3`, one run gives two intervals:

- `I2` = `2 -> 3` minus `1 -> 2`: Utterance 2's speech plus the pause after it,
  inside the Block.
- `I3` = `3 -> 4` minus `2 -> 3`: Utterance 3's speech plus the pause at the
  Block.

Run it twice, as B with `1000 0` and C with `0 1000`. `I2` should be about
1000 ms longer in B, and `I3` about 1000 ms longer in C. If the paragraph pause
were added to the sentence pause rather than replacing it, B's `I3` would be
1000 ms longer as well.

Measured 2026-09-25 (notes, 01:08), Azure `en-US-AndrewNeural`, rate 1.0: `I2`
4469 ms in B against 3454 ms in C (+1015), and `I3` 3289 ms in B against
4303 ms in C (+1014 in C). Each transition was sampled within 29–52 ms. Each
run played until its third transition and paused there, 13.5 s and 11.2 s.

## General's Line position row (#71, `line-position.sh`, `LinePositionProbe.swift`)

```sh
bash test/manual-test/settings/line-position.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR
```

The same disposable-project shape as `pause-menu.sh`. From a fresh launch, with
real touches: Settings → General, the row `Line position, N%` below the paragraph
pause and above the brackets' card, its menu 20% to 80% top to bottom with only
the row's value checked, 30% chosen (the row then reads `Line position, 30%`),
and the original value chosen back. Never presses Play. It relaunches the app,
so silence the simulator again before the next play, and reopen the reader with
`{"do":"open","id":"sha256:…"}`. 0 failures in 29.2 s (2026-09-26 11:12).

```sh
bash test/manual-test/settings/line-position.sh SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR \
  -only-testing:testLinePositionMenuRealTouches -only-testing:testLinePositionPersistsAcrossRelaunch
```

`testLinePositionPersistsAcrossRelaunch`, the same convention as
`PauseMenuProbe.testPauseValuesPersistAcrossRelaunch`: chooses 40% by real
touch, `app.terminate(); app.launch()`, and requires the row still reads 40%
after the cold start, then restores 50%. **Remove
`Documents/harness.json` first** (README Pitfalls, "Two harness commands
written back to back run only the second" / "The walkthrough harness re-runs
its last command on every launch") — a leftover `settings` patch from an
earlier `line-follow.cjs` run would silently rewrite the Line Position right
after the relaunch, the same trap `pause-menu.sh`'s own persistence method
documents. Both methods together: `Executed 2 tests, with 0 failures (0
unexpected) in 72.327 (72.338) seconds` (2026-09-26 11:41), and the device's
own `settings.json` read `{"linePosition":50}` afterwards.
