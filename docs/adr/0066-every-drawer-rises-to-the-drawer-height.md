---
status: accepted
---

# Every drawer is `@expo/ui`'s SwiftUI `BottomSheet`, at a custom detent for the Drawer Height and `large`

_The product argument is [design 0066](../design/0066-every-drawer-rises-to-the-drawer-height.md).
Issue #117; the plan is the owner's comment there of 2026-10-01. **Drawer** and
**Drawer Height** are in CONTEXT.md. The facts are in `notes/NOTES_2026-10-01.md`,
11:19 to 11:58, from Apple's documentation, the iOS 27 SDK header, the HIG's
Sheets page, `@expo/ui` 57.0.19's sources and a throwaway probe (`e09da7c` on
`xujialiu/highlight--sheet-probe`, `src/app/sheet-probe.tsx`; screenshots in
`/tmp/sheet-probe/`). It revises the `Sheet` of
[ADR 0026](0026-a-coherent-reading-interface.md) ("A shared draggable header
replaces decorative grips"), the lookup drawer of
[ADR 0051](0051-looking-up-words-and-translating-text.md), the download view's
links in [ADR 0027](0027-whole-document-offline-narration.md), and every
statement in ADRs [0035](0035-a-short-choice-is-the-systems-own-menu.md),
[0045](0045-two-finger-selection-is-the-apps-copy-of-the-phones.md) and
[0059](0059-sharing-copies-the-file-under-its-library-name.md) that rests on
the drawer being a React Native `Modal`._

**Built in batches.** Batch 1 (`56a92b0`) is the drawer itself, the setting,
Contents and one drawer at a time; batch 2 moves a Document's actions drawer and
batch 3 Voice and Lookup. Until then those drawers stay on the old `Sheet`, and
take part in the turns below.

## What was there

`src/app/sheet.tsx`'s `Sheet` is `<Modal visible transparent animationType="slide">`
(`:53`) holding a `KeyboardAvoidingView`, a full-height tap-to-close `Pressable`
behind the card, and the card, `maxHeight: '90%'`, which draws its own grip and
title and is dragged by its own `PanResponder` (ADR 0026). Every drawer's height
was its content's: estimated from the styles at `8b75909`, Rename ≈253,
the actions menu ≈279, Appearance 328, Voice ≈453, Fonts ≈505, Contents 518
and Download ≈570–610 pt (notes 11:21). The side insets were 12, 16, 20 and
24 pt and the row heights 46, 52, 56 and 58 pt, each written in its own file
(#117). The lookup drawer was not a `Sheet` but an absolutely placed view of its
own at 0.46 and 0.88 of the reading view's height, dragged between 0.25 and 0.88
(`src/app/lookup-drawer.tsx:18, 29–32, 44`; notes 11:21).

## What was decided

- **The phone's sheet.** Every drawer, the lookup drawer included, is
  `BottomSheet` from `@expo/ui/swift-ui`, a plain SwiftUI
  `.sheet(isPresented:onDismiss:)` on its anchor
  (`node_modules/@expo/ui/ios/BottomSheetView.swift:105–111`; notes 11:20),
  with `presentationDetents([<the Drawer Height's custom detent>, 'large'])`.
  The sheet opens at the first detent of the array
  (`node_modules/@expo/ui/ios/Modifiers/PresentationModifiers.swift:127–130`), so it opens at the
  Drawer Height every time. Its children are unmounted after dismissal
  (`node_modules/@expo/ui/build/swift-ui/BottomSheet/index.d.ts:5–6`).
- **The Drawer Height is a custom detent.** It is a share of the whole screen's
  height, measured from the bottom edge: 40–90 % in steps of 10, default 50 %,
  per device, a second row "Drawer height" in General's Theme card. `'medium'`
  could not be it: medium's height is the system's, not the owner's, and no
  document states its value (notes 11:19). Measured, it is 451.0 pt on an
  874-pt screen, 51.6 %, as a floating card (below).
- **No `presentationContentInteraction`.** `@expo/ui` 57 has none (`grep -rn
  contentInteraction` over `node_modules/@expo/ui/{ios,build,src}` finds
  nothing; notes 11:20), so swiping up on a drawer's content takes SwiftUI's
  default: the sheet grows to `large` first and its content scrolls only there.
  The probe saw it for SwiftUI and React Native content alike (below). This is
  accepted, not worked around.
- **The page behind.** `presentationBackgroundInteraction({ type:
  'enabledUpThrough', detent: <the Drawer Height's detent> })`; the type takes
  any `PresentationDetent`, custom ones included
  (`node_modules/@expo/ui/build/swift-ui/modifiers/presentationModifiers.d.ts:10, 41`). At the Drawer
  Height the page is undimmed and live; at `large` it is dimmed and takes no
  touches. With background interaction on, a tap on the page does not dismiss
  the sheet, so a tap outside never closes a drawer. A swipe down does.
- **The background.** `presentationBackground` with `SETTINGS_SURFACE[scheme].page`
  (`src/app/controls.tsx:114`), and the cards in `SETTINGS_SURFACE[scheme].card`:
  the drawer is a Settings page in the app's own palette, opaque, rather than
  the system's glass. It follows the app's Theme, not the phone's. System
  controls in it take the app's accent. `presentationBackground` "Paints the
  entire sheet chrome including the drag-indicator zone and home-indicator
  safe-area inset" (`presentationModifiers.d.ts:53`).
- **The header is drawn by the app.** The title is centred (17-pt semibold,
  the system's inline title, below), except on the first page of a Document's
  actions drawer, which keeps the Document's name on the left and Share on the
  right (ADR 0059). A page reached from another page in the same drawer has a
  round back button (‹) on its left, copied from the system's. There is no close
  (X).
- **The content.** Inset grouped cards. Rows the system can draw (Font, Font
  Size, Margins, Alignment, pickers) are SwiftUI controls in a `Form`. Rows it
  cannot (Contents, the Download chapters) are React Native, drawn to the
  system values measured below: 52-pt rows, cards 16 pt from the edge,
  separators inset 16 pt.
- **One module for every drawer value.** `DRAWER` in `src/app/drawer.tsx`
  holds the header metrics, the round button, the card's 16-pt inset and 26-pt
  radius, the 52-pt row, the 16-pt separator inset, the 35-pt section gap, the
  8-pt footer gap and the colours per scheme, as plain strings. `Drawer` is the
  sheet with its header; `DrawerCard`, `DrawerSeparator` and `DrawerFooter` are
  the shared parts. The detent arithmetic is `drawerDetentHeight` in
  `src/app/drawer-height.ts`, apart so a test can import it. The setting is
  `AppSettings.drawerHeight`, one of `DRAWER_HEIGHTS` = 40–90, read back as 50
  when it is anything else, and not in `engineIdentity`.
- **The Theme and the grabber.** The `Host` takes `colorScheme` and the sheet
  `environment('colorScheme', …)` from the app's resolved Theme, and
  `tint(…)` the reading accent as a plain string per scheme. Measured with
  the app dark on a light phone and the reverse, the drawer drew the app's
  colours both ways (notes 13:21). `presentationDragIndicator('visible')`
  ships: the HIG asks for a grabber on a resizable sheet.
- **One drawer at a time** (owner's Q43). Because the page stays live, a button
  that opens another drawer can be pressed while one is up. SwiftUI presents
  one sheet at a time: the first build presented nothing, and left the old
  `Modal` drawer's state open, so ⋯ stayed dead until the reader was reopened
  (notes 13:41). `src/app/drawer-turns.ts`'s `createDrawerTurns` is a pure
  queue, tested in `test/app/drawer-turns.test.ts`. A drawer asking for its
  turn while another holds it calls the holder's `onClose`, and is presented
  only once the holder reports its dismissal. A dismissal reported twice, or
  before the owner closed it, is ignored, since iOS does both. `useDrawerTurn`
  in `drawer.tsx` hands each drawer its turn. The old `Sheet` and the lookup
  drawer take part, in both directions.
- **A dark drawer is a step lighter than the page** (owner's Q44). In the dark,
  `SETTINGS_SURFACE.dark.page` is the reader's own `#111114`, and a drawer that
  colour showed no edge but its grabber. So in the dark the drawer is
  `#1c1c21`, its cards `#2c2c32`, the separator `#44444b`, and the current-row
  mark and button rim `#3e3e47`, all in `DRAWER.colours`. Measured, the edge is
  an 11-level step across the width, and the separator and mark are 24 and 18
  levels above the card (notes 13:53). The light drawer is the Settings page,
  `#f4f4f6`, with white cards.
- **Per drawer.** Rename is the system's alert with a text field, over the
  drawer: Cancel returns to the menu, Save renames and closes, Save is disabled
  while the name is blank. Voice's provider and locale chips become two menu
  rows, Provider and Language. Download's "Manage downloads" / "Back to
  downloads" link (`src/app/download-sheet.tsx:237`) becomes a page, Manage,
  with a back button; Select all / Deselect all goes to the header's right;
  Download selected is fixed at the bottom; Pause all / Resume all goes on the
  download's status line. Lookup's 0.46 / 0.88 give way to the Drawer Height
  and `large`.
- **The page is not moved for a drawer.** The centring knows the player's inset
  and the bar's (`bridge.setInset`, `bridge.setBar`, ADR 0048); it is not told
  about a drawer, so a drawer that covers the line being read is left covering
  it.

## The custom detent's arithmetic

Apple's header, of a custom detent: "The value returned from the
resolutionContextBlock is a height within the safe area of the sheet. For
example, returning 200 will result in a detent where the height of the sheet is
200 + safeAreaInsets.bottom when edge-attached, and just 200 when floating"
(`UISheetPresentationController.h` lines 68–75, Xcode 27.0; notes 11:19). So the
number handed to `{ height }` is not the Drawer Height's share of the screen:
for a share `f` of a screen `H` points tall, the sheet's top edge is at
`H × (1 − f)` only if the value is `f × H − 34` on an edge-attached sheet (the
34-pt bottom inset of the iPhone 16 and 17 family, notes 11:21), or
`f × H − 8` on a floating one whose bottom stands 8 pt off the screen's edge, as
medium's did. `{ fraction }` is glossed in `@expo/ui` as "Fraction of screen
height" (`presentationModifiers.d.ts:7`), while Apple's page does not say what
it is a fraction of and its `CustomPresentationDetent` example works from
`maxDetentValue`, "The height that the presentation appears in" (notes 11:19).

**Measured** on the iOS 27.0 simulator at 402 × 874 pt (notes 12:52, 13:21):
a sheet at a custom `{ height }` detent **floats** as medium does, a card inset
8 pt from the sides and bottom, everything in it scaled by (402 − 16) / 402 =
0.960, whatever the `.d.ts` says of `presentationSizing`. And the header is
wrong for it: the floating card is the scaled `value + safeAreaInsets.bottom`
all the same. The first value, `f × H − 34` = 403, drew a card 420 pt tall
with its top at 446.3 instead of 437. The card's top edge is at
`H − 8 − 0.960 × (value + 34)`, so `drawerDetentHeight` hands the detent
`(f × H − 8) / 0.960 − 34`. `{ fraction }` is not used.

| Drawer Height | wanted top edge | measured, light and dark |
| --- | --- | --- |
| 40 % | 524.4 | 524.67 |
| 50 % | 437.0 | 437.0–437.33 |
| 70 % (set from General's menu) | 262.2 | 262.33 |
| 90 % | 87.4 | 87.33 |
| `large` | 62.0 | 62.0, full width, edge-attached |

Every one is within one pixel, 1/3 pt. `test/manual-test/kit/drawer-edge.py`
finds the edge from the grabber, which works in the dark too.

## The measured sheet

Probe `e09da7c`: `BottomSheet` with `presentationDetents(['medium', 'large'])`
and `presentationDragIndicator('visible')`, on an `iPhone 17` simulator, iOS
27.0, 402 × 874 pt, read from 1206 × 2622 px screenshots ÷ 3 (notes 11:35,
11:45, 11:58). Every content measurement is at `large`; at medium, multiply by
0.96.

| | measured |
| --- | --- |
| medium | top edge 415.0 pt, **451.0 pt** tall, a floating card inset 8 pt left, right and bottom, 386 pt wide, its content scaled 0.960 |
| large | top edge at **62.0 pt**, the screen's top safe-area inset; full width to the screen's bottom, edge-attached, 812 pt tall |
| sheet corners | top ≈36 pt at medium, ≈37 at large; medium's bottom corners ≈51 |
| grabber | 60.0 × 4.0 pt, 6.0 pt below the sheet's top, centred; a tap toggles medium ↔ large |
| `Form` rows | **52.0 pt** (LabeledContent, NavigationLink, Stepper, menu Picker, Toggle); ColorPicker 58.0 |
| `Form` cards | inset **16.0 pt** from the screen's edges, 370 pt wide, radius **≈26 pt** (fit 26.4) |
| separators | 1.0 pt, (232,232,232) light, inset **16 pt** from the card on both sides |
| section header | title case, ≈17-pt semibold, (133,133,139), level with the row text, 14.0 pt from its baseline to its card; 35.0 pt between cards |
| plain `List` | 52.0-pt rows, full-row separators from 16.0 to 386.0 pt, also under the last row |
| dimming | a black overlay of **20 %** light (white 255 → 204) and **48 %** dark (255 → 133), the same at medium and large |
| background | light large `Form` (242,242,247) with white cards; dark large `List` (28,28,30); at medium translucent glass, a ≈ 0.57 |
| `RNHostView` | 402 × 778 at large (812 − 34) and 402 × 435.67 at medium, in unscaled points; its y 0 is the sheet's top edge, under the grabber |

**Background interaction.** Without it, a tap on the page at medium dismissed
the sheet, and the page's button did not see it; a full-screen
`Group | dismiss popup` element is in the tree. With
`enabledUpThrough: 'medium'`, the page at medium read undimmed (white 255,
black 0), the same tap counted on the page and the sheet stayed, and at `large`
the page was dimmed to 204 again. At `large`, either way, a touch in the 62-pt
strip above the sheet did nothing. The geometry was the same with and without
it (notes 11:35).

**Swipes.** A drag down on the `Form` at medium dismissed the sheet; from the
grabber at `large` the same drag went to medium. A drag up on the `Form` at
medium took the sheet to `large` without scrolling it. On a React Native
`ScrollView` inside `RNHostView`, the first drag up at medium logged no
`onScroll` and grew the sheet, the host being re-laid out on every frame (439,
446, 449.67 … 609, then 778); a second drag at `large` scrolled it; a drag down
at its top took the sheet to medium (notes 11:58).

**The toolbar.** With `NavigationStack`, `Toolbar` and `navigationTitle`, the
title is a large title on the left, ≈34-pt bold at x 16.33 pt, and `@expo/ui` 57
has no `navigationBarTitleDisplayMode` or `toolbarTitleDisplayMode` to ask for
an inline one (`grep` of `build/swift-ui`). It collapses into an inline, centred
≈17-pt semibold title only when the content scrolls. The bar and large title
cost 122 pt: the first card's top moves from 102.33 to 224.33 pt. The close
button is a ≈44-pt glass circle. A `NavigationLink` pushed inside the sheet's
own `NavigationStack`, and the pushed page has a glass back button at its top
left (notes 11:45). Hence a header drawn by the app, to the inline title's
size.

**A field in the sheet.** A focused `TextInput` inside `RNHostView` took the
sheet to full height at once (top edge 62.0, edge-attached, opaque) with no
`detent` event, the host re-laid out to 402 × 484 to the keyboard's top at
546.0 pt; a drag down from the grabber blurred the field and dismissed the
sheet in one gesture (notes 11:58). Rename is the system's alert, so no drawer
holds a field.

**The HIG** (Sheets, notes 11:19): "Include a grabber in a resizable sheet";
"Support swiping to dismiss a sheet. People expect to swipe vertically to
dismiss a sheet instead of tapping a dismiss button"; the Back button "isn't
intended to dismiss a sheet"; and a nonmodal sheet is how Notes formats a
selection while the note stays editable.

## Still to be measured or recorded

- How the Rename alert is built (batch 2).
- Dynamic Type sizes, VoiceOver and a physical phone; none was measured.
- A queued drawer waits for the holder's dismissal with no timeout, so a
  dismissal iOS never reports would leave it waiting. An unmounting old
  `Sheet` releases its turn before UIKit has finished taking it down; Contents
  presented every time regardless (notes 13:41).
- Rows that now live inside `RNHostView` in a sheet, each of which ADR 0035,
  0045, 0051 or 0059 measured inside the old `Modal` or over the reader:
  - the Alignment and Theme menus (ADR 0035), now system pickers in a `Form`;
  - the two-finger chapter sweep (ADR 0045), whose gesture-handler root was the
    app's root and reached into the `Modal`;
  - the share sheet presented over the drawer (ADR 0059);
  - dragging the reader's selection handles while the lookup drawer is at the
    Drawer Height (ADR 0051), through background interaction rather than an
    absolutely placed view. At `large` the page takes no touches, where the old
    0.88 left the top 12 % of the reading view live.
- How many Contents and Download rows show at 50 %.

## Alternatives

- **Keep `Sheet` on React Native's `Modal`, with the system's values copied in**
  (B in the owner's Q18). React Native 0.86.3's `Modal` has no detent prop
  (`node_modules/react-native/Libraries/Modal/Modal.js:102–155`); its `pageSheet` and `formSheet` keep
  UIKit's default `[largeDetent]`, and nothing under
  `React/Fabric/Mounting/ComponentViews/Modal/` touches
  `sheetPresentationController` (notes 11:20). The heights and the drag would
  stay the app's own `PanResponder`: approximate physics, falling behind iOS.
- **react-native-screens' form sheet**, through native-stack's
  `presentation: 'formSheet'`. It does expose detents (`sheetAllowedDetents`,
  `sheetLargestUndimmedDetentIndex`, `sheetExpandsWhenScrolledToEdge`,
  `sheetInitialDetentIndex`; `node_modules/react-native-screens/lib/typescript/types.d.ts:318–411`),
  but each drawer would become a screen in the navigator rather than a
  component over the reader's screen. Turned down.
- **`'medium'` for the lower height.** Fixed by the system at 451.0 pt on this
  phone, not the owner's choice, and a floating card scaled by 0.96.
- **`fitToContents`**, which sets `.presentationDetents([.height(childrenSize.height)])`
  (`node_modules/@expo/ui/ios/BottomSheetView.swift:81–87`). That is each drawer finding its own height
  again, which is what #117 is about.
- **The system's toolbar and title.** A large left title, no inline mode in
  `@expo/ui` 57, and 122 pt of every drawer (above).
- **A single detent**, which would let content scroll at once (an inference from
  the header's "If there is a larger detent to expand to", notes 11:19). The
  owner wants to swipe a drawer up for more room.
- **Dimming at the Drawer Height**, the default without
  `presentationBackgroundInteraction`. The page could not be judged, nor
  highlight colours chosen, under a 48 % overlay in the dark.
- **The system's glass background.** The owner chose the app's palette.
