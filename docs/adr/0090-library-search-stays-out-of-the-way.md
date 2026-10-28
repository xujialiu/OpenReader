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

## Verification boundary

The host tests exercise matching, whole-Library scope, identity/order, current
names after changes, real page/action wiring, deferred Drawer focus, empty
results, selection exclusion, cancellation and navigation/scroll lifetime.
Native views are doubles there: these tests do not prove UIKit placement,
keyboard events, first-responder transitions, scroll restoration on the device
or appearance. Native verification and latest-app delivery are still required
before this implementation is complete.
