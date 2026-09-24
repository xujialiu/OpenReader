---
status: accepted
---

# A border is a plain colour for the theme on screen, not a dynamic one

The issue is #29. The measurements are in `notes/NOTES_2026-09-24.md`, 13:10 to 13:37. This is a purely technical decision, so it has no design file: what the owner sees is only that the lines are the right grey.

## What went wrong

ADR 0022 made every colour in `INK` a `DynamicColorIOS`, one `UIColor` carrying both themes, and forced a theme by setting the window's `overrideUserInterfaceStyle`. That holds for a view's background and its text. It does not hold for its border.

React Native 0.86.3's Fabric view, `RCTViewComponentView.mm`, repaints in `invalidateLayer`. The background there is `[_backgroundColor resolvedColorWithTraitCollection:self.traitCollection]`; the border is `RCTUIColorFromSharedColor(…).CGColor` for a uniform one and `RCTGetBorderImage` filling with `borderColors.*.CGColor` for a single edge. `-[UIColor CGColor]` on a dynamic colour answers for `UITraitCollection.currentTraitCollection`, and UIKit sets that to the view's own traits only inside its trait-aware callbacks. `traitCollectionDidChange:` calls `invalidateLayer`, so a view's first entry into the window is resolved right. A later relayout from a Fabric mount is resolved against the process's traits, which follow the phone, not the window's override. The old architecture's `RCTView.m` resolves all four border colours against `self.traitCollection`; `facebook/react-native` `main` still has the Fabric line as it is here on 2026-09-24.

So a drawer's own top edge, laid out again when its content changed height, took the phone's grey, while rows newly mounted inside it took the theme's, and the same drawer opened two ways came out both ways. Measured: the app dark on a light phone and light on a dark phone both wrong in six of eight screenshots; following the phone, never wrong, because there the process's answer and the window's are the same.

## What was done

`controls.tsx` exports `BORDER`, the colours a border takes (`line`, `text`, `reading`, `quiet`) as plain strings per theme, taken from the same `PALETTE` the dynamic colours are built from. The shell provides the theme it already resolves once with `resolveTheme` — the answer the navigation header and the status bar take — through `SchemeContext`, and `useBorders()` returns `BORDER` for it. Every `border*Color` in `src/app/` is now an inline style from `useBorders()`: the drawer's top edge, the separators of Contents, the actions drawer, the voice list, the download list and the font list, the voice chips, the download checkbox ring, and the player's edge. Two `borderColor`s with no `borderWidth` on the player's round buttons drew nothing and were removed, as were the leftover `sheet`/`grip`/`behind` styles of the drawer each file drew before `sheet.tsx` existed.

`test/app/border-colours.test.ts` fails on any `border*Color` or `outlineColor` under `src/` whose value is an `INK` entry, an `ink(` call, `DynamicColorIOS` or `PlatformColor`, and shows that it fires on the spellings #29 was drawn with.

The cost: a theme change now re-renders the components that draw a border, where ADR 0022 had no render at all. Backgrounds, text and icons keep their dynamic colours and still repaint without one.

## Alternatives

- **Patch `RCTViewComponentView.mm`** to resolve the border against `self.traitCollection`, as `RCTView.m` does. The exact fix, but the installed core is prebuilt (`RCT_USE_PREBUILT_RNCORE` is 1 unless `ios.buildReactNativeFromSource`), so the patch means compiling React Native from source in every build and every worktree, and checking it again at every upgrade.
- **Swizzle `invalidateLayer`** to run inside `[self.traitCollection performAsCurrentTraitCollection:]`. Fixes every border with no JavaScript change, but it is native code hooked into a React Native internal, it does nothing silently if the method is renamed, and it needs a native rebuild.
- **Draw lines as filled views**, as the settings cards' separators already are (`controls.tsx`). A background resolves right, and a straight separator is simple, but the drawer's rounded top edge and a round ring become two stacked views imitating a border.

When React Native resolves a border against the view, this ADR can be superseded and the borders can take `INK` again; the test is the thing to delete with it.
