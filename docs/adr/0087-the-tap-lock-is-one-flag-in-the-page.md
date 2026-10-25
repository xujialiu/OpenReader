---
status: accepted
---

# The Tap Lock is one flag in the page, read where a tap acts

_The product argument is
[design 0087](../design/0087-a-tap-on-the-page-can-be-locked.md). Issue #325._

## What was done

- **A device setting.** `AppSettings.tapLock`, default `false`, read by
  `parseSettings` as `data.tapLock === true`, so a `settings.json` written
  before #325 reads as unlocked. It is written with the rest of the device's
  settings and never reaches the Sync Folder. Not in `engineIdentity`.
- **One message, sent again on install.** `TapLockMessage` (`{ kind: 'tapLock', on }`),
  sent by `ReaderBridge.setTapLock` when the value changes and again when the
  page program installs, as `followOnly` is, so a page opened again after its
  process ended (#120, ADR 0067) is locked too.
- **Two guards in the page program** (`highlighter.ts`), both reading one flag,
  `tapLock`:
  - `tapped()` returns before anything else, so no `TAP_MESSAGE` is posted.
  - `linkHeld()`, the capture-phase listener on each section document that
    #191 added for the collapsed Player, now also stops a link's click while
    locked: `preventDefault()` and `stopPropagation()` before epub.js's own
    `onclick` on the `a` can call `rendition.display`, and it does not hand the
    click to `tapped()` as it does for the collapsed Player.
- **Nothing else reads it.** `dragged()` (Browsing, #52, #71), the passive
  touch listeners and the selection listeners of Word Lookup are untouched, so
  a drag still browses and a long press still selects. The collapsed Player's
  `lockPage()` (no finger scroll) is a different thing and is unchanged.
- **The button** is in the Player's new bottom row (`player.tsx`), at the left,
  `layout.endWidth` wide and `layout.rateHeight` tall, the same column as the
  speed and, in the compact layout, as Contents. `lock` and `unlock` are new
  paths in the app's own icon set; the shut one is drawn in `useAccent().reading`.
  VoiceOver reads `Lock Taps` or `Unlock Taps`.
- **The Player's geometry, after the owner found it too tall** (184 points
  with the row, against 134 without, at the default text size on an iPhone 16
  Pro). The head row and the bottom row keep 44-point touch areas but take
  32 points of the column (`headHeight`, `footHeight` in `player-layout.ts`),
  by a negative vertical margin on the row; rows are 4 points apart instead of
  6, so row centres are 46 points apart around the 52-point Play instead of
  54. The padding under the bottom row is `playerBottomPadding`: the row's
  centre on the bottom safe-area inset, never less than 28 points above the
  bottom. The open Player is 146 points there.

## The geometry's facts

- **A `hitSlop` cannot reach past the parent's bounds** (React Native's own
  documentation for `Pressable`), and each control's parent is its row; a
  negative margin on the row lets the row's frame keep the touch area while
  Yoga counts only the drawn height.
- **The screen's corner, measured.** The iPhone 16 Pro device type's
  `framebufferMask` (Xcode 27's CoreSimulator profile), rendered and walked
  from the bottom edge: the curve is 70.3 points tall, 12.3 points in at 25
  points above the bottom and 19.3 at 17. The lock's drawn body starts 34
  points from the left edge and ends 25 points above the bottom at the new
  height, about 22 points clear, so the row's ends stay in the columns of
  Contents and the speed. The iPhone 16 Pro Max and 17 Pro have the same
  curve to a tenth of a point; the iPhone Air's is 76.8 points tall; a 16e's
  53.0.
- **Apple's own corner buttons on the same phone** (iOS 27.0, measured from
  the accessibility tree): Safari's Back and Tabs are 48-point circles at
  34 points from the sides with their lower edge 34 points above the bottom;
  Files' tab bar buttons end 25 points above it. The bottom safe-area inset is
  34.
- **A SwiftUI host keeps the safe area.** With the bottom row on the inset's
  line, the Sleep Timer's `Host` lies 22 points inside the home indicator's
  safe area, and SwiftUI shrank the menu's label by that much (its frame read
  58 by 22 in the accessibility tree), drawing the moon 11 points above the
  lock. `ignoreSafeArea="container"` on that `Host` gave back 58 by 44.

## Facts it rests on

- **The capture-phase listener runs before epub.js's link handler.** epub.js
  gives every followable `a[href]` an `onclick` that displays its target and
  returns false; a capture listener on the document runs first, and stopping
  propagation there keeps both that `onclick` and the document's bubbling
  `click` listener (`tapped()`) from running. This is #191's mechanism for the
  collapsed Player, reused; `test/renderer/tap-lock.test.ts` runs it over the
  real page program and epub.js's own handler in `stand-in-page.ts`.
- **A long press is not a click.** The page has used `click` for a tap since
  ADR 0020, because taking the long press would need `user-select: none`,
  which stops `::highlight()` from painting. So a guard on the click leaves
  selection alone without any special case.

## Considered

- **Dropping taps on the app's side** (`reader-bridge.ts`, before
  `utteranceAt`): it would stop the Reading moving, but epub.js would still
  follow a link inside the page, which the app cannot stop from outside.
- **A second `followOnly`**, locking scroll as well: the owner kept dragging
  and lookup (design 0087).
