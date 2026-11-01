---
status: accepted
---

# Library Search draws its own field and keeps its keys on the page

Issues #332 and #339; the product contract is
[design 0090](../design/0090-library-search-stays-out-of-the-way.md). The
existing Library/Folder native-stack page owns its search, not a new route, a
Drawer or a persisted index. `libraryRows` filters the already-loaded entries by
their current names and preserves their existing order. Empty input projects the
original Folder's immediate children instead. No document is opened to search
its name, and no persisted format changes.

#332 built search on the native stack's search controller, hidden above the list
and revealed by a pull. #339 removed it: the pull, the hidden field and the
native patching that held them up. What follows is what is there now; the
record of the native field, and why it was given up, is the last section.

## No search controller in the title bar

The Library and Folder pages never set `headerSearchBarOptions`. With no search
bar and no large title, React Navigation 7.19.2 computes the header as not
translucent (`useHeaderConfigProps.tsx`, `translucent = headerBackground != null ||
headerTransparent || ((hasHeaderSearchBar || headerLargeTitleEnabled) && …)`), and
react-native-screens then excludes the top edge from the page's extended layout
(`RNSScreenStackHeaderConfig.mm`, `edgesForExtendedLayout`). The page starts
under the bar. That is the same layout every other page has, and the one the
Library had during selection under #332. The bar's background was already the
opaque page colour. Measured on the first native run (`1.0.4 (27)-beta3-debug`,
iPhone 17, iOS 27.0): the bar `{{0, 62}, {402, 54}}`, the list from y 116, its
first row at 128. The same file notes an iOS 26 landscape bug with that edge for
an opaque header and works around it with a safe-area view; the list takes no
inset from UIKit at all (below), so whatever that leaves, the list does not
apply it.

## The field

`LibrarySearchField` is rendered by the page above the list, inside the
Library's column, only while search is open, and goes with it. It copies the
phone's own stacked field as measured on iPhone 17 (iOS 27.0; notes 2026-11-01):
a 44-point capsule from x 16, its top 1 point below the bar, 15 points above the
list; the magnifying glass 14 points in and 16 across; the words in Body from x
58; a 44-point round Close 10 points to the right and 16 from the edge.

- **The text is a React Native `TextInput`**, with the phone's own clear button
  (`clearButtonMode="while-editing"`), the Search return key, no
  autocorrection, spelling or capitalisation, and the placeholder colours
  measured on the phone's glass (`#979797`, `#9f9ea5`; `INK.searchPrompt`).
- **The capsule's glass and Close are the phone's**, through `@expo/ui`: a
  SwiftUI `Capsule` with `glassEffect` (`foregroundStyle` clear, so only the
  glass shows) behind the text, and a `Button` labelled `Close` with the `xmark`
  symbol, `labelStyle('iconOnly')`, `buttonStyle('glass')`, a circular border
  shape and `controlSize('large')`. Before iOS 26 the capsule is a quaternary
  fill and the button `bordered`, as `LibrarySelectionAction` falls back.
  Whether `controlSize('large')` draws Close at exactly 44 points is not
  measured; `testSearchShowsFieldWithKeyboardWhereThePhoneDrewIt` checks it.
- **The magnifying glass is the app's `Icon`** (`search`, a 20-point box, stroke
  2.2 of its 24 units): the measured glyph is 16 points across and about 1.7
  thick.
- **Locked while selecting**: `editable={false}`, the capsule at half opacity,
  Close disabled through SwiftUI's `disabled`, and the page blurs the field when
  selection begins (a two-finger sweep can begin it while the keyboard is up).
- **A drawer puts the keyboard away**: the page blurs the field whenever the
  Library actions, a Document's or a Folder's actions open. Measured on
  `1.0.4 (27)-beta4-debug` (iPhone 17, iOS 27.0): with the field focused, a
  drawer rose to its half height under the keyboard (keyboard top y 590, the
  drawer's `Move to…` row at y 560 with 30 points showing; `Select`, `Download`
  and `Delete` not hittable, two real touches on `Move to…` opening nothing),
  and the first press on a row above the keyboard only dismissed the keyboard.

