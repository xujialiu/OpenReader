---
status: accepted
---

# A short choice is the system's own menu, through `@expo/ui`

_The product argument is [design 0035](../design/0035-a-short-choice-opens-where-you-tapped.md).
Issues #32 (Alignment) and #33 (Theme)._

_[ADR 0066](0066-every-drawer-rises-to-the-drawer-height.md) replaces the drawer's
React Native `Modal` with `@expo/ui`'s SwiftUI `BottomSheet`. "Inside the
drawer's `Modal`" below was measured in the old drawer; the menus in the new one
are still to be measured there._

## What was done

`@expo/ui` `~57.0.19`, the version Expo SDK 57 pins (`npx expo install @expo/ui`),
supplies SwiftUI's `Menu`. `ChoiceMenu` in `src/app/controls.tsx` wraps a drawn
row in it:

- a `Host` with the row's explicit `height` and `alignSelf: 'stretch'`;
- the `Menu`'s `label` is the drawn row, through an `RNHostView` without
  `matchContents`, so the label takes the SwiftUI frame it is given and the row
  inside is `flex: 1`;
- one `Toggle` per `Choice`, with `systemImage`, `isOn` for the one in force, and
  `onIsOnChange` that chooses its value whatever the new state;
- modifiers `menuOrder('fixed')`, `accessibilityElement('ignore')`,
  `accessibilityLabel('Alignment, Justify')` and `accessibilityAddTraits(['isButton'])`.

`ValueRow` (General) and the Alignment row (Appearance) are both drawn rows
inside a `ChoiceMenu`. Nothing inside the label is a `Pressable`: the menu owns
the tap. It replaced the Theme `Sheet` and `ChoiceRow`, which had no other use,
and the drawn `sun`, `moon` and `auto` icons, which had none either.

## The facts it was built on

- **A native dependency.** `@expo/ui` adds the `ExpoUI` pod (57.0.19), so an
  installed build without it cannot load a bundle that imports it. The
  simulator app was rebuilt with `npx expo run:ios`, and the owner's iPhone
  needs the same once. The package also pulls `react-dom`, Radix and `vaul`
  into `node_modules` for its web implementation. None reaches the iOS bundle:
  in the 9.6 MB development bundle Metro served for iOS, `node_modules/vaul`
  and `@radix-ui` occur nowhere, and the one `react-dom/` is an error string in
  React Navigation's `ServerContainer` (notes 13:02).
- **`menuOrder('fixed')` is load-bearing.** The v57 docs: "With the default
  `automatic` order, a menu that opens upward displays its items in reverse."
  Alignment is the last row of a drawer at the bottom of the screen, and its
  menu opens upward. With `fixed`, it listed Left above Justify (screenshot,
  notes 12:36).
- **Inside the drawer's `Modal`.** The drawer is a React Native `Modal` whose
  backdrop is a `Pressable` that closes it. Measured with real touches
  (`AlignmentProbe`, notes 12:36 and 12:38): the menu opens from the row, a
  choice applies and closes the menu while the drawer stays open, and a tap
  outside the menu — on the drawer's title, or on the page above it where the
  backdrop is — closes the menu alone and chooses nothing. The passthrough this
  could have been was fixed in `expo-modules-core` 57.0.9 ("the tap that closes
  a SwiftUI menu also pressing the React Native view underneath") and 57.0.17,
  and the lockfile has 57.0.18.
- **Accessibility needs the trait back.** `accessibilityElement('ignore')` makes
  the row one element with its words hidden, but "the new element starts with no
  properties": XCTest saw it as an `Other` labelled `Alignment, Justify`, so
  VoiceOver would not have called it a button and `app.buttons[…]` could not
  find it. `accessibilityAddTraits(['isButton'])` made it a `Button` (notes
  12:53). The menu's items are `Button`s whose `identifier` is the SF Symbol
  (`text.alignleft`) and whose `label` is the title, and the checked one is
  `Selected`, which is what the Theme drawer's rows exposed. The Theme probes
  kept working without change beyond their wording.
- **The row morphs into the menu.** On iOS 27.0 the row's content is empty
  while its menu is open; it is the system's transition, not a layout fault.
- **The theme reaches it.** Drawn light and dark with the app, because the
  hosting view inherits the window's `overrideUserInterfaceStyle`, which
  `shell.tsx` sets (ADR 0022). Screenshots in both, notes 12:54.

## Alternatives

- **`@expo/ui/community/menu`'s `MenuView`**, the drop-in for
  `@react-native-menu/menu`, builds the same SwiftUI `Menu` but takes no
  `modifiers`, so the order could not be fixed, and its host always
  `matchContents`, which a full-width row does not have.
- **`Picker` with `pickerStyle('menu')`** draws its own value button in the
  system tint, so the row would stop looking like every other row, and only
  that button would be the target, not the row.
- **A native module of our own presenting a `UIMenu`.** More native code to own
  for what the pinned package already does.
- **No native menu**: a page inside the drawer, or a second `Sheet`. See design
  0035.
