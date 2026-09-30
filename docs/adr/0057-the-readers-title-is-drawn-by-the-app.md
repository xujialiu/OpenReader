---
status: accepted
---

# The reader's title is drawn by the app, on up to two lines, inside a measured width

_The product argument is [design 0057](../design/0057-a-long-name-takes-a-second-line.md).
Issue #85. The bar itself, its transparency, its height and the room the page
keeps for it are [ADR 0048](0048-the-bar-floats-and-the-page-keeps-room-for-it.md)'s
and do not change._

## Why the bar cannot do it

`UINavigationItem.title` is laid out by the navigation bar on one line, and
native-stack 7.19's `headerTitleStyle` takes a font, a size, a weight and a
colour and nothing else: no line count. react-native-screens 4.26 has no
`numberOfLines` for the title either (`RNSScreenStackHeaderConfig.mm`). The one
way to put two lines there is a custom title view, native-stack's `headerTitle`
as a function, which react-native-screens mounts as `navigationItem.titleView`.

## What was done

`src/app/reader-title.tsx`'s `ReaderTitle` is a `Text` with:

- `numberOfLines={2}` and `ellipsizeMode="tail"`; since design 0060 the `Text`
  is `NameText`'s (`src/app/name-text.tsx`), which shows the name cut after a
  whole word, read off an unseen copy laid out at `width={room}`, the title's
  full `maxWidth`, because the title's own box shrinks to its words;
- 17-point semibold (`fontWeight: '600'`), centred, `INK.text`: the phone's
  inline bar title is the `headline` style, 17-point semibold;
- `allowFontScaling={false}`: the phone's own inline bar title does not follow
  Dynamic Type, and two lines at a larger size would not fit the bar;
- `accessibilityRole="header"`; VoiceOver reads the whole name, not the
  truncated one;
- `maxWidth: windowWidth - 2 * TITLE_SIDE`, `TITLE_SIDE = 81` (below).

`reader-screen.tsx` passes `headerTitle: () => <ReaderTitle title={title} />`
in the `setOptions` it already made, and keeps `title`, which the back button's
long-press menu uses. `test/app/player-rules.test.ts` pins each of these.

## The width is measured

react-native-screens lays a title subview out with Yoga and hands UIKit a view
of that size; since iOS 26 only the left and right subviews are sized by Auto
Layout (`RNSScreenStackHeaderSubview.mm`, `needsAutoLayout`). The header config
is absolutely positioned at the screen's full width, so an unconstrained `Text`
would wrap at about 402 points and be wider than the space between the buttons.
The title has to be told its width.

Measured on the iPhone 18 Pro simulator (iOS 27.0, 402 × 874 points, dark
theme), from a screenshot of the reader with the phone's own title showing a
103-character name (notes 2026-09-29):

| | from (pt) | to (pt) |
| --- | --- | --- |
| back button's glass | 15.3 | 60.3 |
| the native title's letters, truncated | 72.7 | 311.7 |
| More actions' glass | 333.3 | 386.3 |

So UIKit leaves about 12 points between a button and the title, and the native
title was not centred: it ran from about 72 to about 321 and sat towards the
narrower back button. A custom title view of a fixed size is centred, so it has
to fit centred against the wider side: 402 − 333.3 + 12 ≈ 81 points a side, a
width of 240 on this phone, against the native title's roughly 249.

The two lines take about 41 points of the 54-point bar (ADR 0048), so the bar's
height and the page's top do not change.

## Alternatives

- **A smaller font on two lines.** Turned down by the owner (design 0057).
- **A taller bar.** The page keeps room for the bar's height (ADR 0048), so
  every title would move the text.
- **iOS 26's `UINavigationItem.subtitle`.** A second line of a different style
  rather than a wrap of the same name, and native-stack does not expose it.
- **Measure the buttons at run time.** The title subview is laid out before
  UIKit places the buttons and learns nothing back but its own origin
  (`updateShadowStateInContextOfAncestorView`), so there is nothing to read.
