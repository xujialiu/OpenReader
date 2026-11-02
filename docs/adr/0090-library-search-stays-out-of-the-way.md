---
status: accepted
---

# Library Search draws its own field and keeps its keys on the page

Issues #332, #339 and #341; the product contract is
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
Library's column, while search is open and while it fades out after (Motion,
below). It copies the
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
`focus()` on the existing field; on a field still fading out, the field focuses
itself as it turns back (Motion, below), and it blurs the moment search ends,
since it stays mounted to fade. Returning from a result's Reader moves the
same mounted view back into the window, which `_didMoveToWindow` stops from
focusing again. The Library actions Drawer still defers Search to its native
dismissal callback, so the field never appears under a sheet that is still
covering the page.

### Motion

The field moves as the phone's stacked search field does (#341), measured on
iPhone 17 (iOS 27.0) from a UIKit test app with the search controller #332
used; the frames and fits are in `notes/NOTES_2026-11-02.md`. The animation is
`react-native-reanimated` 4.5.1, Expo SDK 57's version, running on the UI
thread; `react-native-worklets` 0.10.1 was already a dependency and
babel-preset-expo adds its plugin by itself. `active` stays `useLibrarySearch`'s;
whether the field is drawn is the field's own (`present`), from the opening
until its fade has finished.

- **One spring**: mass 1, stiffness 350, damping 30 (`src/app/held-spring.ts`).
  That is the fit of the phone's frames, natural frequency 18.5 to 18.9 rad/s
  and damping ratio 0.80 to 0.81, with an error of 0.16 to 0.23 points over
  three opens and three closes. UIKit's bar, field and list animations are not
  in any layer's `animationKeys()`, so the parameters are fitted, not read.
- **One frame of motion per frame** (`withHeldSpring`, `withHeldDelay`, custom
  animations through Reanimated's `defineAnimation`): each UI frame moves the
  spring by the time since the last frame, but never by more than a 60 Hz
  frame, the damped spring's exact solution over that step from its position
  and velocity. Reanimated's own `withSpring` takes up to 64 ms in one frame
  (`spring.ts`, `Math.min(…, 64)`), so a hold of the UI thread came back as a
  jump: `ios-tester` logged 19 of 39 opens of `1.0.4 (30)-beta1-debug` with
  `lift` 0.30 to 0.41 within their first two frames, three of them 0.374, a
  64 ms step of this spring, where a spring from rest has 0.02 to 0.1 and then
  0.13 to 0.25. A hold now delays the motion and skips none of it. A display
  faster than 60 Hz has shorter frames, which pass whole. Close's delay counts
  the same clock, so it stays in step with the field. Reanimated's default
  reduce-motion handling jumps an animation to its end under Reduce Motion;
  the phone changes nothing then (measured), so these animations set
  `reduceMotion: false`. In development Reanimated also warns about Reduce
  Motion as it loads, and LogBox put that warning over the list's bottom;
  `src/app/reduced-motion-warning.ts`, imported by `index.ts` before the app,
  silences that one warning with the `LogBox.ignoreLogs` line Reanimated's
  troubleshooting page gives.
- **The slot**: a view above the list, `60 × lift` points tall and never less
  than nothing. The list is its flex sibling, so the
  list's top edge moves with the slot and its bottom stays where it is, as
  UIKit's list did under the growing bar. List positions are offsets into the
  content and do not move. The phone's bar grows by 54 points; the slot keeps
  the app's measured 60 (1 + 44 + 15), which puts the first row where the
  phone's was. The closing overshoot stops at the list's place, where the
  phone's list rises 0.74 points past it: with a `marginBottom` taking `lift`
  below zero the list grew past its own room by up to a point, and at its very
  bottom the scroll view clamped its offset each frame and kept it (logged:
  restored to 644 in a 1402-point content, then 643.67, 643.33 and 643 as the
  list measured 758.33, 758.67 and 759 against its 758), so Close came back
  1 point short every time (`bottom-restore: … @744.0 -> @745.0`; the
  `nonzero-browse` case, `@72.0 -> restored @73.0`, was the same: its one fast
  swipe carries the 13-row list to its bottom).
- **The keyboard first**: taking the keyboard holds the UI thread, and
  Reanimated drives its springs from that thread frame by frame. Measured on
  the session's iPhone 17 simulator (iOS 27.0, a frame callback logging the
  values, a temporary build): with the springs started as the field mounted,
  the frames after the open came 247 and then 300 ms apart, `lift` went from 0
  to 0.374 and then to 0.785 between two frames (Reanimated caps each step's
  time, 64 ms, so it did not finish at once), and Close, whose delay counts
  wall time, appeared at the second. With `autoFocus` off the same open ran at
  16.7 ms frames throughout. So the opening waits for the text input's
  `onFocus`, which arrives after that hold (48, 126 and 216 ms after the
  field's commit in three runs, 743 ms in one just after a Fast Refresh, the
  springs starting within a frame or two of it), and opens
  anyway after 600 ms (`FOCUS_WAIT`) if it never comes. The closing waits the
  same way for `onBlur` when the field has the keyboard (`isFocused()`), at
  most 150 ms (`BLUR_WAIT`); started together with the blur, its first frame
  came 33 to 40 ms after the one before. The phone's own animation starts
  once the work in front of it is done; its list started 25 ms after its
  keyboard on a close. With both waits every logged frame of an open and a
  close was 16.7 ms apart. That was not every open: holds also came after
  `onFocus`, and only the one-frame step above made them harmless. With it,
  the session's simulator logged 33 opens with the software keyboard, first
  two frames at most 0.041 and 0.139 though 41 to 57 ms often passed before the
  first, and 13 with a focused field and no software keyboard
  (`showSoftInputOnFocus={false}`, a temporary build; the device's
  hardware-keyboard state could not be produced that day) at most 0.032 and
  0.124.
