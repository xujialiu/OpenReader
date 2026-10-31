---
status: accepted
---

# The Tap Lock is one flag in the page, read where a tap acts

_The product argument is
[design 0087](../design/0087-a-tap-on-the-page-can-be-locked.md). Issues #325
and #336._

## What was done

- **The reader's own state, for one visit (#336).** `ReadingView` holds it
  (`useState(false)`), switched by the Player's button and the harness's
  `taplock`; it is not in `AppSettings` and never written to disk. A
  `tapLock` left in a `settings.json` by a build before #336 is not read, and
  goes at the next write. See "The lock ends with the visit" below.
- **One message, sent again on install.** `TapLockMessage` (`{ kind: 'tapLock', on }`),
  sent by `ReaderBridge.setTapLock` when the value changes and again when the
  page program installs, as `followOnly` is, so a page opened again after its
  process ended (#120, ADR 0067) is locked too.
- **Two guards in the page program** (`highlighter.ts`), both reading one flag,
  `tapLock`:
  - `tapped()` asks it after the hit-test has found the Block the tap would
    read and before it posts the `TAP_MESSAGE`, and returns there (#336:
    first it returned before anything else, but then a locked tap on blank
    space could not be told from one the lock kept from reading). Nothing
    above it acts on the page.
  - `linkHeld()`, the capture-phase listener on each section document that
    #191 added for the collapsed Player, now also stops a link's click while
    locked: `preventDefault()` and `stopPropagation()` before epub.js's own
    `onclick` on the `a` can call `rendition.display`, and it does not hand the
    click to `tapped()` as it does for the collapsed Player.
- **Nothing else reads it.** `dragged()` (Browsing, #52, #71), the passive
  touch listeners and the selection listeners of Word Lookup are untouched, so
  a drag still browses and a long press still selects. The collapsed Player's
  `lockPage()` (no finger scroll) is a different thing and is unchanged.
- **The button** is in the Player's head row (`player.tsx`), right of A or M,
  `layout.sideWidth` wide (48 at the default size, the Sleep Timer's width, so
  the Voice name between the two sides stays centred; 44 once the name has a
  row of its own) and `layout.headEnd` tall. `lock` and `unlock` are new paths
  in the app's own icon set; the shut one is drawn in `useAccent().reading`.
  VoiceOver reads `Lock Taps` or `Unlock Taps`.

## The lock ends with the visit (#336)

The lock was a device setting and outlived the visit: closed one night, it was
still closed in another Document days later, where a tap on the words did
nothing. On the owner's iPhone (1.0.3 (24)-beta24-debug) a probe saw every tap
reach the section document as `touchstart`, `touchend` and `click` on a
paragraph, `caretPositionFromPoint` find its text node, and no `TAP_MESSAGE`
posted; the harness's `say` read `tapLock=true`, and nothing in the Debug Log
named the lock. What was done:

- **One visit is one `ReadingView` on screen.** `ReadingHost` renders the view
  keyed by the Document, so another Document and every launch mount a fresh
  one, whose lock starts off. Going Back does not always unmount it: a playing
  Reading keeps the view parked behind the navigator with `shown` false (#68,
  ADR 0049). So the view turns its lock off when `shown` goes false, beside
  closing its Drawers there (#214). Coming back with the Reading Button finds
  it off.
- **What leaves it on.** Locking the screen and the app going to the
  background change neither `shown` nor the view. A page that opens again
  after its process ended (#120, ADR 0067) is told the lock again by the
  bridge, as before.
- **The Debug Log.** `[reading] tap lock on` and `[reading] tap lock off`
  from the button, and `[reading] tap lock off: left the reader` when leaving
  turns it off; nothing when the Reader is left with the lock already off.
  That line has two writers. A parked view writes it from the effect on
  `shown`. Back with nothing playing, and another Document opened, end the
  view in the same commit as `left()` or `show()`, before that effect could
  run (found on the simulator: the paused Back wrote no line), so the view's
  unmount writes it when the lock was still on.
  In the page program a tap the lock kept from acting calls `lockedTap(what)`,
  a no-op in the plain program, which Debug Mode's `rendererLogSplice()`
  replaces (ADR 0054): `[renderer] a tap on block 6.25 did nothing: the Tap
  Lock is on`, or `a tap on a link did nothing`. A locked tap on blank space
  says nothing, since it would have read nothing either. A build without
  Debug Mode posts nothing new.
- **What it costs.** iOS ending the app in the background while nothing plays
  is a new launch, so the lock is off on coming back; the app has no way to
  tell that from the owner closing it without keeping the lock across
  launches, which is what this removed. A playing Reading keeps the app
  running (#75).

Tests: `test/app/held-reading-tap-lock.test.ts` over the real `ReadingHost`
and `ReadingView` (on and off, held while on screen, off after Back while
playing and while paused, off in another Document, the log lines);
`test/renderer/tap-lock.test.ts` for the Debug Mode lines over the stand-in
page; `test/renderer/rules.test.ts` pins the guard's place in `tapped()`.

## The Player became a card

The first version put the lock and the Sleep Timer in a row of their own
under the transport, and the open Player grew from 134 to 184 points at the
default text size on an iPhone 16 Pro. A second version drew the rows closer
and put that row on the bottom safe-area line (146 points); the owner then
pointed at Speechify's player, a card lifted clear of the home bar, so that
no control lies near it. What was done (`player-layout.ts`, `player.tsx`):

- **A card.** `cardWidth`: the window less `CARD_MARGIN` (12) a side, capped
  at `LAYOUT_WIDTH.player` (600), centred. `CARD_PADDING` 8 at the sides, 6 on
  top and 8 under the transport. Corners 24 at the top and 36 at the bottom,
  `borderCurve: 'continuous'`; a hairline border all round.
- **Lifted by `playerBottomGap`**: 20 points where the window has a bottom
  safe-area inset (a home bar), `CARD_MARGIN` where it has none. The band
  `onHeight` reports, and the open height the Line Position is measured above
  (`onOpenHeight`), include the gap: no sentence is held in it.
- **Two rows.** The head: A or M and the Tap Lock, the Voice name, the Sleep
  Timer and the collapse arrow, the two sides in `headSide` boxes of one
  width. The transport as before, its ends 52 points rather than 58 so it fits
  the 350 points inside the card on a 390-point phone (2 × 52 + 4 × 44 + 52
  plus six gaps of 3). In the split layout the name, and Contents with the
  speed, take rows of their own as before; the head keeps its four controls.
- **The head row keeps 44-point touch areas and takes 32 points** of the
  column (`headHeight`), by a negative vertical margin on the row, with 4
  points between rows: row centres 46 apart around the 52-point Play.
- **The countdown is drawn at most 1.5 times larger** (`SIDE_TEXT_SCALE`,
  `maxFontSizeMultiplier`), so `sideWidth` stops growing there and both sides
  of the head row fit at the largest text size on a 375-point phone.
- **The Voice name still wraps** rather than being cut short (#101); between
  the sides it has 158 points on a 390-point phone.
- At the default size on an iPhone 16 Pro the card is 102 points tall and
  stands 20 above the bottom: 122 points of the page.

## The geometry's facts

- **A `hitSlop` cannot reach past the parent's bounds** (React Native's own
  documentation for `Pressable`), and each control's parent is its row; a
  negative margin on the row lets the row's frame keep the touch area while
  Yoga counts only the drawn height.
- **The screen's corner, measured**, when the bottom row was still there. The
  iPhone 16 Pro device type's `framebufferMask` (Xcode 27's CoreSimulator
  profile), rendered and walked from the bottom edge: the curve is 70.3
  points tall, 12.3 points in at 25 points above the bottom and 19.3 at 17.
  The iPhone 16 Pro Max and 17 Pro have the same curve to a tenth of a point;
  the iPhone Air's is 76.8 points tall; a 16e's 53.0.
- **Apple's own corner buttons on the same phone** (iOS 27.0, measured from
  the accessibility tree): Safari's Back and Tabs are 48-point circles at
  34 points from the sides with their lower edge 34 points above the bottom;
  Files' tab bar buttons end 25 points above it. The bottom safe-area inset is
  34.
- **Speechify's card, measured from the owner's screenshot** (1206 pixels
  wide, an iPhone at 3×): 20 points in from each side, 115 points tall, its
  top corners about 22 points round and its bottom ones following the
  screen's own curve, about 40 points tall.
- **A SwiftUI host keeps the safe area.** With the bottom row on the inset's
  line, the Sleep Timer's `Host` lay 22 points inside the home indicator's
  safe area, and SwiftUI shrank the menu's label by that much (its frame read
  58 by 22 in the accessibility tree), drawing the moon 11 points above the
  lock. `ignoreSafeArea="container"` on that `Host` gave back 58 by 44; it is
  kept, though the card no longer reaches that area.

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
