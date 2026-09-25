---
status: accepted
---

# The bar floats, the page keeps room for it, and the Reading Button only shows the player

_The product argument is [design 0048](../design/0048-collapsing-leaves-the-page-and-one-button.md).
Issue #67. It revises decision 4 of [ADR 0020](0020-the-player-rides-the-existing-seek.md)
("collapsing leaves one play button")._

## What was done

- **One state.** `reading-view.tsx` computes `chrome = !(collapsed && notes.length === 0)`,
  which is the condition `player.tsx` already used to draw itself in full, and
  reports it through `onChrome`. `reader-screen.tsx` sets
  `navigation.setOptions({ headerTransparent: true, headerShown: chrome })`. The
  one `pause` handler still sets `collapsed` to false, so a pause from the
  lock screen, Control Centre or a remote (ADR 0016) brings back the bar as well
  as the player, and a note does the same.
- **The bar floats.** `headerTransparent` keeps the header's own background
  (`headerStyle.backgroundColor`, the page colour from the shell's
  `screenOptions`, is passed through as the bar's background), so it looks the
  same while it is shown. The Reader's root `View` takes
  `paddingTop: useSafeAreaInsets().top`, so the page starts below the status
  bar and never under the clock. The bar lies over the top 54 points of the
  WebView.
- **The centring is told.** A new `BarMessage` (`{ kind: 'bar', coveredPx,
  reservedPx }`, `bridge.setBar`), re-sent on the document message like the
  inset. `coveredPx` is the bar's height while it is shown and 0 while it is
  hidden. `centre()` aims at the middle of the band between it and the
  player's `covered`, and a taller-than-the-screen Utterance starts just below
  it. Nothing is re-centred when either number changes, for the same reason as
  the inset.
- **The page keeps room for the bar.** `reservedPx` is the bar's height whether
  or not it is shown. `reader-screen.tsx` takes it from `useHeaderHeight() - top
  inset` and holds the last positive value, because the header height is 0
  while the header is hidden. In the WebView `reserve()` writes one rule into a
  `<style id="openreader-bar">` in the top document,
  `.epub-container::before { content: ""; display: block; height: Npx; }`, and
  `landBelowBar()` wraps the view class's `offset()` to subtract it.
- **The Reading Button** (`reading-button.tsx`) replaces the collapsed
  `Transport`. It is a `Pressable` 52-point circle in `INK.text` holding an
  `@expo/ui` `Image` of the SF Symbol `waveform`, with
  `symbolEffect({ effect: 'variableColor', fillStyle: 'iterative', inactiveLayers: 'dim' }, { isActive })`,
  where `isActive` is a `useNativeState` kept equal to `playing`. It shows
  `LoadingSpinner` while `buffering`. Its `onPress` is `onCollapsed(false)` and
  nothing else. `accessibilityLabel` is `Show the player`, and
  `accessibilityValue` is `Playing` or `Paused`. It is never disabled: it only
  shows controls. Its place, `READING_BUTTON_PLACE`, is exported for #68.
- `@react-navigation/elements` became a direct dependency, at the 2.9.43 the
  lockfile already held for native-stack, for `useHeaderHeight`.

## The facts it was built on

Measured on the iPhone 17 simulator, iOS 27.0 (notes, 2026-09-25 22:29–23:17).

- **An opaque bar cannot be hidden without moving the text.** With the bar in
  the layout, the WebView is 402×758: 874 − 62 (status bar) − 54 (bar). Hiding
  it gives those 54 points back to the WebView, which resizes. A resize destroys
  every epub.js view (`highlighter.ts`, "the blank open"), and the text moves by
  the bar's height either way.
- **Floating, nothing moves.** With `headerTransparent`, the WebView is 402×812
  whether the bar is shown or hidden. The fixture's first paragraph sat at
  196.88 points on screen both before the change (116 + 80.88) and after it
  (62 + 134.88, with the 54-point room above). In a screen recording of a hide
  and a show, resampled at 60 frames a second, the first row of text stayed at
  y = 437 px in all 289 frames. The bar slid out over about five of them and
  back in over about five: react-native-screens hides it with
  `setNavigationBarHidden:animated:`. With a transparent or hidden header it
  keeps `edgesForExtendedLayout = UIRectEdgeAll`, so the screen's frame does not
  change either.
- **The bar is 54 points.** Before the native header reports, native-stack
  uses its own guess (`getDefaultHeaderHeight`): 44, plus a status bar it takes
  as the top inset less 5⅓ points on a phone with a Dynamic Island, about 100.7
  in all. The native header then reports 116, and the room follows the reported
  height (54 in the `openreader-bar` rule, read back from the WebView). If the
  room changed after the page had laid out, the text would move by the
  difference once. It had not moved in the measurements above, because the report
  arrives before the book is read and laid out. A change in the bar's own height
  would move the text the same way, and hiding the bar never does.
- **The room is a pseudo-element because padding resizes the stage.** epub.js's
  stage measures the container's content box, so a `padding-top` on
  `.epub-container` shrinks the size the manager lays out to and triggers the
  resize above. A `::before` takes room in the scroll without changing the box.
  The continuous manager prepends views with
  `insertBefore(view, container.firstChild)`, and a pseudo-element is not a
  child, so it stays first.
- **Where epub.js lands a display.** In the bundled epub.js a display after
  `clear()` starts from `scrollTop` 0, so a section it has to lay out lands below
  the `::before`. A target inside it is reached with the continuous manager's
  `moveTo`, which is `scrollBy(locationOf(target).top)` and lands at the same
  place. A section already on the page is displayed with
  `scrollTo(view.offset().top)`. The container is `position: relative`, so
  `offsetTop` counts the `::before`, and the section's first line would go under
  the bar. `offset()` is read in that one place in the bundle (a test holds it),
  so subtracting the room there moves nothing else.
- **The edge swipe survives a hidden bar.** A real swipe from the left edge
  with the bar hidden popped the Reader (`ReadingButtonProbe.testEdgeSwipeWhileCollapsed`).
- **The WebView's text is not in the accessibility tree** (its sections are
  iframes), so the probe reads "the text did not move" off screenshots: ink per
  point row from 120 to 700, before and after. Collapse and restore, paused
  and playing: 0 of 580 rows differed in the final run (notes 23:17). One run
  while playing differed in 1 row, the edge of the moving highlight.

## Alternatives

- **An opaque bar, hidden.** Moves the text, and resizes the WebView (above).
- **An opaque bar, with the page scrolled by the bar's height to compensate.**
  The resize still destroys the views, and the scroll and the reflow land on
  different frames.
- **Padding on the container instead of the `::before`.** Resizes the stage.
- **Room only at the top of the document, with no `offset()` wrap.** A Contents
  row for a chapter already on the page would put its heading under the bar.
- **A glyph drawn in the app's own icon set.** Design 0042's first step is the
  phone drawing it, and the phone's waveform is the one it shows beside audio
  that is playing. `@expo/ui` 57 draws the symbol and runs its `variableColor`
  effect natively (`symbolEffect`, `useNativeState`), so it costs no animation
  code.
