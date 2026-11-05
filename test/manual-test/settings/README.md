# Settings screens

Each recipe is its own file. Read the one for what you are testing, or the one
that names the script or probe you are about to run.

- [dynamic-type.md](dynamic-type.md) (#62, #114, #101, #102): complete row text,
  live size sweeps, player reflow, Library progress, and physical acceptance.
  `dynamic-type.sh`, `visible-text.swift`.
- [settings-design.md](settings-design.md) (#48, design 0042): OpenReader's
  Settings pages against the phone's own, in both appearances, and the rule
  that locks a provider's or Sync's fields while it is on, by real touches.
  `native-reference.sh` with `NativeReferenceProbe.swift`, `design-shots.sh`
  with `DesignShotsProbe.swift`, `ProviderFreezeProbe.swift`.
- [font-size.md](font-size.md) (#17, ADR 0030): Font Size against Documents that
  set their own body text size, on an iPhone and an iPad, and the stepper and
  the highlight by real touches. `fixtures/sized-fixtures.ts`,
  `FontSizeProbe.swift`.
- [text-alignment.md](text-alignment.md) (#32, #33, ADR 0034): what Left and
  Justify reach in a Document, the Alignment menu inside the Appearance drawer,
  仙逆's CJK justification, and the light theme. `fixtures/alignment-fixture.ts`,
  `AlignmentProbe.swift`.
- [pauses.md](pauses.md) (#60, ADR 0047): General's two Pause rows and their
  menus, at a larger Dynamic Type and across a relaunch, and the measured gap
  between sentences and between paragraphs. `PauseMenuProbe.swift`,
  `fixtures/pause-gap-fixture.ts`, `pause-gap.cjs`.
- [line-position.md](line-position.md) (#71): General's Line position row, its
  menu, and its value across a relaunch. `LinePositionProbe.swift`.
- [margins.md](margins.md) (#344, ADR 0085): 0%–25% per-side Margins,
  taps and accelerating holds, both disabled endpoints and cancellation,
  full-width geometry through rotation/resizing, one-time migration from old
  point values, and Browsing/Following continuity. `margins-probe.js` measures
  the EPUB's boxes; the earlier fixed-point evidence is retained separately.
- [highlight-palette.md](highlight-palette.md) (#122): Highlight's own page —
  the pinned sample, presets, Sentence | Word and the embedded native colour
  palette — by real touches and AXe coordinates, with the no-loop drag, the
  fling-to-scroll rule and the sample's short form at accessibility sizes.
- [highlight-colours.md](highlight-colours.md) (#118): Appearance's
  Highlight section, its preset tiles and ring, and the Sentence and Word
  wells opened, moved to 0 % and dragged live through XCTest, with the drawer
  back in place after the picker. `HighlightWellProbe.swift`.
- [general-and-fonts.md](general-and-fonts.md): General's Theme menu and bracket
  switch, Manage downloads' Delete all audio (always cancelled), the
  Fonts page, which fonts this system has, a font change on the reading page,
  and the `serif`/`sans` migration. `GeneralFontsProbe.swift`.
- [version-line.md](version-line.md) (#30): the Settings version line, the rows
  above it, and both themes. `SettingsVersionProbe.swift`.
- [acknowledgements.md](acknowledgements.md) (#111, design 0065): the Settings
  front page's second card, Acknowledgements' 132 rows against
  `src/app/acknowledgements.json`, two long licence pages (complete, scrolling,
  selectable) and the back button, in both appearances.
  `acknowledgements-check.py`, `../kit/ax.py`.
