---
status: accepted
---

# The page behind the document is the reader's own, not the library's white

_Technical only: there is no design half. Issue #27._

**This corrects a claim made in ADR 0021 and in the comment on `scheme` in
`reader-bridge.ts`**: that because the Appearance and the theme are baked into
the program, a book opened under them is drawn that way "on its first paint". The
program is installed only after the library has displayed the first section, so
that section is always drawn once before the program reaches it.

## The defect

With the dark theme, the owner saw the reading page flash white on the physical
iPhone: briefly when a book was tapped in the Library, and during a long, fast
scroll through a book. #27 had recorded the same white already, below the end of
a short document and while a document was being laid out.

## What was measured

iPhone 17 simulator, iOS 27.0, 2026-09-23 and 24, the owner's "My Vampire System
1-250" (925,559 bytes), app theme dark on a light simulator. The screen was
recorded with `simctl io recordVideo` and every frame's page area read by
`test/manual-test/white-flash.py`: white when more than 30 % of it has luminance
above 200. A dark page of text reads 4–6 %, a white page 91–98 %.

- **Opening**, 5 of 5 runs: the reader slid in with its page already white, and
  "Laying the document out…" sat on the white for 1.6–3.4 s. Then the first
  section appeared as black text on a white page for about 60 ms, two frames,
  and only then turned dark.
- **A long fling**: real XCTest swipes, fast, 10 or 15 each way, were red in 3
  of 3 runs: 35 ms of white under the text going forward, 50–600 ms of a whole
  white page going back towards the start. The same distance scrolled from
  JavaScript, 60 frames of `scrollTop += 300`, was green in 52 frames.
- **Which layer.** With the template's `html`, `body` and `#viewer` painted
  magenta and epub.js's scroll container green, the same flings gave 0 white,
  0 magenta and 53 green frames. The white is the scroll container wherever no
  section covers it, and the container is transparent down to the WebView.

Read out of `@epubjs-react-native/core` 1.4.8, and pinned in
`test/renderer/rules.test.ts`:

- `View.js` gives the WebView `backgroundColor: theme.body.background`, and the
  library's default theme (`context.js`) has `body: { background: '#fff' }`. The
  app passed no `defaultTheme`, so the WKWebView was opaque white.
  react-native-webview makes a WebView whose colour has an alpha below 1
  non-opaque and stops it drawing a background (`RNCWebViewImpl.m`,
  `setBackgroundColor`: `opaque = alpha == 1.0`, `drawsBackground`).
- The template sets no background on `html`, `body` or `#viewer`.
- `View.js` injects the app's `injectedJavascript` from the `onReady` message,
  which the template posts after `rendition.display()` has resolved: the first
  section is on screen, under the library's theme, before the program exists.
- `theme` in `View.js` is the **provider's** state, not the prop. The provider's
  `initialState.theme` is the library's white default, and it takes the prop
  only when the template posts `onStarted` (`changeTheme(defaultTheme)`).

## The decision

`<Reader>` is handed `READER_THEME` (`src/renderer/highlighter.ts`) through
`readerProps.defaultTheme`: the library's default theme, rule for rule, with
`body.background` `transparent` instead of `#fff`. Wherever no section is
drawn, the reader's own view behind the WebView shows, and it is `INK.page`:
`#111114` under the dark theme, `#ffffff` under the light one, a dynamic colour
that follows a live change of theme.

It reaches three places with one value: the WebView's own colour; the template
and the scroll container, which have none of their own; and the first section's
page before the program's `themeCss` reaches it, which the library styles with
the same theme.

**And the provider is given it before the first WebView exists.** With the prop
alone, opens were green except the first after a launch, which was white for
0.46–1.5 s in 6 of 6 relaunches opened as soon as the app answered: the WebView
was created while the provider still held the white default, and a WKWebView
created opaque white stayed white after its colour became transparent, until
the first section covered it.
`useReaderBridge` therefore calls `changeTheme(READER_THEME)` in an effect when
the provider's `theme` is not already it. `<Reader>` is rendered only after the
reading view has measured itself, a layout later, and React runs the effect
before that render. The provider sits above the navigator and keeps its state,
so the call happens once per launch, before any WebView has been registered,
and the library's injection into one is skipped by its own `book.current?.`.

## Consequences

- Under the light theme nothing visible changes: the page behind is `#ffffff`,
  the colour the library painted. Measured: the short fixture read 255 below its
  last line, the owner's book black on white.
- The library's text rules are kept, `#000 !important` on `span`, `p`, `li`,
  `h1` and `a` included. So for the ~60 ms before the program styles the first
  section under the dark theme, its text is black on the dark page: a dark
  frame, not a white one. Installing the program before the first display would
  remove that frame too, and needs a patch (below).
- epub.js still leaves gaps in a long fling: 13–55 frames per run in which the
  page area is empty. They are now the dark page.
- `READER_THEME` copies the library's rules, so a library upgrade that changes
  its default would leave this copy behind; the rules test evaluates the
  installed default and fails on any difference but the background.

## Alternatives

- **Paint the template dark from the program, and pass a dark `defaultTheme` only
  under the dark theme.** Two mechanisms for one colour, a WebView colour fixed
  at mount that misses a live change of theme, and the page before the program's
  installation — which follows the first display — would stay white.
- **Install the program before the book is displayed**, through
  react-native-webview's `injectedJavaScriptBeforeContentLoaded`. The library
  does not pass that prop through, so it needs a `patches/` change, and it does
  nothing for the WebView's own colour or for the gaps in a fling.
- **Patch the template to colour `html`, `body` and `#viewer`.** The library
  already takes the theme as a prop; a patch would be a second copy of the
  palette in a file the project does not own.
- **Patch the provider's initial theme** instead of the effect. The same result
  through a file the project does not own, for a state the public `changeTheme`
  already sets.

## Tested

`test/renderer/rules.test.ts`: the library facts above, pinned in the installed
package; `READER_THEME` equal to the installed default but for a transparent
page; `defaultTheme` declared and given in `readerProps`; the provider effect.
Each new rule was seen failing before its change.

On the simulator, with `test/manual-test/white-flash.sh`, before → after: `open`
5 of 5 red → 0 of 5; `relaunch` 6 of 6 red → 0 of 6; `fling` 3 of 3 red (49 and
71 white frames) → 0 of 3. The same script, run against the tree with only
`reader-bridge.ts` put back, was red on `open` and `relaunch` again. The light
theme, a live switch to dark with the book open, and the short fixture's page
below its last line were checked by screenshot. Measurements and times are in
`notes/NOTES_2026-09-23.md` and `notes/NOTES_2026-09-24.md`.

Not established: the physical iPhone, where the owner saw it; its screen could
not be recorded (`test/manual-test/README.md`, Pitfalls, **Physical iPhone
screen**).
