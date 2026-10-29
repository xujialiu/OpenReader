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

`useLibrarySearch` owns the query and navigation lifetime. On iOS the native
search control owns the browsing and result scroll positions, captured before
focus or Reader navigation changes the view. These are page-local, never route
parameters or stored data.
Focus begins search, but blur only dismisses input: opening an action Drawer or
hiding the keyboard must not drop results. A result marks its Document Id
before navigation, so only that Reader round trip retains search. Other
navigation, including an external Reader open, ends it. Navigation-state
changes are observed even while the Library is blurred, so leaving the retained
Reader for another page cannot leave an abandoned query waiting behind it.

Native snapshots store the logical content position: `contentOffset.y` plus
`adjustedContentInset.top`. Restoration reads the current adjusted inset,
clamps the logical target to the current content range and sets `UIScrollView`
directly. JavaScript keeps only a pending slot (`browse`, `closed-browse`, `results` or `top`)
and retries that semantic request when content size changes, because the first
request may still meet the old, shorter result list. A manual drag or a new
search action retires the request. Native scroll changes while the Reader is
in front do not replace the saved result snapshot.

Cancellation is idempotent. `RNSSearchBar.cancelSearch` emits Cancel and then
an empty text change. A second cancellation must not overwrite the original
browsing offset with the result-list offset, and the empty change must not
reopen the search. The original hook regression first failed with a 720-point
browsing offset restored as zero, then passed with repeated cancellation
keeping 720 (request 670 with its doubled 50-point inset). That coordinate test
now covers the non-iOS fallback; the iOS regression instead requires one native
browse capture and native restoration, never the clamping RN scroll command.

A deliberate pull at list top now previews input and commits only at full
clarity. The page subscribes to the already-associated `RCTEnhancedScrollView`
through its documented `delegateSplitter` API, preserving React Native's own
delegates. Begin/scroll/end callbacks observe actual content movement; no
competing recognizer or replacement scroll delegate is installed. Only
movement beyond the adjusted top creates a preview, whether the drag started
there or reached it from deeper in the list. Progress is that downward native
content displacement divided by the bar's measured height (native fitting
size when layout has not supplied one). Multi-touch invalidates entry.

`RNSSearchBar` drives a paused UIKit `UIViewPropertyAnimator` over a
`UIVisualEffectView`, from material blur at progress zero to no blur at one.
The effect stays within the native text field, using its bounds and capsule
geometry; UIKit still draws the real field and its dynamic appearance. During
preview the bar is noninteractive and its accessibility subtree is hidden.
Reaching full progress removes the preview and schedules the existing native
focus path on the next main-loop turn, even if the finger has not yet lifted.
The page/controller/scroll identity and modal/selection scope are checked
again. UIKit activation supplies keyboard input and external Close while the
query is still empty.

Releasing or cancelling short uses the existing closed-position transaction
BEFORE removing the effect, preventing a clear-field flash or half-open rest.
A newly started gesture supersedes an older queued cancellation. Binding
changes and deallocation remove the additive delegate and clean up effects
and interaction flags.
Programmatic scrolling never produces this entry gesture. The new visual and
threshold behavior requires recorded gesture evidence, not just final frames.

The first pan-target implementation regressed basic browsing: it created a
preview on ANY drag at top, then restored logical zero whenever that drag did
not commit. A real two-direction test stayed at y=296; removing ONLY that
handler at runtime restored y=296 → -30.33 → 296 under the same stimulus.
This is an application regression, not an input-path blocker. Eligibility now
creates no effect and arms no restoration. An ordinary scroll is untouched;
only a confirmed downward preview may be cancelled, and a reversed preview
that becomes forward browsing preserves the current logical position. The
original zero-translation pan trace is not evidence that the input was bad.

Close keeps using `closed-browse`: hide the field and keyboard and restore the
original position. Empty Close is a cancellation too. A later layout must not
focus again; only another deliberate pull or explicit Search entry does that.

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
- `RNSNavigationController.keyCommands` adds the top page's Library commands
  to its inherited commands. `RNSScreen.openReaderLibraryKeyCommands` supplies
  them only when the visible page has a search controller and no other modal
  presentation. Reader and Settings have no search controller. Escape is
  omitted during marked-text composition; its action rechecks that condition
  as well, in case UIKit cached commands before composition began.
- Command-F activates and focuses that controller; Escape calls its search-bar
  delegate's cancellation path, so the normal JavaScript cancellation runs.
- `RNSSearchBar.focus` activates the controller before requesting first
  responder, including when its stacked field has scrolled out of view.
- Autocorrection and spelling substitution are disabled for name input.

Registering on the page itself was insufficient: a focused field's measured
responder chain is `UISearchBarTextField → … → UISearchBar → UINavigationBar
→ … → RNSNavigationController → … → UIWindow`, with no `RNSScreen` in it.
The page could report Escape as registered while the key did nothing. The
search bar's own `_performCancelAction:` Escape command had priority 0; the
Library Escape command retains priority over system behavior. Registration
therefore belongs on the navigation controller shared by both responder paths,
with actions forwarded to the current page and its existing scope checks.
Moving registration onto that chain alone did not fix focused Escape: the
native check confirmed the navigation controller's priority-1 command and
valid page gate, but search stayed active. This rules out absent registration;
it does not trace which UIKit handler consumes the event.

