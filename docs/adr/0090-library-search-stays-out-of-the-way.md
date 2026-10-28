---
status: accepted
---

# Library Search uses the native stack's search controller

Issue #332; the product contract is [design 0090](../design/0090-library-search-stays-out-of-the-way.md).
The existing Library/Folder native-stack page owns its search, not a new route,
a Drawer or a persisted index. `libraryRows` filters the already-loaded entries
by their current names and preserves their existing order. Empty input projects
the original Folder's immediate children instead. No document is opened to
search its name, and no persisted format changes.

## Native field and transient state

The [Expo SDK 57 screens reference](https://docs.expo.dev/versions/v57.0.0/sdk/screens/)
identifies `react-native-screens` as the native-stack primitives. The installed
4.26.2 `SearchBarProps` and [React Navigation's search options](https://reactnavigation.org/docs/native-stack-navigator/#headersearchbaroptions)
provide the field and its imperative focus, blur, set-text and cancel commands.
`placement: 'stacked'` avoids the integrated standing search button;
`allowToolbarIntegration: false` keeps it out of the bottom toolbar.
`hideWhenScrolling` is true outside search. The list uses automatic content
insets, as the navigator requires. Text and action colours follow the app's
existing palette and accent; UIKit draws the search control.

`useLibrarySearch` owns the query, the pre-search list offset and the result
return offset. These are page-local, never route parameters or stored data.
Focus begins search, but blur only dismisses input: opening an action Drawer or
hiding the keyboard must not drop results. A result marks its Document Id
before navigation, so only that Reader round trip retains search. Other
navigation, including an external Reader open, ends it. Navigation-state
changes are observed even while the Library is blurred, so leaving the retained
Reader for another page cannot leave an abandoned query waiting behind it.

Offsets are kept in content coordinates, with the current native top inset
removed when issuing a scroll request. A pending restoration is retried when
content size changes: the first request can otherwise be clamped against the
old, shorter result list. The target is retired when its position is observed
or the next manual drag starts. Native scroll changes while the Reader is in
front do not replace the saved result offset.

Cancellation is idempotent. `RNSSearchBar.cancelSearch` emits Cancel and then
an empty text change. A second cancellation must not overwrite the original
browsing offset with the result-list offset, and the empty change must not
reopen the search. The hook regression first failed with a 720-point browsing
offset restored as zero, then passed with repeated cancellation keeping 720;
with a 50-point native inset the native scroll request is 670.

The Library actions Drawer defers Search until its native dismissal callback,
as it already defers the document picker. Focusing before dismissal risks
handing first responder to a surface still covered by the Drawer. Import and
Create folder retain their leading positions; Search precedes Select. Search
omits Select from the Library, Document and Folder actions and disables the
two-finger sweep. Selection removes the native search controller altogether.

## The narrow native patch

`patches/react-native-screens+4.26.2.patch` retains the existing Folder back-menu
fix and adds the Library keyboard/focus behavior at the native boundary:

- `RNSScreen.viewDidLayoutSubviews` explicitly associates the Library's actual
  `UIScrollView` with the top bar through `setContentScrollView:forEdge:` when
  a search controller is present. It uses the normal lookup first, then a
  breadth-first search of this page, excluding header and nested-screen
  branches. The cached association changes only when the scroll view changes;
  removing search restores UIKit's default lookup. Initial presentation and
  the end of input use one no-animation layout transaction: preserve the
  logical list offset, trigger native collapse using the search bar's measured
  height, finish layout, then restore that offset against the final adjusted
  inset. The per-controller guard prevents collapsing later deliberate pulls;
  active input rearms it so cancellation returns to ordinary hidden search.
- `RNSScreen.keyCommands` adds Command-F and Escape only when the visible page
  has a search controller and no other modal presentation. Reader and Settings
  have no search controller. Escape leaves an unfinished IME composition to
  the text field first.
- Command-F activates and focuses that controller; Escape calls its search-bar
  delegate's cancellation path, so the normal JavaScript cancellation runs.
- `RNSSearchBar.focus` activates the controller before requesting first
  responder, including when its stacked field has scrolled out of view.
- Autocorrection and spelling substitution are disabled for name input.

A process-wide key listener was rejected because it could intercept Reader or
modal actions. A separate native search module would duplicate the controller
already owned by the stack and make its scroll/header integration our own.
The cost of using the existing boundary is another native patch to check at a
screens upgrade. `patch-package` must continue to apply both this change and
#317's back-menu change, and the keyboard/focus checks must run against a new
native build, not just a Metro refresh.

## Collapse association

The first native check found a standing search field, including in an empty
Library. In the expanded state, the navigation bar was 114 points tall and the
field occupied `(16, 117, 370, 44)` on the tested iPhone. A later diagnostic
with 13 Documents moved the list to offset 400 through its own scroll API:
rows moved, but the field and bar stayed expanded. Synthetic scroll gestures
in that diagnostic did not move the list, so they are not evidence of native
collapse. These observations support a missing scroll/header association;
they do not establish behavior at every possible offset or on another device.

The classic stack's scroll-view lookup is insufficient here. UIKit's public
[`setContentScrollView(_:for:)`](https://developer.apple.com/documentation/uikit/uiviewcontroller/setcontentscrollview(_:for:))
exists specifically to designate the scroll view bars observe when the view
hierarchy heuristic is insufficient. The installed screens package already
uses it in its newer stack and tab implementations, not in this classic stack.
The first binding attempt used only the classic screen's existing
`tryFindDescendantScrollView`; native behavior stayed unchanged. LLDB then
showed all three pointers nil: that lookup, the patch's cached view and
`contentScrollViewForEdge:Top`. It was not evidence that UIKit ignored a valid
binding. The actual hierarchy was `RNSScreenContentWrapper` →
`RNSSafeAreaViewComponentView`, with an empty background view as its first
child, and a sibling wrapper containing `RCTScrollViewComponentView`. The
first-child search stopped at the background; the iOS 26 fallback checked only
immediate children, missing the wrapped list. The actual list had offset
`(0, -176)`, adjusted top inset 176 and content height 1116.

The search-only breadth-first fallback finds the wrapped list without changing
the generic lookup used elsewhere. The next native run confirmed that cached,
fallback and observed pointers name the same actual list, with a collapsed
54-point navigation bar. But the added initial scroll shifted content another
60 points: offset -56 with adjusted top inset 116 put the first row at y 68,
under the bar ending at y 116. A diagnostic changing only the offset to -116
left the bar collapsed and the first row fully visible; both native geometry
and the screenshot confirmed it. This was a runtime experiment, not evidence
that a fresh launch was fixed.

Removing the collapse trigger returned the standing field on a fresh launch,
with the correct binding intact. The complete native operation was then tested
on that cold expanded state in one no-animation transaction: preserve logical
offset zero, move by the measured 60-point search-bar height, force bar/view
layout, then restore logical zero against the final adjusted inset. Readback
was `-176 / inset 176 / bar 114` before, `-56 / inset 116 / bar 54` after
collapse, and `-116 / inset 116 / bar 54` after restoration. The later screenshot
kept the field hidden and the first row fully visible. The patch now performs
that complete operation rather than keeping only its first half or removing
it altogether. Native fresh-launch, pull and cancellation acceptance are still
required; the runtime experiment is not a substitute for them.

## Verification boundary

The host tests exercise matching, whole-Library scope, identity/order, current
names after changes, real page/action wiring, deferred Drawer focus, empty
results, selection exclusion, cancellation and navigation/scroll lifetime.
Native views are doubles there: these tests do not prove UIKit placement,
keyboard events, first-responder transitions, scroll restoration on the device
or appearance. Native verification and latest-app delivery are still required
before this implementation is complete.
