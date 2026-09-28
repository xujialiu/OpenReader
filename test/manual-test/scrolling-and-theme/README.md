# Scrolling, flings and theme colours

Each recipe is its own file. Read the one for what you are testing, or the one
that names the script or probe you are about to run.

- [leading-strip.md](leading-strip.md) (#35): a strip of the word highlight's
  colour left above the words it has moved on from, in the reader and in WebKit
  alone. `leading-strip.sh`, `leading-strip-probe.js`, `leading-strip.html`,
  `leading-strip.py`, `fixtures/leading-strip-fixture.ts`.
- [unstyled-chapter.md](unstyled-chapter.md) (#34): a chapter left out of the
  dark theme and Font Size by a fast fling, and by real touches a fling, a tap
  after one, Theme and Font Size applied live, and playback across a chapter
  boundary. `fixtures/scroll-fixture.ts`, `scroll-theme.cjs`,
  `ScrollThemeReaderProbe.swift`.
- [white-flash.md](white-flash.md) (#27): a white page behind the dark reader
  when a book opens, by the harness or a real tap and after a relaunch, and
  during a long fling; the light theme on real Documents. `white-flash.sh`,
  `white-flash.py`, `ScrollThemeReaderProbe.swift`.
- [fling-jump.md](fling-jump.md) (#58, design 0045): a fast scroll that jumps by
  whole chapters or shows an empty page, read frame by frame with every call
  epub.js makes. `fling-jump.cjs`, `fling-jump.sh` with `FlingProbe.swift`.
- [line-colour.md](line-colour.md) (#29): drawers' edges and separators in the
  other theme's line colour, in every pairing of the app's and the phone's
  theme, and chips and checkbox rings by exact pixels. `line-colour.sh` with
  `LineColourProbe.swift`, `line-colour.py`.
- [live-theme-drawer.md](live-theme-drawer.md) (#29, ADR 0046): an open drawer's
  lines when the theme changes under it. `live-theme-drawer.sh`.

`highlight-colour.py` has no recipe: the sentence and word highlight colours in
a screenshot (#69). Its header says how to run it.