The search bar now replaces its own unmodified Escape command with the same
scoped Library command. `RNSOpenReaderSearchController` lazily returns an
`RNSOpenReaderSearchBar`; this is Apple's documented
[`UISearchController.searchBar` customization point](https://developer.apple.com/documentation/uikit/uisearchcontroller/searchbar).
The subclass changes only keyboard registration/forwarding, not rendering,
the text field, touch handling or scroll behavior. Non-Escape commands remain
inherited; when the page gate or marked-text condition disallows cancellation,
UIKit's commands remain intact. Dispatch verifies the bar still belongs to the
current search controller and reuses the page's cancellation guard. The
navigation-controller commands remain for list focus. No private selector is
implemented and no existing UIKit object has its runtime class changed. This
closer-responder routing and native bar integration still require acceptance.

The closer command also failed the synthesized-Escape checkpoint. A corrected
same-process trace proves CmdF reaches both find handlers, both command getters
are consulted, and none of the cancel/blur/end-editing handlers run in that
sequence. It does not establish which subsystem consumes Escape. Independent
HID input failed its printable-key delivery control; GUI key input was refused
for lack of window focus. Do not infer a UIKit text-input fault or add deeper
interception from those observations. Physical-keyboard Escape was subsequently verified manually to close search
on beta9. The synthesized-key failure remains a test-path discrepancy, not an
established app defect, and does not justify deeper keyboard interception.
IME/scoping and other unmeasured checks still need their own evidence.

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

## Native scroll-position commands

The next native checkpoint passes cold hidden search, an unclipped first row,
a real pull reveal without keyboard, and menu-driven input. Cancellation hides
the field but leaves raw offset zero with adjusted top inset 116, putting the
first row at y 12 instead of 128.

Two React Native Fabric source facts explain why the former JavaScript
conversion was insufficient. `_scrollViewMetrics` reports `contentInset`, not
`adjustedContentInset`: the event carries the explicit zero inset, not UIKit's
116-point top adjustment. The native `scrollTo` command also computes its
minimum allowed offset from that explicit inset and, unless overflow is
enabled, clamps a negative offset to zero. The host hook doubles supplied an
inset and accepted negative requests, so their passing coordinate assertions
did not exercise this native boundary.

The confirmed correction keeps page-local search lifecycle in JavaScript but
captures/restores positions at the native search control. The patch adds
`captureScrollPosition('browse' | 'results')` and
`restoreScrollPosition('browse' | 'closed-browse' | 'results' | 'top')` to the source/public ref,
runtime distributions and Fabric command schema. `RNSSearchBar` keeps two
logical positions and a weak `owningScreen`, assigned while the header attaches
its search controller. It acts only while that page still owns this controller,
and obtains its real list through `contentScrollViewForEdge:Top`.

Capture is sent before focus or result navigation. Clearing input restores
`browse` while keeping input available; cancellation requests `closed-browse`,
which restores the same position AND hidden presentation in one native
transaction. Returning from the result Reader restores `results`, and a
changed query requests `top`. Native focus also captures before activating UIKit (Command-F
uses that same entry); the browse capture is idempotent until cancellation,
so the later focus callback or refocusing input cannot replace the original
position. Cancellation rearms capture while keeping the saved value for the
queued restoration. iOS scroll-event metrics are deliberately ignored, and that
path never calls `FlatList.scrollToOffset`. Android retains the prior list
fallback; its generated command interface has iOS-only no-op implementations
which the fallback never invokes. Android code generation is checked, not
claimed as an Android device run.

This extends the existing screens boundary rather than changing React Native's
global event semantics or estimating a delayed header height. Adding Fabric
commands requires code generation and a new native build; reloading Metro
alone is insufficient. Host tests exercise the real patched ref's forwarding
and the hook's capture/restore order, including the misleading zero-inset event.
Native position restoration still requires the simulator acceptance check.

The first native-command check restored the correct logical position but left
the search field expanded: saved browse zero, raw offset -176, adjusted top
176, header height 114, with `active=0`, `hides=1` and the collapse guard nil.
That held state does not establish the exact event ordering; it does establish
that correct coordinates alone do not guarantee hidden presentation, and that
waiting for another screen-layout callback is insufficient.

`RNSScreen.openReaderRestoreLibraryPosition:closed:` now owns the combined
operation for both initial collapse and explicit restoration. It sets position,
finishes layout, enforces the requested collapsed presentation, then restores
against the final inset/content range. The explicit closed request does not
rely on another layout callback to start that operation. It does nothing while
another page is on top; focus can retry it when the Library returns. A queued
closed restore is ignored after a new native browse capture, so it cannot
close newly reopened input. Clear and result-return requests do not force
collapse. These postconditions still require native retesting.

## Verification boundary

The host tests exercise matching, whole-Library scope, identity/order, current
names after changes, real page/action wiring, deferred Drawer focus, empty
results, selection exclusion, cancellation and navigation/scroll lifetime.
Native views are doubles there: these tests do not prove UIKit placement,
keyboard events, first-responder transitions, scroll restoration on the device
or appearance. Native verification and latest-app delivery are still required
before this implementation is complete.
