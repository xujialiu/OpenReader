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
