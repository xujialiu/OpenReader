---
status: accepted
---

# A section is adopted through epub.js's content hook, not its `rendered` event

_Technical only: there is no design half. Issue #34._

**This corrects a cause given three times before** — on 2026-09-19
(`notes/NOTES_2026-09-19.md`), at 05:13 on 2026-09-20 and in ADR 0023 — that
epub.js's `rendered` "does not arrive for a view displayed this way". It did not
arrive for any view. The measurements in those places stand; the explanation
attached to them was wrong.

## The defect

With the dark theme, a fast fling could leave one chapter white with black text
in the middle of the dark reader, at the book's own size rather than the
owner's Font Size, with taps on it doing nothing, until something else moved the
page. The owner met it on "My Vampire System": the contents page dark, "Chapter
1: Just an old Book" below it white.

Reproduced on the iPhone 17 simulator (iOS 27.0), 2026-09-22, with
`test/manual-test/fixtures/scroll-fixture.ts` and `scroll-theme.cjs`: 150 animation
frames of 300 px each towards the start of the book left a displayed section
with no `#openreader-highlight` in **6 of 15** flings. In one such state, at
Font Size 20, the chapter beside it read `20px`, `rgb(17, 17, 20)` and
`rgb(230, 230, 234)`; the unstyled one `16px`, `rgb(255, 255, 255)` and
`rgb(0, 0, 0)`, and a click dispatched on one of its words posted no tap. It
held three stylesheets epub.js had injected itself, among them the library's
default white theme.

## What was measured

Everything the program does to a section's document is `sweep()` → `attach()` →
`adopt()`: install `#openreader-highlight` (theme, Appearance, `::highlight()`
rules), walk and report the Blocks, attach the tap listener. It ran as the
program installed, on each Clip cue, and on `rendered` and `relocated`.

**`rendered` never reached it.** The library's template registers its own
`rendered` listener before the program exists, and that listener is

```js
reactNativeWebview.postMessage(JSON.stringify({
  type: 'onRendered',
  section: section,
  currentSection: book.navigation.get(section.href),
}));
```

An epub.js Section is cyclic — its spine hooks are `Hook` objects whose
`context` is themselves — so, evaluated in the reader's WebView,
`JSON.stringify` of that object throws `TypeError: JSON.stringify cannot
serialize cyclic structures`. The bundled emitter dispatches with no `try`:

```js
for (r = r.slice(), e = 0; (n = r[e]); ++e) d.call(n, this, s);
```

so the dispatch ends at the library's listener, for every section. A probe's
counter registered after the program's counted **0** `rendered` events on every
view, styled or not, across 12 flings. With the library's listener wrapped in a
`try` at run time, the same counter read one per display, and the same fling
left a section unstyled in **0 of 15** runs against 6 of 15 without the wrap.

**`relocated` comes when a scroll stops, not when a section finishes
displaying.** After a fast fling epub.js's queue goes on destroying and
re-displaying sections. In one red run the unstyled section's last display
finished 106 ms after the fling's last frame and the last `relocated` came at
7 ms; in another, no `relocated` came at all after the fling. Nothing swept
after that, and a paused reader has no Clip cue.

**epub.js's content hook runs for every display, each hook in its own `try`.**
`Rendition.afterDisplayed` runs for the first display, an append, a prepend and a
re-display after a destroy, and triggers the content hooks before it would emit
`rendered`:

```js
? this.hooks.content.trigger(t.contents, this).then(() => {
    this.emit(l.c.RENDITION.RENDERED, t.section, t);
```

and `Hook.trigger` wraps each hook:

```js
try {
  var r = n.apply(e, t);
} catch (t) {
  console.log(t);
}
```

It is the chain the library's own theme reaches each document through, which is
why the unstyled chapter carried that theme and not the program's. It runs
before the view is shown: across three flings, a probe's own content hook found
the section's iframe at `visibility: hidden` on all 49 calls, and `show()` is
what makes it visible.

## The decision

`rendition.hooks.content.register(sweep)` where `rendition.on('rendered',
sweep)` was. The `rendered` subscription goes: it has never run, and keeping it
would say it does.

`relocated` stays. A trim removes a view without displaying anything, so the
hook does not hear it, and the `relocated` sweep is what keeps `onScreen` — the
resize recovery's target — current afterwards. The Clip-cue sweep and
`renderAhead`'s own sweep stay as second looks. Every sweep is idempotent per
document.

## Consequences

- A section is walked and reported each time epub.js displays it. During a fling
  a section displayed, destroyed and displayed again is walked each time — it
  was only when a sweep happened to find it — and the bridge drops a report
  whose text has not changed (`withSection`).
- `attach()`'s second half — rebuild the highlight and centre it when the
  rebuilt section holds the Utterance being read — now runs as the section is
  displayed rather than at the next scroll stop, and runs every time rather than
  when the `relocated` sweep happened to see the new document. Scrolling the
  highlighted sentence's section out of the manager's reach and back therefore
  re-centres it as the section comes back.
- The library's own `onRendered` message still never reaches React Native.
  Nothing in the app listens for it.

## Alternatives

- **Patch the template** (`patches/`, as for `contentMode`) so its listener
  posts a serialisable part of the Section. `rendered` would reach later
  listeners again, but the program's styling would depend on listener order in a
  template this project does not own, and the next listener that throws would
  bring the defect back. `rendered` also comes after the hook chain, and so after
  the view can be shown.
- **Sweep once epub.js's queue drains, or on a timer.** Polling, work on every
  tick, and still a window with the white chapter on screen.
- **Move the program's listener to the front.** Only through the emitter's
  private `__ee__` storage.

## Tested

`test/renderer/rules.test.ts`, "every section the page shows is adopted, however
fast it arrived": the program registers `sweep` on the content hook and not on
`rendered`, and the three library facts above are pinned in the installed
package, so a library change that removes one fails the suite. The behaviour is
the device's to show: `test/manual-test/scrolling-and-theme/scroll-theme.cjs`, red on 6 of 15 and
then 3 of 15 flings before the change, green on 0 of 15 twice after it, and on
0 of 6 towards the end of the book and 0 of 6 at 150 px a frame.