- **Opening**: `lift`, `grow` and `shown` spring to 1. The capsule's top stays
  1 point under the bar and its height is `44 × grow`. Close's room, the 10
  points between and Close as drawn (46.5 across on iPhone 17, notes
  2026-11-01) times `grow`, narrows it from full width, as the phone's capsule
  starts at 370 points and narrows to 315. The magnifying glass
  and the text field stay 44 points tall, centred in the capsule and clipped by
  a view with its radius; the glass itself is not clipped. Their opacity is
  `grow`: the phone's magnifier darkness tracked the bar's growth within a few
  hundredths at every sampled frame (0.335 against 0.374, 0.593 against 0.613,
  0.787 against 0.79, 0.914 against 0.909). Close is hidden until 350 ms of the
  motion (`CLOSE_AFTER`, `withHeldDelay`), then shown at once: the phone's
  appeared whole at +408 to 430 ms, its motion starting at about +65.
- **Closing**: the field blurs at once, so the keyboard starts down first (the
  phone's led by about 20 ms). `lift` and `shown` spring to 0 on the same
  spring. The phone's whole field faded as `1 − x(t)` of the very spring its
  list followed: 0.87, 0.49, 0.20 and 0 at 32, 82, 132 and 232 ms after the
  motion began, against 0.871, 0.490, 0.200 and −0.004 computed. `grow` stays
  where it is, so the field neither slides nor shrinks. The slot sits above the
  list (`zIndex`), so the fading field is drawn over the rows coming up under
  it, as the phone's title bar was: its mid-list close shows the faint field
  over the rows. The slot ignores touches while closing. The field unmounts
  when `lift`'s spring finishes; a turn counter drops a finish that a newer
  opening has overtaken.
- **At the top of the list the phone keeps its field** after Close, standing
  until the list is scrolled. Design 0090 has no standing field, so the app
  closes everywhere as the phone does mid-list (decided under #341).
- **Turning back**: an Escape during the opening stops `lift` and `shown`
  where they are while the keyboard goes, then springs them to 0 from there;
  a Command-F during the fade does the same while the keyboard comes back,
  then springs them to 1. With the one-frame step, timers on the same code
  paths (Close's `exit` 130 ms into an opening; `start` 160 ms into a fade)
  turned the motion back at `lift` 0.521, 0.871 and 0.906, and at 0.023, 0.033
  and 0.026, with no frame gap over 28 ms where `ios-tester` had held 50 to
  105 ms. A field still fading is the same mounted view, which
  `autoFocus` does not act on again, so an opening during the fade focuses it
  explicitly. Close keeps its state if it had appeared, and stays hidden if
  the opening never reached it. `grow` is never stopped: an opening cut short
  goes on growing while it fades.
- **No motion**: an exit while the page is not in front sets every value at its
  end and unmounts at once. The page passes `animate={navigation.isFocused()}`,
  which is false when the exit renders for every exit caused by leaving the
  page. Returning from a result's Reader keeps the field as it stands, and the
  locked greying is the static half opacity it was.
- **Rejected**: React Native's `Animated` with the native driver animates
  transforms and opacity only, so the list would be translated over a frame
  extended past the screen's bottom and the field would slide rather than
  grow. A JavaScript-driven `Animated` height runs on the JavaScript thread,
  which is busiest at exactly these moments: the field's mount and focus, the
  rows switching and the restore on Close. `LayoutAnimation` applies one
  duration-based spring to every changed view alike, with no separate fade and
  no late Close. A SwiftUI animation inside the field's host grows the capsule
  natively but cannot move the list. Reanimated's `withSpring` driven by a
  frame callback with a clamped clock would have run a callback in every frame
  of search; a custom animation runs only while it moves. Restoring the
  position again once the closing spring settles would have kept the
  overshoot at the cost of a point's jump at its end; the overshoot it saves
  is under a point.

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
(`library-search-screen.test.ts`), the field's motion against a Reanimated
double that records each value's spring and finishes it on demand
(`library-search-field.test.ts`: the spring and Reduce Motion, the delayed
Close, the fade and unmount, a close before Close appears, a reopening during
the fade, the instant close off-screen), and the key-target contract. Native views are
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
