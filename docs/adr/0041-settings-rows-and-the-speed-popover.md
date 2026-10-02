---
status: accepted
---

# Settings rows drawn to the phone's measurements, and the speed in the phone's popover

_The product argument is [design 0041](../design/0041-one-look-for-settings-and-the-speed-control.md),
under the principle of [design 0042](../design/0042-the-app-follows-the-phones-own-look.md).
Issue #48._

_Revised by [ADR 0068](0068-the-highlight-colours-are-the-owners.md) (#118):
`NavigationRow`'s check and `ActionRow` are drawn in the accent derived from the
word's Highlight Colour, no longer in amber._

## What was done

### The settings screens

`src/app/controls.tsx` is the one vocabulary the five settings screens are built
from, and `Field`, `Action` and `SettingRow` are gone, since nothing else used
them.

- `SettingsPage`: the `ScrollView` every settings screen is, in the settings page
  colour, with `keyboardShouldPersistTaps="handled"`,
  `keyboardDismissMode="interactive"` and `automaticallyAdjustKeyboardInsets`.
- `SettingsGroup`: an optional title set as written, a card, and a footer that is
  a string (drawn as a `Footnote`) or nodes. Its separators are 1 pt views laid
  absolutely over the bottom of every row but the last, inset `SETTINGS.inset`
  at both ends, so that rows are as wide as their card and pad themselves. It
  provides `LabelColumn`: each `FieldRow` reports its label's width with
  `onLayout`, the group keeps the widest (it only grows), and every label takes
  that as its `minWidth`.
- The rows: `NavigationRow` (a value or an amber check, and a chevron), `ValueRow`
  (the `ChoiceMenu` of ADR 0035), `SwitchRow` (an optional second line, `note`,
  and an `accessibilityLabel` for the switch separate from its visible label),
  `FieldRow` (an inline name and a borderless `TextInput` stretched to the row's
  height, with `clearButtonMode="while-editing"` and an optional accessory),
  `TextRow` (a full-width input) and `ActionRow` (a row in `INK.reading`).
  `Footnote` is a card's footer line.
- `SETTINGS`: `margin` 20, `rowHeight` 53, `inset` 16, `cardRadius` 26 with
  `borderCurve: 'continuous'`, `groupGap` 32, `fontSize` 17.
- Colours. `SETTINGS_SURFACE` swaps `PALETTE`'s page and panel in the light theme
  (page `#f4f4f6`, card `#ffffff`) and keeps them in the dark (page `#111114`,
  card `#1c1c21`). `shell.tsx` gives the five settings screens that page colour
  for their header and content as plain strings, because the navigator types
  header colours as `string`. `INK.secondary` is `rgba(60,60,67,0.6)` /
  `rgba(235,235,245,0.6)`, `INK.tertiary` the same at `0.3`, and
  `INK.separator` is `#e8e8e8` / `#38383b`.
- Every pushed screen's back button is `headerBackButtonDisplayMode: 'minimal'`,
  set once in the navigator's `screenOptions`. The reader's own identical
  setting went with it.

### The speed

`SpeedBubble` in `src/app/player.tsx` is a `Host` of 58 × 44, the size the label's
target already had, holding a controlled `Popover` (`attachmentAnchor="top"`,
`arrowEdge="bottom"`). Its trigger is an `RNHostView` without `matchContents`
holding the label's `Pressable` at `flex: 1`. Its content is an `RNHostView
matchContents` holding a padded `View` and the existing `Speed`: 36 pt buttons
with `hitSlop` 4, and a 17 pt number. While it is open, an absolutely filled
`Pressable`, inaccessible and hidden from VoiceOver, lies over the player and
closes it. The label is 15 pt. The speed's `Sheet` is gone. `Speed`'s timers,
range and handlers are those of ADR 0020, unchanged.

## The facts it was built on

- **iOS 27.0's own Settings**, measured in pixels on the iPhone 17 simulator
  (notes, 17:18): a card 20 pt from each edge, corners about 26 pt, every row
  53 pt, row text 17 pt, separators 1 pt of `#e8e8e8` / `#38383b` inset 16 pt at
  both ends, values `#8a8a8e` on a white card and headers `#85858b` on the
  `#f2f2f7` page (one translucent colour over two backgrounds), chevrons
  `#c5c5c7` / `#5a5a5e`. **Section headers are no longer capitals**: they are
  17 pt semibold, set as written. `SETTINGS` and the three `INK` colours are
  those numbers; the page and card colours stay the app's (design 0042).
- **The popover is a bubble on the phone.** `@expo/ui`'s `PopoverView.swift`
  applies `.presentationCompactAdaptation(.popover)`, so it does not become a
  sheet in compact width. The installed Debug app already carried it, and a
  JavaScript reload was enough (notes, 20:30).
- **React Native buttons work inside it, holding included.** One tap is 0.05 each
  way, and a 2 s hold is 21 steps each way, as in the drawer. The value did not
  move after release, so `onPressOut` arrives (notes, 20:30). With the shipped
  sizes, a 1.5 s hold went 1.50 → 1.95 (`DesignShotsProbe.testSpeedBubble`).
- **A tap outside it reaches React Native buttons too.** The popover's dismissal
  region closes it, and a `Pressable` under the same tap fires as well: Contents
  opened the contents, the voice line the voice sheet. The page's WebView and
  the native header did not react (notes, 20:30, with the table). The shield is
  for that. With it, a tap on Contents while the bubble is open closes the bubble
  and opens nothing, and Contents opens again with a tap of its own
  (`testSpeedBubble`).
- **The bubble is the system's glass.** What is behind it shows through,
  distorted. That is the phone's own look, and it was kept (design 0041).
- **A minimal back button is labelled `Back`.** VoiceOver's label for every
  back arrow is `Back` (`DesignShotsProbe.testBackButtonLabels`). The phone's
  own Settings labels its arrow with the screen behind it (`BackButton`, label
  `Settings`, in `native-reference.sh`'s tree). `react-native-screens` sets the
  previous item's `backButtonTitle` and `backButtonDisplayMode = .minimal`
  (`RNSScreenStackHeaderConfig.mm`) and offers no accessibility label of its
  own, so the screens keep their `headerBackTitle` only for the back button's
  long-press menu.
- **Backspaces cannot empty a long field.** A tap leaves the caret where it
  lands, and a backspace deletes only what is before it. Four passes of
  tap-the-far-end-and-delete still left 49 characters of a doubled address,
  because a value longer than the field scrolls. The system clear button is the
  phone's own affordance for this, and the probes use it (README Pitfalls).

## Consequences

- The label column settles one layout pass after first render, growing to the
  widest name. At `content_size extra-extra-large` the columns still align, and
  nothing clips (the iOS tester's `ProviderFreezeProbe.testDynamicTypeSpotCheck`).
- The popover's look is the system's, not the app's panel colour. Changing that
  would take `presentationBackground`, and it was declined.
- VoiceOver says `Back` where the phone's own Settings says the screen's name.
- `SETTINGS` holds the phone's measurements as of iOS 27.0. When the phone's look
  changes, `test/manual-test/settings/native-reference.sh` and `design-shots.sh` repeat
  the comparison, and the constants change in one place.

## Alternatives

- **The settings screens as SwiftUI `Form`s** through `@expo/ui` (`Form`,
  `Section`, `LabeledContent`, `TextField`, `SecureField` are all there). It
  would be pixel-exact and would follow Dynamic Type natively, but every screen
  would be rewritten in a second toolkit, with the accessibility repairs
  `ChoiceMenu` already needed repeated on each.
- **A fixed label column.** It clips when the phone's text size is above the
  default, since the app's text scales with it.
- **The system `Stepper` in the popover.** It repeats at its own pace, and every
  change is a whole Word Timing re-send (ADR 0020). It was the fallback if our
  `Pressable`s had not worked inside the popover. They did.
- **The speed `Sheet` at the player's height**, and **the transport row turning
  into the stepper in place**, both turned down in design 0041.
