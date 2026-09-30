---
status: accepted
---

# The Reading is held above the navigator and moved into the Reader by a native reparent

_The product argument is [design 0049](../design/0049-the-reading-goes-on-in-the-library.md).
Issue #68. It revises the Reader's life in [ADR 0019](0019-a-native-stack-and-a-persisted-library.md):
the reading no longer stops when the Reader screen unmounts._

## What was done

- **One owner, above the navigator.** `reading-host.tsx`'s `ReadingHost` wraps
  the `NavigationContainer` (inside `ReaderProvider`, a `SafeAreaProvider` and
  `react-native-teleport`'s `PortalProvider`). It holds at most one Reading,
  `{ id, shown, opened, note }`, and renders its `<ReadingView>` inside a
  `<Portal>`. It took over from `reader-screen.tsx` everything that screen used
  to work out for the view: the bytes (`openDocument`, once per Reading, with
  `library.opened` and `sync.poke('open')`), the Voice a new Document inherits,
  a place adopted since the open (#55), and the callbacks that write to the
  Library, bound to the open Document's id.
- **The move.** The `Portal`'s `hostName` is `reader:<id>` while the Reader is
  shown, and undefined otherwise. The Reader renders
  `<PortalHost name="reader:<id>" style={{ flex: 1 }}>` below its status-bar
  padding, so the view is moved into it. Otherwise it stays in the portal's own
  view, which is absolutely positioned from the top inset to the bottom and
  rendered before the navigator, so it sits behind it and has the same 402×812.
- **The screens' contract** (`useHeldReading()`): `show(id)` when the Reader
  arrives (keep this Reading, or end the held one and start this one),
  `left(id)` when it unmounts (keep the Reading if it is playing, end it if
  not), `end(id)` before a delete, `setBarHeight` from the Reader (#67), and
  `current` with `playing`, `buffering` and `chrome`. The view reports those
  through `onState` and `onChrome`, tagged with its own Document so that a
  Reading just started does not inherit the last one's.
- **Ending is unmounting**, as it was. `setHeld(null)` or a new id unmounts the
  view, and its existing cleanup writes the Reading Position and pokes
  `sync('leave')`. `use-reading.ts`'s cleanup disposes the engine and gives
  the audio session back. `useNowPlaying` keeps the lock screen for as long as
  the view is mounted, so it works in the Library.
- **Nothing starts an ended Reading again** (#106). A callback can outlive
  the view: `reading-view.tsx`'s `play` waits up to two seconds for its sync
  before it calls `reading.play()`, and leaving while paused, opening another
  Document or deleting this one ends the Reading meanwhile. The unmount cleanup
  in `use-reading.ts` sets `endedRef` before it disposes the engine, and `play`,
  the only path that builds an engine, and `resumeAt` do nothing once it is set.
  The engine generation could not stop the late call: it takes the generation
  the disposal has already moved on to (notes 2026-09-30 19:27). `disposeEngine`
  is not the signal, because it also runs for a Voice, Provider or credential
  changed while the Reading lasts.
- **The Library** renders the Reading Button (`reading-button.tsx`, at
  `READING_BUTTON_PLACE`, labelled `Return to the reading`) whenever a Reading
  is held. Its press is `navigate('Reader', { id })`, which is also what the
  row does. The list's `paddingBottom` grows by the button's 28 + 52 points
  plus 12. A delete calls `end(id)` before `removeDownloads`.
- While parked, the view's wrapper has `accessibilityElementsHidden` and
  `importantForAccessibility="no-hide-descendants"`. It is behind the navigator
  but still in the window, and without them its buttons were listed over the
  Library's (notes 2026-09-25 23:58): VoiceOver would read
  them, and an XCTest query for a Library row matched the parked player's
  `Playback speed, 1.50 times`.
- `measure` in `reading-view.tsx` ignores a layout under 1 point in either
  direction: the view between two hosts must never hand the WebView a zero
  size.
- `react-native-teleport` is pinned at `1.2.2` (exact, not a range). It is
  Fabric-only, and its codegen spec (`TeleportViewSpec`) is autolinked, so the
  Debug app was rebuilt (`expo prebuild`, `pod install`, `xcodebuild`). It has
  no dependencies. Its peer ranges are `*` for `react`, `react-dom` and
  `react-native`, so the `react-dom` override of ADR 0039 is untouched and
  `npm ci` stays clean.

## The facts it was built on

Measured on the iPhone 17 simulator, iOS 27.0 (notes, 2026-09-25 23:38–23:41).

- **The page cannot be left behind.** It supplies the Blocks, lays out the next
  section (ADR 0023) and paints the highlight. In the parked page,
  `Shadow Slave 1-250` crossed from section 2 into section 3 and laid out
  section 4 (views 3 → 4, scroll height 5,291 → 10,344 px) with the Library on
  screen.
- **A native reparent keeps the WebView as it was.** A global set in the page
  before leaving (`window.__spike`) was the same after leaving and after
  returning. A counter of window `resize` and `rendition` `resized` events stayed
  at 0. `innerWidth` and `innerHeight` stayed 402×812, and
  `document.visibilityState` read `visible` while parked. The engine kept
  playing across both moves, and a pause sent in the Library took.
- **How teleport lays out a moved view.** `PortalView` moves its own children
  between its content view and the host (`removeFromSuperview` then
  `insertSubview`). They are measured through the portal's shadow node using
  the host's native size (`PortalViewState`), and they fall back to the
  portal's own view when the host unregisters (`onHostChanged`). So the parked
  place must be the slot's size, which it is. The `< 1` guard covers a host not
  yet laid out.
- **Moving an ancestor does not tear the WebView down.** Under the new
  architecture `RNCWebViewImpl` destroys its `WKWebView` in `destroyWebView`
  (recycling), not in `removeFromSuperview`. It re-creates one in
  `didMoveToWindow` only when it has none, so a moved ancestor keeps the same
  one.
- **Real touches** (`ReadingHeldProbe`, notes 2026-09-26 00:23): back while
  playing, an edge swipe while collapsed, a lock-screen Pause in the Library,
  a return (collapsed, playing, not reopened), leaving while paused, opening
  another document, deleting this one, and Settings without the button. Five of
  five methods passed.
- **Memory.** With the Reading held in the Library: OpenReader 380 MB,
  WebContent 69, GPU 16, Networking 10, 475 MB in all. With it ended: 390 MB,
  the WebContent and GPU processes gone. So holding it costs about 85 MB.

## Alternatives

- **Candidate 2 of the plan: keep the Reader route in the stack** and push a
  Library over it. It needs the back arrow and the edge swipe intercepted.
  native-stack 7.19 passes a prevented removal to screens 4.26 as
  `preventNativeDismiss`. Read in `RNSScreenStack.mm`, not measured: for a
  native back gesture UIKit completes the pop, and screens then puts the screen
  back so the JavaScript callback can fire (react-native-screens #3885). A
  swipe would have popped the Reader, brought it back, and then had a second
  Library pushed over it. It was not built, because candidate 1 kept the native
  pop and the swipe exactly as they were and needed no second Library route.
- **A layer over the navigator.** It would cover the Reader's own header and
  would not move with the push and pop animations.
- **Rebuild the page after leaving**, or **keep only the engine**. Either
  reloads the document, or the voice stops at the next section.
- **A reparent module of our own.** Fabric owns the view hierarchy, and a view
  moved behind its back has to be reconciled on every mount and unmount. That
  is what `react-native-teleport`'s `PortalView` does, in about 300 lines.
