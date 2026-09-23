---
status: accepted
---

# Two fingers select a run of chapters, through the app's own copy of the phone's gesture

The product half is [design 0045](../design/0045-choosing-a-run-of-chapters-with-two-fingers.md); the issue is #57. The measurements are in `notes/NOTES_2026-09-24.md`, 02:15 to 03:13.

## What was built

The download drawer keeps its `FlatList`. A `Gesture.Pan().minPointers(2).minDistance(0).runOnJS(true)` from react-native-gesture-handler 2.32.0, which was already installed for the EPUB reader, is laid over it through a `GestureDetector`, and `App.tsx` now wraps the app in `GestureHandlerRootView`: there was none, and a detector without one throws in development. The drawer is a React Native `Modal`; on iOS the root view at the app's root was enough for the pan to reach JavaScript inside it, and no second one inside the `Modal` is needed (notes, 02:29).

The rules are a pure module, `src/app/range-selection.ts`, tested without rendering (`test/app/range-selection.test.ts`): `rowChapters` says what each shown row stands for, `beginSweep` and `sweepTo` compute the selection, `rowAt` finds the row at a content offset, and `edgeSpeed` says how fast the list scrolls by itself. `src/app/use-sweep.tsx` holds everything the gesture reads in one `SweepController` made once per drawer: where each row was last laid out, the scroll offset, the list's height and content height, and the sweep under way with a 16 ms timer for edge scrolling through `scrollToOffset`. Rows vary in height and only a window of them is rendered, so the positions come from a `CellRendererComponent` wrapper whose `onLayout` gives a cell's offset in the list's content; it still calls the list's own `onLayout`, which virtualization needs. A mounted cell reports again whenever it moves, and a cell forgets its place when it unmounts: folding a volume of a few hundred chapters moves every row below it, including rows far outside the rendered window, and a place kept from before would claim the fingers ahead of the row really under them. That case was found by reading, not on the device. The selection is set again only when the row under the fingers changes, not on every movement.

## The phone's rules, measured in Files

On iOS 27.0, in a list of 60 rows 64 pt tall, with two fingers synthesized by XCTest:

- The run is every row from the one under the fingers when the gesture was recognised to the one under them now. Moving back toward the start gives rows back (2 → 8 → 5 left 3, 4, 5), and moving past it extends the run the other way (5 → 7 → 3 left 3, 4, 5).
- A sweep that begins on a selected row takes rows out; one that begins on an unselected row adds. Rows the run crosses that were already in the state it is making stay as they are, and sweeps add up (3–6, then 4 → 8, left 3; then 10 → 8 gave 3, 8, 9, 10).
- The sweep continues when one finger lifts (2 → 4 on two fingers, 4 → 9 on one: rows 2–9).
- A sideways two-finger drag across a row is a sweep too: it selected that row.
- The list scrolls by itself while the fingers are held near its visible bottom edge: nothing at 774 pt, scrolling at 784 pt, 14–24 pt above the top of Files' floating toolbar at about 798 pt, and on under the toolbar to the screen's edge. With trembling fingers it moved about 1,400–1,600 pt a second beyond the visible edge, no faster at 844 pt than at 804 pt; a still hold just inside the band moved about 900 pt a second. Perfectly still holds sometimes did not scroll at all, which a real finger, never still, does not produce. At the top, a trembling hold at 175 pt, just below the search field, did not scroll; a hold over the search field could not be read back, so the top band is not established.

## Where the copy differs