**The keyboard comes with the field and cannot race it.** The input is mounted
with `autoFocus`. React Native 0.86.3's Fabric `RCTTextInputComponentView`
acts on it in `didMoveToWindow`, once per mounted view (`_didMoveToWindow`,
reset only by recycling): the field becomes first responder when it is in the
window and not before. So `start()` only sets state; nothing calls `focus()` on
a ref that may not exist yet. On a search already open, `start()` calls
`focus()` on the existing field. Returning from a result's Reader moves the
same mounted view back into the window, which `_didMoveToWindow` stops from
focusing again. The Library actions Drawer still defers Search to its native
dismissal callback, so the field never appears under a sheet that is still
covering the page.

## Transient state and positions

`useLibrarySearch` owns `{ active, query }`, page-local: never route parameters
or stored data. `start` opens, `exit` (Close, Escape, leaving the page) ends,
`change` filters. A result marks its Document Id before navigation, so only
that Reader round trip keeps search; any other navigation, an external Reader
open included, ends it. Navigation-state changes are observed while the Library
is blurred, so leaving the retained Reader for another page cannot leave a query
waiting behind it.

Positions are the list's own: `contentOffset.y + contentInset.top` from
`onScroll`, restored with `FlatList.scrollToOffset(position − inset)`. Opening
search saves the browsing position; opening a result saves the result position;
Close and an emptied query restore browsing, a new query asks for the top, and
returning from the Reader restores the results. A request is retried when the
content size changes (the first may meet the old, shorter list) and after each
commit, and is retired when reached or when a finger drags. Scroll events while
the Reader is in front are ignored. Under #332 this JavaScript path was wrong on
iOS because UIKit added a 116-point top inset that React Native's event does not
report (history below); with the bar opaque there is no such inset to miss.

## The title bar's buttons and the list's insets

