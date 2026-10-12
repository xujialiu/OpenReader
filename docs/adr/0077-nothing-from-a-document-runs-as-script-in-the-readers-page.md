---
status: accepted
---

# Nothing from a Document runs as script in the reader's page

Two defects from the whole-repository bug hunt of 2026-10-11 and 2026-10-12,
both `bug` and `severity: minor`. The owner kept them off the public tracker
until they were fixed, and on 2026-10-12 chose to fix them without an issue.
Every measurement below is in `notes/NOTES_2026-10-12.md`.

## What was wrong

**A Document's own script ran in the page and could post the page's messages.**
`@epubjs-react-native/core` 1.4.8 defaults `allowScriptedContent` to
`Platform.OS === 'ios'` (`lib/commonjs/Reader.js:30`), and neither `<Reader>`
passes it. epub.js then gives every section's frame
`sandbox="allow-same-origin allow-scripts"` and writes the section into it as
`srcdoc`. react-native-webview 13.16.1 hands a message to `onMessage` whichever
frame posted it, the library's `View.js` forwards any `type` that is not its own,
and the bridge acted on a message by its `type` alone. A script element, an
`<script src>` in the archive, an SVG `<script>`, an `img onerror`, a
`body onload`, a nested `iframe srcdoc` and a script placed before `<head>` each
posted `openreader:tap` from `about:srcdoc`, before the page's `onReady`. A
reported tap moves the Reading, a Blocks message replaces the text that is
spoken, and a problem becomes the Player's note.

**A place was spliced into script, twice.**

- The library's `goToLocation` injected ``rendition.display('${targetCfi}')``.
  An apostrophe ended the string. A Block whose CFI carries an id such as
  `Newton's_laws` came back at the start of the Document when its page was
  opened again after iOS ended the page's process (#120, ADR 0067), and
  whatever followed a quote in a Positions File locator ran in the page.
- epub.js 0.3's `EpubCFI.stepsToXpath` writes each id assertion as
  `@id='` + id + `'` and resolves the place with `document.evaluate`. With the
  first splice quoted and this one not, the same Block's display threw
  `SyntaxError: The string did not match the expected pattern.` inside
  `locationOf`. Its promise never settled, and the section's frame stayed
  `visibility: hidden`: a blank page instead of the start of the Document.

## Decision

1. **The page has a Content Security Policy, `script-src 'nonce-…'`, first in
   its head** (`patches/`, `template.js`). `useInjectWebviewVariables.js` draws a
   nonce for every page it writes, 32 characters from four `Math.random()` draws
   in base 36, and puts it on the page's own three scripts: JSZip, epub.js and the
   template's inline script. Each section's `about:srcdoc` frame inherits the
   policy, and no section script carries the nonce, because no Document can know
   it in advance. `allowScriptedContent` keeps the library's iOS default.
2. **`goToLocation` writes the place as `JSON.stringify(targetCfi)`**
   (`context.js`). This covers every caller: `initialLocation`, the bridge's
   `goTo`, `goToSection`, `browse` and its repaint after a page is opened again,
   and the load-request addresses `View.js` passes to it.
3. **epub.js writes an id assertion as an XPath literal** (`epubjs.js`). The id
   goes in single quotes when it contains no `'`, in double quotes when it
   contains no `"`, and otherwise as a `concat()` of the two. An id with no `'`
   is written exactly as before.
4. **The bridge takes a message from the page only whole.** `readWebViewMessage`
   (`src/renderer/messages.ts`) checks every field a type carries, so a Blocks
   message without `blocks` no longer throws out of `onWebViewMessage`, and a
   problem without a `detail` is dropped. Since only the app's own program can
   post now, this is robustness, not the boundary.

Measured in an offscreen `WKWebView` on macOS, with the patched library's own
page. Of the seven forms, none posted, and the reader's own tap on a word still
posted `openreader:tap`. A listener the page put on each section's document
still ran. Both sections reported their Blocks. With the patched epub.js, a
display of `epubcfi(/6/4!/4/2[Newton's_laws])` resolved, the section was visible,
and the heading landed where the same CFI without its id assertion lands.

## What was turned down

- **`allowScriptedContent: false`.** The Document's script stopped, and so did
  the reader: a listener the page puts on a section's document did not run, and a
  tap on a word posted nothing. The library's own note on the prop says the
  default exists on iOS because `addMark()` stops working without it.
- **Telling the page's messages from a Document's by frame or by a token.**
  `allow-same-origin` with `allow-scripts` puts a section's script in the page's
  origin. It can call the main frame's `ReactNativeWebView.postMessage` through
  `parent`, which reports the main frame, or read any token from the page's
  globals. Only stopping the script stops it.
- **A policy in each section's own head, from `book.spine.hooks.content`.**
  Measured: it stopped six forms, and not a script placed before `<head>`. The
  HTML parser that reads a `srcdoc` runs that script before it reaches the
  policy. A section whose root is not `<html>`, an SVG spine item, has no head to
  hold one. The page's policy covers every shape of section by inheritance, and
  it changes no section's markup.
- **Removing script elements from sections.** Removing one from `<body>` moves
  every later sibling's index, so CFIs stop matching the ones Zotero-OpenReader
  computes from the same file (ADR 0031), and a list of things to remove is never
  complete.
- **Removing id assertions from every CFI handed to epub.js** (`canonicalCfi`).
  It lands in the same place (measured), but epub.js re-displays its own
  `location.start.cfi` after a resize, and that CFI carries ids. Fixing the XPath
  covers that call too.
- **Refusing a Positions File locator that is not the id-free CFI ADR 0031
  writes.** Once the place is quoted it cannot run, and refusing would change
  which items a sync adopts. That is ADR 0031's question, not this one's.

## Consequences

- Script the app injects through the WebView is not subject to the policy:
  the program, `goToLocation`, the walkthrough harness's `js` probe, and
  react-native-webview's own user scripts (measured: the `ReactNativeWebView`
  shim and the program both ran). A string evaluated **inside** the page is
  subject to it. `eval` and `new Function` throw `EvalError: Refused to evaluate
  a string as JavaScript` (measured), so nothing on the page may use them. The
  global-object fallbacks in the bundled epub.js and JSZip never reach theirs,
  because `window` exists.
- The template's `<body oncopy='return false' oncut='return false'>` handlers no
  longer run. They guarded the page's own document, which holds no text. The
  book's text is in the sections' frames, whose copy events never reached them.
- The hidden reader that prepares a Download's chapters uses the same template,
  so it gets the same policy.
- `test/renderer/page-policy.test.ts` pins the page the patched library writes.
  `test/renderer/places-reach-the-page.test.ts` runs a place through the real
  `ReaderProvider` and the bundled epub.js's XPath writer.
  `test/renderer/reader-bridge-messages.test.ts` sends the bridge incomplete
  messages. That WebKit applies the inherited policy and that the reader's
  listeners still run cannot be shown under Node. The measurements are in the
  notes, and the check on the simulator is the tester's.
