# The two Pauses: General's Reading aloud card, and the gap itself (#60, ADR 0047)

`PauseMenuProbe.swift`, through `kit/run-probe.sh`:

```sh
bash test/manual-test/kit/run-probe.sh PauseMenuProbe SIMULATOR_UDID /tmp/openreader-pause-menu-01 \
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
bash test/manual-test/kit/run-probe.sh PauseMenuProbe SIMULATOR_UDID /tmp/openreader-pause-menu-02 \
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
bash test/manual-test/kit/run-probe.sh PauseMenuProbe SIMULATOR_UDID /tmp/openreader-pause-menu-03 \
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

Add it the way any fixture is loaded (**Real books** in [../README.md](../README.md)): copy into
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