Every button in the Library's title bar is a native bar item
(`unstable_headerLeftItems` / `unstable_headerRightItems`): `…` with the SF
Symbol `ellipsis`, Settings at the root with `slider.horizontal.3` (the three
sliders the app's own `settings` glyph draws), and Select all and Cancel while
selecting. `headerLeft`/`headerRight` keep the same buttons as React Native
views for a platform without native items; on iOS the items win.

The `…` and Settings were React Native views in the bar until `1.0.4 (25)-beta4`.
A press on one was also a touch on the bar, and UIKit answered it by scrolling
the list to its top, so `…` > Search noted the top as the browsing position and
Close could not return (`testCancelRestoresNonzeroBrowse`: 464 against 72,
twice). Measured on `1.0.4 (27)-beta3-debug`, iPhone 17, iOS 27.0, with real AXe
touch pairs (0.2 s) from a middle of a 13-row list: the React Native `…` moved
the list to its top 6 of 6 for `ios-tester` and 1 of 1 again; with the list's
`scrollsToTop` off (a temporary edit) 3 of 3 presses left it in place and Close
returned exactly (58 → 58, −12 → −12); with `…` as a native item (a temporary
edit) 3 of 3 left it and Close returned exactly (58, −12, −82). An instantaneous
`axe tap` on the bar's empty area did not move the list where a 0.2 s touch on
the button did. Conditional breakpoints on `-[UIScrollView setContentOffset:]`
never fired, so the UIKit call is inferred from these controls, not caught.
Turning `scrollsToTop` off was rejected (design 0090): it also ends the
status-bar tap to the top. A 0.2 s AXe touch on the status bar did not reach the
app, so that gesture is unmeasured here.

The list takes no inset from UIKit (`contentInsetAdjustmentBehavior="never"`)
and carries the bottom safe-area room in its own content padding, with
`scrollIndicatorInsets` to match. Before, UIKit added the home indicator's 34
points as an adjusted inset, and React Native 0.86.3's Fabric
`scrollTo:y:animated:` clamps a requested offset to `contentSize.height −
bounds.height + contentInset.bottom + max(contentInset.top, 0)`
(`RCTScrollViewComponentView.mm`, `scrollTo:y:animated:`), the explicit inset
only, unless `scrollToOverflowEnabled`. A restore near the bottom therefore came
back up to 34 points short: −264 as −230 here, 392 as 358 for `ios-tester`.
`scrollToOverflowEnabled` was not used: it lifts the clamp entirely, and a
restore into a list that has since grown shorter would rest past its end. The
two-finger sweep's own edge scroll clamps to `content − viewport` and now
reaches the same bottom.

The content container no longer grows to the viewport. That fill existed so a
pull could start in the blank space under a short list; the two-finger sweep's
gesture covers the whole column without it.

## Selecting results

A selection is of the rows on show. `SelectionScope` (`src/core/folders.ts`)
says where they came from: `folder`, a Folder's own rows, all of one level
(#128); `results`, search results, Documents only, from any level. The query is
locked while selecting, so the scope cannot change under a selection.

- `selectionPlan` refuses a Folder, a missing Document or a duplicate in a
  `results` selection, and skips the same-level check.
- `moveSelection` with `results` leaves the Documents already in the destination
  where they are, still counting their names for #227, and refuses only when
  every selected Document is already there. The whole move is built in memory
  and written once, as before.
- `moveChoice` with `results` enables Move wherever at least one selected
  Document is not already. The Move page opens at `from`, the Folder search
  began in.
- `deleteEntries` with `results` deletes under the same single lock.

`…` > Select, a result's own Select and the two-finger sweep all work over
results. After Move or Delete the selection ends and search stays.

## Command-F and Escape

The commands stay at the boundary #332 found for them: `RNSNavigationController`
adds the top page's commands to its own `keyCommands` and forwards their
actions to that page. It is on every responder path of the stack: a focused
field's, and none (#332 measured the page itself missing from a title-bar
field's chain; the app's field is inside the page, so the page is on its chain
now, but the navigation controller also serves the case with no first
responder).

What changed is how the page knows what applies. `RNSScreen` looks in its own
view tree for a key target: a view answering `openReaderLibraryKeys` and
`openReaderPerformLibraryKey:`. That view is `LibraryKeys`, from the app's local
Expo module `modules/open-reader-library-keys`; the page's JavaScript sets its
`find` and `escape` props and receives `onKey`. The patch knows nothing else
about search. `RNSScreen` offers the commands only:

- when it is the navigation controller's top page and in a window;
- when nothing is presented over it or its ancestors (an actions Drawer, an
  alert);
- when no first responder in its view tree has marked text (a Bopomofo
  composition keeps Escape and Command-F for itself);
- and checks all three again, plus the target's current keys, when a command
  fires, since UIKit can cache commands.

Command-F opens search or returns the cursor to its field, never while
selecting; Escape ends selection first, then closes search. The page's
JavaScript also withholds `find` while a Drawer, picker or deletion is busy. A
`test/app/library-keys-native.test.ts` tripwire holds the two selector names,
the scope checks and the absence of the old search-bar code in the patch.

Rejected: a process-wide key listener, which could take keys from the Reader or
a modal; a prop on the screen itself, which needs codegen changes inside
react-native-screens; a view that makes itself first responder to receive
commands, which would compete with the text field and VoiceOver for it
(inferred, not tried).

## The patches

`patches/react-native-screens+4.26.2.patch` went from 1090 lines to 235: the
key commands above and #317's back-button names. It was regenerated from the
pristine 4.26.2 tarball (`npm pack`, compared file by file before editing) and
checked by applying it to a fresh copy, which then matched the edited package
exactly. A native build is needed for it and for the new module: a Metro
refresh does not change either.

`react-native-gesture-handler+2.32.0.patch` stays. It fails an immediate
two-pointer candidate still missing its fingers after ten points of movement, so
a one-finger drag is not held up waiting for the sweep: written for a short pull
landing as a tap on the row under it, it applies to any short drag.

## Verification boundary

Host tests: the cross-Folder rules (`test/core/library-selection.test.ts`,
`folders.test.ts`), the search state (`use-library-search.test.ts`: open, a
second open, close and its retried restore, explicit inset, clearing, the Reader
round trip, ending on other navigation, no history), the real page with its
Drawer, field, keys, selection over results and Move
(`library-search-screen.test.ts`), and the key-target contract. Native views are
doubles there: they prove no UIKit placement, glass, first responder, keyboard,
key delivery or scroll position. Those are `LibrarySearchProbe`'s and
`LibraryTwoFingerProbe.testSweepSelectsSearchResults`'s, listed in
`test/manual-test/library-and-reader/library-search.md`. The first native run
(`1.0.4 (27)-beta3-debug`) passed the cold, pull and flick, focus and frame
checks and failed the Close restore, which led to the section above;
`testSettingsRoundTripKeepsTheListWhereItWas` and
`testCancelRestoresTheBottomOfTheList` were added for it and typecheck against
XCTest without having run.

## History: the title bar's field (#332 to #338)

The full record as it stood is this file at 63eb484. The measured facts that
decided #339:

- **A hidden stacked field needed the list bound to the bar by hand.** The
  first build showed a standing field at `{{16, 117}, {370, 44}}` with the first
  row pushed to y 188. The classic stack's scroll-view lookup returned nil (LLDB:
  the lookup, the cached view and `contentScrollViewForEdge:Top` all nil): the
  list sat under `RNSScreenContentWrapper` → `RNSSafeAreaViewComponentView`, behind
  an empty background view, in a sibling wrapper, and the first-child search
  stopped at the background. A breadth-first fallback and
  `setContentScrollView:forEdge:` bound it.
