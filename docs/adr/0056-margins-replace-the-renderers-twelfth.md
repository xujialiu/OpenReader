---
status: accepted
---

# The Margins replace the renderer's twelfth with one body rule in the Appearance stylesheet

_The product argument is [design 0056](../design/0056-the-space-at-the-sides-of-the-page-is-yours.md).
Issue #84. It adds a fourth part to the stylesheet [ADR 0021](0021-appearance-is-one-stylesheet-the-page-already-has.md)
installs; the message, the one `<style>` element and the re-centre stand, and ADR
0030's size rule, ADR 0029's font list and ADR 0034's alignment rule are unchanged._

## Where the side space came from

Not from the Documents. epub.js's `Contents.size(width, height)`, which the
continuous manager calls for every section in `scrolled-continuous` flow (ADR
0011), writes three inline styles on the section's `body`:

```js
this.css("padding", "0 " + width / 12 + "px");
this.css("margin", "0");
this.css("box-sizing", "border-box");
```

(the vendored `epubjs.js` of `@epubjs-react-native/core` 1.4.8, line 3907). On a
402-point iPhone that is 33.5 points a side. `this.css` sets the property without
a priority, and the `margin: 0` already overrides a Document's own `body`
margin unless the Document declares it `!important`.

## The setting

`Appearance.margins` is a `Margin`, one of `MARGINS = [8, 12, …, 48]` (steps of
4), and `DEFAULT_APPEARANCE.margins` is 16 (24 since 2026-10-01, at the owner's
word; a saved value on the ladder is kept). `stepMargins` moves one step and
answers null at either end, which the drawer shows as a disabled button, the
same shape as `FONT_SIZES` and `stepFontSize`. It is per app like the rest of
Appearance, stored in `settings.json`, and not synced. `settings-storage.ts`'s
`readMargins` reads a missing or unknown value as the default (then 16), so a file written before
#84 reads the way a new install starts; nothing is migrated, because the app
has not been released.

## The rule

`appearanceCss` appends one line after the alignment rule:

```css
body { margin-left: 0 !important; margin-right: 0 !important; padding-left: 16px !important; padding-right: 16px !important; }
```

- **`!important` in the stylesheet beats the inline style.** An inline
  declaration without `!important` loses to an author `!important` declaration,
  so the owner's padding replaces epub.js's twelfth without touching epub.js.
  `box-sizing: border-box` stays, so the body is still exactly the view's width
  and the padding comes out of the text's width, as the twelfth did.
- **The side margins go to 0 as well**, for the Document that declares its own
  `body` margin `!important`: with only the padding, its margin would add to the
  owner's. The later of two `!important` author rules of equal specificity wins,
  and this stylesheet is appended to the section's `head` after the Document's
  own (ADR 0021).
- **The body and nothing inside it.** A `blockquote`, a list or a wrapper `div`
  that indents itself keeps its indent on top of the owner's Margins.
- **The number comes from the ladder.** `MARGINS.find` of the setting, or the
  default, so a settings file cannot put anything but one of eleven numbers into
  the rule. `test/renderer/appearance.test.ts` runs every combination the drawer
  can produce and asserts that each line is a size, a font, one of the two
  alignment rules or one of the eleven Margins rules, and that none declares
  `user-select`.

A change arrives as the ordinary `appearance` message, which restyles every
rendered section and re-centres the line being spoken (ADR 0021), as a Font
Size change does. epub.js measures the new section heights itself: the body's
height changes, as it does for a font change.

## Alternatives

- **Patch `Contents.size()`.** It would change only the renderer's own padding
  and still leave a Document's `!important` body margin, and every patch to the
  vendored bundle is carried by hand (`patches/`).
- **A share of the width, as the twelfth is.** Turned down by the owner for
  points, which are the same distance on every screen (design 0056).
- **Padding on the scroll container rather than the body.** It changes the size
  the continuous manager measures, which ADR 0048 already avoids for the bar
  (the room above the document is a pseudo-element for that reason).
