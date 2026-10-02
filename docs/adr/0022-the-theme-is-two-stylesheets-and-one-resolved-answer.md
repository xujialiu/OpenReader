---
status: accepted
---

# The theme is a dynamic colour, a third string in one stylesheet, and one function that resolves it

_The product argument — what the owner sees, what loses, and what it costs — is
`docs/design/0022-reading-in-the-dark.md`._

_Revised by [ADR 0068](0068-the-highlight-colours-are-the-owners.md) (#118):
both themes paint the owner's Highlight Colours, so `themeCss('dark')`'s two
`::highlight()` overrides below, `#434665` and `#4456de` opaque, are dropped.
Those two colours are now the Blue preset, at 22 % and 62 %, and the default.
The contrasts below are for the opaque marks; ADR 0068 gives Blue's at its
opacities. Where the owner's colours enter the one stylesheet, and so whether
`APPEARANCE` still "declares a font and a size and never a colour", is ADR
0068's to record. `INK.reading` no longer stays amber: the accent follows the
word's colour._

`Settings → General` holds one setting: **light, dark, or follow the system**,
defaulting to follow. It reaches three places, and each of them takes it
differently.

## One resolved answer, because three copies is a white rectangle

`resolveTheme(setting, system)` in `src/app/settings.ts` turns three settings
into two themes, and it is a function rather than a conditional at each call site
because there are three call sites: the app's own colours, the status bar, and
the stylesheet that reaches the page. Three copies of "is it dark" is three
chances for the chrome and the document to disagree, and the way that shows up on
a screen is a white rectangle in the middle of a dark one.

React Native answers with **four** values, not two: `'light'`, `'dark'`,
`'unspecified'` — what a window whose style has been handed back to the system
reports — and `null`, before the platform has said anything at all. Everything
that is not `'dark'` resolves to light, and the asymmetry is deliberate: light is
what the page already is, so a wrong guess corrects to dark within a frame, while
the other way round flashes a black page at someone reading in daylight.

## The app's own colours are iOS dynamic colours, so no screen changed

`INK` in `src/app/controls.tsx` was seven hex strings read by nine files'
`StyleSheet.create` calls, every one of them at module scope. Each entry is now a
`DynamicColorIOS({ light, dark })`: one `UIColor` carrying both values, which
UIKit resolves per view from that view's own trait collection.

That is what let the theme reach every screen without a line changing in any of
them. The alternative was a palette in a React context and every
`StyleSheet.create` in `src/app/` moved inside its component — nine files
rewritten to change a colour, and a re-render of the whole app on every theme
change instead of a repaint.

**Except a border** (#29, ADR 0046). React Native's Fabric view resolves a
dynamic colour against the view's traits for its background but not for its
border, which then follows the phone rather than the forced theme. Every
`border*Color` takes a plain string from `useBorders()` instead.

Forcing a theme is therefore forcing the **window's**
`overrideUserInterfaceStyle`, which is what `Appearance.setColorScheme` does.
Read out of the installed React Native 0.86: `RCTAppearance.mm`'s
`setColorScheme:` walks `RCTSharedApplication().connectedScenes` and sets the
override on each scene's windows — scene-aware, so it still works under the
UIScene life cycle ADR 0018 adopts. `'unspecified'` is what gives the window back
to the system; `null` is not in the method's type.

**Two things will not take a dynamic colour**, and both are in `shell.tsx`:
`@react-navigation/native-stack` types its header and content colours as
`string`, so the navigation bar reads `PALETTE[scheme]` — the same table `ink()`
is built from, exported for exactly these two — and the status bar is told which
of the two it is over rather than left on `auto`, which reads the *system's*
scheme and would be the one thing still light when the owner has chosen Dark on a
light phone.

`ink()` **throws** on any platform that is not iOS, in the house style of
`plugins/with-ui-scene-lifecycle.ts` and for the same reason as
`src/now-playing/`'s refusal: `DynamicColorIOS` has no Android counterpart, and
the alternative — quietly handing back the light value — is a setting that
appears in General, is tapped, and does nothing.

## The page is a third string in the stylesheet ADR 0021 already owns

ADR 0021 established that there is exactly **one** `<style>` element per rendered
section, that `ensureStyle` both creates and updates it, and that its text is
`CSS_TEXT + APPEARANCE`. It is now `CSS_TEXT + THEME + APPEARANCE`, still one
`createElement` and one `appendChild` — `test/renderer/rules.test.ts` counts
them, which is what stopped the theme becoming a second element out of tidiness.

The order is load-bearing in one direction only. `THEME` sits after `CSS_TEXT` so
that its two `::highlight()` rules beat the ones baked in there, which are tuned
for a light page. `APPEARANCE` stays last, and it cannot conflict: it declares a
font and a size and never a colour.

**It is its own message, not a second field on the Appearance message**, and the
difference is the one the WebView acts on. The Appearance handler calls
`restyle()` and then `settle(SETTLE_FRAMES, null, 0)`, because a font change
reflows every line and the sentence being spoken has to be brought back. A colour
change moves not one character. So the theme handler calls `restyle()` and
nothing else — this is the `inset` case, not the font case, and merging the two
would mean running a sixty-frame settle loop for a repaint.

Like `appearanceCss`, `themeCss` builds finished CSS on the React Native side and
the WebView half never reads it, which is what makes the one dangerous property
checkable: **nothing here can declare `user-select`**, which silently stops
`::highlight()` from painting (ADR 0011, ADR 0021, and the 2026-09-19 bisection).
This builder is safer than `appearanceCss` rather than equally safe, because its
whole input is one of two words — so the test enumerates both and asserts every
line it can emit begins `html, body`, `body *` or `::highlight(`.

## The rules, and what they cannot reach

```css
html, body { background-color: #111114 !important; color: #e6e6ea !important; }
body      * { color: #e6e6ea !important; background-color: transparent !important; }
::highlight(openreader-utterance) { background-color: #434665; }
::highlight(openreader-word)      { background-color: #4456de; }
```

- **`themeCss('light')` is the empty string.** Light does not repaint the
  document; it leaves the book exactly as its publisher set it. The asymmetry is
  argued in the design file: dark is a demand the room makes, light is the
  absence of one.
- **The colour is set on the descendants too**, not only on the two roots. `color`
  inherits, so a rule on `html, body` alone is beaten by any book with
  `p { color: … }` of its own — the same trap `appearanceCss` hit with
  `font-family` and the owner's novel's `div { font-family: "zw" }`.
- **`background-color: transparent` on the descendants**, or a book that sets a
  white background on its own paragraphs shows white blocks on a dark page.
- **The highlight is re-tuned rather than inherited, and under dark it is blue**
  (#69). `rgba(255,168,0,0.62)` — the word colour that works under black text on
  white — is close to unreadable under light text on a near-black page. The first
  dark rule painted the word at `rgba(255,176,0,0.85)` and set its text to
  `#111114`, because light letters cannot be read on amber: over the 0.20 sentence
  tint that word composites to `rgb(226,158,2)`, relative luminance 0.405, and
  `#e6e6ea` on it measures **1.85:1**, pure white **2.31:1** (WCAG contrast,
  2026-09-25). The owner saw the spoken word as the one dark word on the page
  and asked for its letters back. An amber that carries `#e6e6ea` at 4.5:1 is
  about `rgb(140,95,0)`, which reads as brown — the same thing `PALETTE`'s comment
  records about a dark amber. Blue has a low luminance while it stays saturated:
  Speechify's dark page, sampled from the owner's screenshot, marks the word in
  `rgb(84,102,240)` (luminance 0.177) and the sentence in `rgb(67,70,101)`, with
  pure white letters at 4.63:1. Here the word is `#4456de`, **4.65:1** against
  `#e6e6ea`, and the sentence is Speechify's `#434665`, **7.33:1**. **Neither rule
  declares `color`**, so the letters are `#e6e6ea` like the rest of the page;
  `test/renderer/rules.test.ts` pins both lines. Both are opaque because the
  page beneath is the single colour `#111114` — `body *` is transparent — so a
  tint buys nothing and would make the measured contrast depend on what it is
  laid over. The light theme's amber and the app's amber accent (`INK.reading`)
  are unchanged; design 0042 states the exception.
- **Neither end is pure.** `#111114` and `#e6e6ea`, not `#000`/`#fff`, and the
  app's own palette uses the same pair so the page and its surroundings are one
  surface.
- **What it cannot do:** an image carries its own colours and is untouched, and a
  book that uses colour to mean something loses that meaning. Both are in the
  design file rather than discovered.
- **It reaches only the sections' own documents.** The page they sit on — the
  library's template and the WebView itself — was the library's white until
  #27, and showed wherever no section was drawn: on opening, below a short
  document, in the gaps of a fast fling. That page is now the reader's own
  `INK.page`; ADR 0043 says how, and what was measured.

## Not in `engineIdentity`, and that is a stronger absence than Appearance's

The rate at least reaches the audio graph. The Appearance changes the page and
not one character of what is spoken. The theme is not even the document's — it is
the room's — so an engine rebuilt for it would re-spend the owner's quota to
change a colour (ADR 0002, philosophy rule 4).

Nothing is stored, because nothing in `AppSettings` is: `settings.ts` records
that its eventual home is ADR 0003's Sync Folder, which is not written. The
screen says so.

## Verified

On the iPhone 17 simulator, iOS 27, against the owner's 仙逆 (34,453,009 bytes),
2026-09-20. The page's mean brightness over a 200×200 patch of body text, and the
navigation bar's over a 300×60 patch:

| theme | simulator's own appearance | page | navigation bar |
| --- | --- | --- | --- |
| Dark | light | **25.9** / 255 | **47.3** / 255 |
| Light | light | **245.6** / 255 | **244.8** / 255 |
| Follow the system | dark | **25.9** / 255 | — |
| Follow the system | light | **245.6** / 255 | — |

The two "follow" rows are byte-identical in brightness to the two explicit ones,
taken by flipping `xcrun simctl ui … appearance` with the app running and never
relaunched — so the live path works and `resolveTheme`'s two branches agree. See
`notes/NOTES_2026-09-20.md`.
