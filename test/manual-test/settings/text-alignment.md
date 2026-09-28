# Text Alignment and the menu it opens (#32, #33)

Text Alignment reaches body text and passes over what a Document placed itself
(ADR 0034). `alignment-fixture.ts` writes a Document with one element for each
way a book aligns a line, each with an id; its header lists them and what each
should compute under Left and Justify:

```sh
npx tsx test/manual-test/fixtures/alignment-fixture.ts /tmp/openreader-alignment-fixture
```

Copy `Alignment Fixture.epub` into the app's `Documents/Inbox/` and `add` it
with the harness, as for the sized fixtures ([font-size.md](font-size.md)). With it open (`shut`, then
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

`AlignmentProbe.swift`, through `kit/run-probe.sh`. None of its methods
presses Play.

```sh
bash test/manual-test/kit/run-probe.sh AlignmentProbe SIMULATOR_UDID /tmp/openreader-alignment-01
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