- **Collapsing it took a no-animation transaction.** Readback on a cold launch:
  offset −176, adjusted inset 176, bar 114 points before; −56 / 116 / 54 after
  collapsing by the bar's measured 60 points; −116 / 116 / 54 after restoring
  logical zero against the final inset. Keeping only the collapse left the first
  row at y 68 under a bar ending at 116.
- **React Native could not restore positions under that bar.** Fabric's scroll
  event reports `contentInset`, not `adjustedContentInset`: an explicit 0 while
  UIKit added 116. Its `scrollTo` clamps a negative offset to that explicit
  inset. Close restored raw offset zero and put the first row at y 12 instead of
  128, so positions moved into native commands on the search bar.
- **The pull was hard to tell from scrolling.** A threshold read during the
  first reveal frame was 1 point, and 2.3 points of finger travel committed a
  pull. An early handler restored logical zero after any uncommitted drag and
  broke ordinary scrolling (y 296 stayed at 296; removing only that handler at
  runtime gave 296 → −30.33 → 296).
- **UIKit expands a `hidesSearchBarWhenScrolling` field whenever the bound
  list passes its top, momentum included** (#338): the bar went from 4.3 to 54
  points and the inset from 116 to 170 on a flick nobody pulled. Detaching the
  list for the coast fixed the flick; a finger catching the bounce then needed
  its own handling twice, and a pull catching the bounce still stepped the list
  to its top in one frame (#338's F2, never decided).
- **Escape had to be registered on the navigation controller**: a focused
  title-bar field's responder chain was `UISearchBarTextField → … → UISearchBar →
  UINavigationBar → … → RNSNavigationController → … → UIWindow`, with no
  `RNSScreen` in it, and the search bar's own Escape (`_performCancelAction:`, at
  priority 0) had to be replaced through a `UISearchController.searchBar`
  subclass. A synthesized Escape never closed it; a physical one did.
- **iPad's stacked presentation drew no external cancel control** even with
  `showsCancelButton`, so the patch added its own xmark button.
- **Attaching the field only while searching was not safer**: the installed
  react-native-screens warns in `RNSScreenStackHeaderConfig.mm` that changing
  the search bar's configuration on iOS 26 can leave a stacked root-screen field
  not showing, and attaching it flips the header's translucency, which re-lays
  out the list.

Every one of these was the title bar's search controller meeting a list it did
not own. A field in the page has none of them.