- **Where a run begins.** The phone's recogniser fired 26–38 pt after the fingers came down, and a quick start began the run on the row after the one touched. Ours activates on the first movement, so the run begins on the row the fingers came down on. That is what the owner asked for, "the rows under them"; the phone's miss is a lag, not a rule.
- **No selecting mode.** The phone's gesture switches a list into its selecting mode; the drawer's selection circles are always shown, so a sweep simply selects.
- **Rows that stand for nothing.** Files has none. A downloaded chapter, one with a ring, or a heading with no text of its own is crossed without change, and a sweep that begins on one adds. UIKit lets an app refuse to begin a sweep on such a row (`tableView(_:shouldBeginMultipleSelectionInteractionAt:)`); beginning anyway lets a sweep over a partly downloaded stretch still choose the rest. A collapsed volume stands for every chapter folded under it that can be chosen, as a tap on it does, and an expanded one only for its own text, since its chapters are rows of their own.
- **Edge scrolling.** `EDGE_BAND` is 24 pt inside each edge of the list, from which the speed rises linearly to `EDGE_FASTEST`, 1,500 pt a second, at the edge and anywhere beyond it. The list's bottom edge meets the drawer's footer, so fingers dragged onto the footer scroll at full speed, as fingers under Files' toolbar do. The top band copies the bottom one, since the phone's could not be measured.

## Facts the mechanism rests on

- **`runOnJS(true)` is required.** Without it the pan called nothing, not even `onBegin` (notes, 02:29). react-native-reanimated is not installed, and babel-preset-expo adds the worklets plugin, which turns gesture callbacks into worklets that nothing then runs.
- **A callback may not use `this`.** The worklets plugin moves each callback into a factory called with the variables it captured, and an arrow function created there takes the factory's `this`, which is undefined: `this.move` threw on the first update (notes, 03:00). The callbacks call a captured `sweep` instead, from `sweepGesture` outside the class.
- **The list does not scroll under two fingers, with no gesture relation set.** The pan activates on its first movement, before the scroll view's own pan, which waits for about ten points, and the list's `onScroll` was silent during a sweep. `Gesture.Native()` with `blocksExternalGesture` was not needed.
- **The row the fingers come down on does not also toggle.** When one of its handlers activates, gesture-handler disables and re-enables React Native's touch handler, cancelling the press under the fingers (`RNGestureHandlerManager`, `didActivateInViewWithTouchHandler`). The counts after each sweep were exactly the rows swept (notes, 03:04).
- **The React-compiler lint forbids building the gesture in render.** Refs read and `Date.now()` called inside callbacks built by `useMemo` were rejected (`react-hooks/refs`, `react-hooks/purity`), as was writing to an object from `useState` (`react-hooks/immutability`). Hence the controller, made once in `useState` and updated by a method from an effect.

XCTest's own `swipeUp()` on the drawer's list also chose the row it began on, 5 times in 6 on the tree before this change and 4 in 6 with only the root view added, while a synthesized 0.5 s one-finger drag never did (notes, 02:42). So probes scroll the list with a synthesized drag, not with `swipeUp()`.

## Considered options

- **A SwiftUI `List` from `@expo/ui` 57.0.19**, the phone drawing the list itself. It takes a selection (`src/swift-ui/List/index.tsx`, `ios/ListView.swift` build `List(selection:)`), but the system draws its selection circles on the leading side while the drawer's circles and rings are trailing; no `selectionDisabled` modifier is registered, so downloaded and downloading chapters could be selected; and edit mode is set through `environment('editMode', …)`, which becomes a `.constant(...)` binding natively, while SwiftUI's automatic two-finger gesture works by switching edit mode itself. Whether it would work at all could only be learnt after rebuilding the drawer, with 2,077 rows each hosting React Native views untried.
- **A table view module of our own**, which gets Apple's gesture exactly from `tableView(_:shouldBeginMultipleSelectionInteractionAt:)` and could refuse rows: the most work, and more native code to own, ADR 0035's reason against a module for menus.
- **A one-finger swipe down the circle column**, which Mail offers in its selecting mode: the drawer's circles are always shown, so it would fight scrolling.

## Testing

`test/manual-test/two-finger.sh` stages sixty rows in Files and runs `TwoFingerProbe`, which synthesizes two-finger paths through XCUIAutomation's private `XCPointerEventPath`, `XCSynthesizedEventRecord` and `eventSynthesizer`, read out of Xcode 27.0's binary. Its `testFiles…` methods are the measurements above; `testDrawerSweeps` drives the drawer the same way.
