/**
 * The WebView half: the highlighter, and the `requestAnimationFrame` loop.
 *
 * **Everything in the template literal below runs in Safari's JavaScript, not in
 * Hermes.** It is not type-checked, it cannot import anything, and nothing in the
 * type system says so — which is why `README.md` puts it in a file of its own and
 * why this file contains nothing else. Read it as a small program, not as part of
 * the app: `var`, no arrow functions, no template literals of its own, and every
 * name it touches is either its own or one the library's template already put on
 * `window` (`book`, `rendition`, `ePub`, `ReactNativeWebView`).
 *
 * It is installed **once**, through `injectJavascript`, and after that it is
 * called with one argument. ADR 0011: highlighting must not go through the
 * library's annotation API, whose `updateAnnotation` re-renders every view's
 * annotation pane and is a fresh string evaluation per call.
 *
 * ## What it owns
 *
 * - **The Blocks.** epub.js hands us a DOM (ADR 0011) and `core/` cannot see one,
 *   so the walk that turns a rendered section into Blocks lives here, along with
 *   the last step of `cursor.ts`'s coordinate chain: a code-unit offset into a
 *   Block's text is a text node and an offset into it.
 *
 *   **What is remembered across renders is text and a CFI, and nothing else.**
 *   epub.js replaces a section's document as the reader pages through it, so a
 *   remembered node, element or `Contents` is a reference into a document that may
 *   already have lost its browsing context — and `isConnected` does not say so,
 *   because a detached document still owns its nodes and they still report
 *   themselves connected to it. The text nodes are therefore resolved against the
 *   live document at paint time, cached per document rather than per Block, so the
 *   walk happens once when a section renders and never per word. A device run found
 *   the other way round: a correct `Range` built in a dead document, painting
 *   nothing, and every step looking right from the inside.
 * - **The clock between corrections.** One position correction arrives about once
 *   a second; `requestAnimationFrame` interpolates against a start time in
 *   between. Nothing crosses the bridge per word (ADR 0005).
 * - **The highlight.** `CSS.highlights` and `::highlight()` over `Range` objects:
 *   no markup change, no reflow. `::highlight()` arrived in Safari 17.2 and
 *   `app.config.ts` sets the deployment target to 17.2 for this reason (ADR 0001),
 *   so it is used unconditionally. **There is no capability check here and none is
 *   to be added.** A fallback would be a second implementation of the hardest part
 *   of the app, written to be worse — raising the floor deleted it rather than
 *   deferring it (ADR 0005).
 *
 * The one DOM mutation it makes is a `<style>` element per rendered section,
 * because a `::highlight()` rule has to live in the document it styles. That is
 * once per section, not once per word, and it changes no text.
 */

import type { HighlightMessage } from './messages';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, PROBLEM_MESSAGE } from './messages';

/** The two Highlight Levels of ADR 0005, as CSS custom highlight names. The word rides on top of the Utterance. */
export const UTTERANCE_HIGHLIGHT = 'ownreader-utterance';
export const WORD_HIGHLIGHT = 'ownreader-word';

/** The name the program installs itself under. Both halves have to agree on it, so it is written once. */
export const HIGHLIGHTER = '__ownReaderHighlighter';

/**
 * How the two levels are painted.
 *
 * CSS declarations, not an object, because `::highlight()` accepts only a handful
 * of properties — `color`, `background-color`, `text-decoration`, `text-shadow`,
 * `-webkit-text-stroke` — and a structured type would imply the rest work.
 */
export interface HighlightStyles {
  /** Declarations for `::highlight(ownreader-utterance)`: the sentence being read. */
  utterance: string;
  /** Declarations for `::highlight(ownreader-word)`: the word being spoken. Absent Word Timings, this is never painted. */
  word: string;
}

export const DEFAULT_HIGHLIGHT: HighlightStyles = {
  utterance: 'background-color: rgba(255, 196, 0, 0.22);',
  word: 'background-color: rgba(255, 168, 0, 0.62);',
};

/**
 * **`user-select: none` stops `::highlight()` painting, silently.** Measured on a
 * device, 2026-09-19, and written down nowhere else.
 *
 * `@epubjs-react-native/core`'s template calls `rendition.themes.default({ body:
 * { 'user-select': 'none', '-webkit-user-select': 'none', '-webkit-touch-callout':
 * 'none', … } })` whenever `enableSelection` is false — which is its default, and
 * the app's. WebKit paints a custom highlight through the same machinery it paints
 * a selection with, so text the document has declared unselectable gets no
 * highlight geometry and nothing is drawn.
 *
 * Nothing about it looks like a failure. `CSS.highlights` accepts the `Highlight`,
 * `::highlight()` parses into `cssRules`, the `Range` is over exactly the right
 * word, the registry reports the right size, and the page stays blank. The same
 * `Highlight` in a sibling iframe without the rule paints immediately; that pair of
 * screenshots is how this was found, after the DOM, the CFIs, the coordinate chain,
 * the multi-column layout and the iframe's sandbox had each been eliminated.
 *
 * So the highlighter declares the selectability its own highlight requires, with
 * `!important` because the library's declarations carry no weight of their own and
 * because this stylesheet is appended after them. `-webkit-touch-callout: none`
 * stays: it is the property that actually suppresses the iOS long-press menu, which
 * is what `enableSelection: false` was buying. What it does not restore is the
 * whole of that setting — text becomes selectable by long-press again — and that
 * is the right trade, because the highlight is why the app exists (ADR 0005) and
 * ADR 0001 raised the deployment floor to 17.2 to have it.
 */
const SELECTABLE =
  'html, body, body * {\n' +
  '  -webkit-user-select: text !important;\n' +
  '  user-select: text !important;\n' +
  '  -webkit-touch-callout: none !important;\n' +
  '}\n';

/** The stylesheet the program installs in each rendered section. The Utterance rule comes first so that the word, registered second, paints over it. */
export function highlightCss(styles: HighlightStyles): string {
  return (
    SELECTABLE +
    '::highlight(' + UTTERANCE_HIGHLIGHT + ') { ' + styles.utterance + ' }\n' +
    '::highlight(' + WORD_HIGHLIGHT + ') { ' + styles.word + ' }\n'
  );
}

/**
 * U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR.
 *
 * Written by code point rather than as characters or as escapes, so that this
 * file cannot contain one of the things it exists to remove.
 */
const JS_LINE_TERMINATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/**
 * One message, as JavaScript to evaluate.
 *
 * `U+2028` and `U+2029` are legal in a JSON string and are line terminators in
 * JavaScript, so a book containing either would end the statement halfway
 * through. `JSON.stringify` leaves them alone; this does not.
 */
export function highlightCall(message: HighlightMessage): string {
  const payload = JSON.stringify(message).replace(
    JS_LINE_TERMINATORS,
    (found) => '\\u' + found.charCodeAt(0).toString(16),
  );
  return 'window.' + HIGHLIGHTER + ' && window.' + HIGHLIGHTER + '(' + payload + '); true;';
}

/**
 * The program, ready for `injectJavascript`.
 *
 * Idempotent: injected twice, the second call does nothing, because
 * `@epubjs-react-native/core` injects `injectedJavascript` from its `onReady`
 * handler and a book that reports ready twice would otherwise get two loops.
 */
export function highlighterSource(styles: HighlightStyles = DEFAULT_HIGHLIGHT): string {
  const constants =
    'var WORD = ' + JSON.stringify(WORD_HIGHLIGHT) + ';\n' +
    'var UTTERANCE = ' + JSON.stringify(UTTERANCE_HIGHLIGHT) + ';\n' +
    'var BLOCKS = ' + JSON.stringify(BLOCKS_MESSAGE) + ';\n' +
    'var DOCUMENT = ' + JSON.stringify(DOCUMENT_MESSAGE) + ';\n' +
    'var PROBLEM = ' + JSON.stringify(PROBLEM_MESSAGE) + ';\n' +
    'var CSS_TEXT = ' + JSON.stringify(highlightCss(styles)) + ';\n' +
    'var STYLE_ID = "ownreader-highlight";\n';

  return `(function () {
  if (window.${HIGHLIGHTER}) return true;

${constants}
  function post(message) {
    var bridge = window.ReactNativeWebView;
    if (bridge && bridge.postMessage) bridge.postMessage(JSON.stringify(message));
  }

  /* Reported once per Utterance: a highlight that could not be drawn is worth
     saying out loud, and saying it sixty times a second is not. */
  function report(detail) {
    var utterance = state ? state.utterance : -1;
    if (state) {
      if (state.reported) return;
      state.reported = true;
    }
    post({ type: PROBLEM, utterance: utterance, detail: detail });
  }

  if (typeof rendition === 'undefined' || !rendition) {
    post({ type: PROBLEM, utterance: -1, detail: 'the highlighter was installed before epub.js had a rendition' });
    return true;
  }

  /* Block id -> { text, cfi, section }. **What survives a render, and nothing
     else.**

     epub.js replaces a section's document as the reader pages through it — that
     is what a paginated reader does — so a remembered text node, element or
     Contents is a reference into a document that may already have lost its
     browsing context. \`isConnected\` does not say so: a detached document still
     owns its nodes and they still report themselves connected to it. The question
     it cannot answer is \`ownerDocument.defaultView\`, and the answer to *that*
     was how this file once built a correct Range in a dead document and painted
     nothing while looking right from the inside.

     So the durable record is text and a CFI — which is what ADR 0008 already
     committed this project to as the thing that identifies a place — and the DOM
     is resolved against the live document at paint time. */
  var blocks = new Map();
  /* The other half: document -> (Block id -> the walked Block, with the text nodes
     its offsets index into). Keyed by the document, so a document epub.js has
     replaced is simply not in here and the next paint walks the live one instead
     of trusting a dead one. Walked once per document, not once per word. */
  var maps = new WeakMap();
  /* Spine index -> the ids it contributed, so re-rendering a section replaces
     its Blocks instead of accumulating them. */
  var bySection = new Map();
  /* The document the two highlights are registered in, so they can be taken out
     of it when the reading moves to another section. */
  var installed = null;
  var registries = new WeakMap();
  var state = null;
  var frame = 0;

  /* ---- the walk: a rendered section as Blocks ---- */

  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1, LINK: 1, META: 1, TITLE: 1, RT: 1, RP: 1 };
  var HEADING = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1 };
  var PARAGRAPH = { P: 1, LI: 1, DD: 1, DT: 1, BLOCKQUOTE: 1, DIV: 1, TD: 1, TH: 1, PRE: 1, FIGCAPTION: 1 };
  /* A <br> is a line inside a Block, not a Block boundary: verse marked up with
     <br> is one unit, verse marked up a line to a <p> is not, and rejoin.ts is
     what puts the second kind back together. */
  var INLINE = { BR: 1, WBR: 1 };

  function roleOf(element) {
    var tag = element && element.tagName ? element.tagName.toUpperCase() : '';
    if (HEADING[tag]) return 'heading';
    if (PARAGRAPH[tag]) return 'paragraph';
    return 'other';
  }

  function walk(contents) {
    var win = contents.window;
    var found = [];
    var open = null;

    function close() {
      if (open && /\\S/.test(open.text)) found.push(open);
      open = null;
    }

    function visit(node, owner) {
      if (node.nodeType === 3) {
        if (!node.data.length) return;
        if (!open) open = { element: owner, text: '', parts: [] };
        open.parts.push({ node: node, at: open.text.length, len: node.data.length });
        /* Verbatim. Collapsing the source file's whitespace would break the one
           mapping that must not drift: an offset into this text is walked back
           into these very nodes. A Provider speaks the newlines without noticing. */
        open.text += node.data;
        return;
      }
      if (node.nodeType !== 1) return;
      var tag = node.tagName ? node.tagName.toUpperCase() : '';
      if (SKIP[tag]) return;
      var display = INLINE[tag] ? 'inline' : String(win.getComputedStyle(node).display || '');
      if (display === 'none') return;
      /* What a Block is, the document decides — CONTEXT.md says "a run of text the
         document itself presents as one unit", and that is \`display\`, not a tag
         allowlist: an EPUB is as likely to lay its paragraphs out in <div>s as in
         <p>s and only its own stylesheet knows. Anything that computes to nothing
         is treated as a Block, because welding two Blocks the document presents
         apart is a lie about the document (rejoin.ts) while splitting one is only
         a pause in the wrong place. */
      var inline =
        display.lastIndexOf('inline', 0) === 0 ||
        display === 'contents' ||
        display.lastIndexOf('ruby', 0) === 0;
      var children = node.childNodes;
      var i;
      if (inline) {
        for (i = 0; i < children.length; i++) visit(children[i], owner);
        return;
      }
      close();
      for (i = 0; i < children.length; i++) visit(children[i], node);
      close();
    }

    var body = contents.document.body;
    if (body) visit(body, body);
    close();
    return found;
  }

  function ensureStyle(doc) {
    /* The one DOM mutation this file makes, once per document, because a
       ::highlight() rule has to live in the document it styles. */
    if (doc.getElementById(STYLE_ID)) return;
    var style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_TEXT;
    (doc.head || doc.documentElement).appendChild(style);
  }

  /* ---- what a document holds, resolved once per document ---- */

  /* Walk a live document, record what survives of each Block and tell the React
     Native side about them. Idempotent per document: a document already in \`maps\`
     has nothing new in it, and a re-render is a *different* document. */
  function adopt(contents) {
    if (maps.has(contents.document)) return;
    ensureStyle(contents.document);

    var index = contents.sectionIndex;
    var section = null;
    try {
      section = book.spine.get(index);
    } catch (error) {
      section = null;
    }
    var href = section && section.href ? section.href : String(index);

    var previous = bySection.get(index);
    var i;
    if (previous) for (i = 0; i < previous.length; i++) blocks.delete(previous[i]);

    var found = walk(contents);
    var map = new Map();
    var ids = [];
    var reported = [];
    for (i = 0; i < found.length; i++) {
      var id = index + '.' + i;
      var cfi = '';
      try {
        /* The element, never a text node: ADR 0008 records that Zotero's CFI
           generator and resolver disagree about text steps, which is why the
           desktop plugin never generates a CFI of its own. An element step is the
           part of the dialect both sides agree on. */
        cfi = contents.cfiFromNode(found[i].element);
      } catch (error) {
        cfi = '';
      }
      /* The durable half: text, CFI, section. No node, no element, no Contents. */
      blocks.set(id, { text: found[i].text, cfi: cfi, section: index });
      /* The perishable half, under this document's own key. */
      map.set(id, found[i]);
      ids.push(id);
      reported.push({
        id: id,
        text: found[i].text,
        role: roleOf(found[i].element),
        section: href,
        sectionIndex: index,
        cfi: cfi
      });
    }
    maps.set(contents.document, map);
    bySection.set(index, ids);
    post({ type: BLOCKS, sectionIndex: index, section: href, blocks: reported });
  }

  /* The rendered Contents for a section, or null — which is the ordinary "the
     reading ran ahead of the page" case. */
  function liveContents(section) {
    var list = rendition.getContents();
    for (var i = 0; i < list.length; i++) {
      var contents = list[i];
      if (!contents || contents.sectionIndex !== section) continue;
      /* The question \`isConnected\` cannot answer. A document epub.js has replaced
         still owns its nodes and they still report themselves connected to it;
         what it has lost is its browsing context. */
      if (!contents.document || !contents.document.defaultView) continue;
      adopt(contents);
      return contents;
    }
    return null;
  }

  /* A Block as it exists **now**: the live document's own text nodes for it, and
     the live text they hold. Resolved on every paint rather than remembered, which
     is what makes the question "is this document still alive" stop existing. */
  function liveBlock(id) {
    var record = blocks.get(id);
    if (!record) return null;
    var contents = liveContents(record.section);
    if (!contents) return null;
    var map = maps.get(contents.document);
    var found = map ? map.get(id) : null;
    if (!found) return null;
    return { document: contents.document, parts: found.parts, text: found.text };
  }

  /* ---- the highlights ---- */

  function registryFor(win) {
    var found = registries.get(win.document);
    if (found) return found;
    /* Belt and braces, and cheap: a highlight registered in a document with no
       ::highlight() rule in it paints nothing and reports nothing. */
    ensureStyle(win.document);
    /* Registration order is paint order for overlapping custom highlights, so the
       Utterance goes in first and the word paints over it. Both objects are made
       once and then mutated: a delete followed by a set would move the word to the
       back of the registry and the sentence would paint over the word. */
    var utterance = new win.Highlight();
    var word = new win.Highlight();
    win.CSS.highlights.set(UTTERANCE, utterance);
    win.CSS.highlights.set(WORD, word);
    word.priority = 1;
    found = { utterance: utterance, word: word };
    registries.set(win.document, found);
    return found;
  }

  function put(highlight, ranges) {
    highlight.clear();
    for (var i = 0; i < ranges.length; i++) highlight.add(ranges[i]);
  }

  function moveTo(registry) {
    if (installed && installed !== registry) {
      put(installed.utterance, []);
      put(installed.word, []);
    }
    installed = registry;
  }

  function clearHighlights() {
    if (!installed) return;
    put(installed.utterance, []);
    put(installed.word, []);
  }

  function partAt(live, offset, atEnd) {
    var parts = live.parts;
    for (var i = 0; i < parts.length; i++) {
      var from = parts[i].at;
      var to = from + parts[i].len;
      if (atEnd ? offset > from && offset <= to : offset >= from && offset < to) return parts[i];
    }
    return null;
  }

  function domRange(range) {
    /* Resolved against the live document, every time. There is no stale-node check
       here because there is nothing stale to check: these nodes were found in a
       document that had a browsing context a moment ago. */
    var live = liveBlock(range.block);
    if (!live) return null;
    var from = partAt(live, range.start, false);
    var to = partAt(live, range.end, true);
    if (!from || !to) return null;
    var dom = live.document.createRange();
    dom.setStart(from.node, range.start - from.at);
    dom.setEnd(to.node, range.end - to.at);
    return dom;
  }

  function build(ranges) {
    var built = [];
    var doc = null;
    for (var i = 0; i < ranges.length; i++) {
      var dom = domRange(ranges[i]);
      if (!dom) return null;
      var owner = dom.startContainer.ownerDocument;
      /* An Utterance never crosses a section — rejoin.ts refuses to join two
         Blocks from different ones — so one Utterance is one document. */
      if (doc && owner !== doc) return null;
      doc = owner;
      built.push(dom);
    }
    if (!built.length || !doc || !doc.defaultView) return null;
    return { ranges: built, window: doc.defaultView };
  }

  /* ADR 0008: text is the arbiter of whether a locator is correct. The text
     compared here is the **live** document's, walked a moment ago; the text in the
     message came out of the Utterance that was segmented from it. They disagree
     only when the two sides are looking at different documents, and then a
     highlight would land somewhere plausible and wrong. */
  function mismatch(ranges) {
    for (var i = 0; i < ranges.length; i++) {
      var live = liveBlock(ranges[i].block);
      if (!live) continue;
      if (live.text.slice(ranges[i].start, ranges[i].end) !== ranges[i].text) {
        return 'Block ' + ranges[i].block + ' does not hold the text that was sent for it';
      }
    }
    return null;
  }

  /* Why a highlight could not be drawn, in words fit for a status bar.
     Silence here is what let a Range built in a dead document look correct from
     the inside while painting nothing — it took a device run to find, because the
     one step in the chain that failed was the one that said nothing. */
  function why(ranges) {
    for (var i = 0; i < ranges.length; i++) {
      var id = ranges[i].block;
      var record = blocks.get(id);
      if (!record) return 'Block ' + id + ' has not been reported: no rendered section holds it';
      if (!liveContents(record.section)) {
        return 'Block ' + id + ' is in section ' + record.section + ', which is not on the page';
      }
      if (!liveBlock(id)) return 'Block ' + id + ' was not found in the rendered section';
    }
    return 'the Utterance covers no Block';
  }

  function showUtterance() {
    var built = build(state.utteranceRanges);
    if (!built) {
      clearHighlights();
      /* Reported, not swallowed. Philosophy rule 1, and the reason the problem
         message exists: once per Utterance, so a reading that is ahead of the page
         says so once rather than sixty times a second. */
      report(why(state.utteranceRanges));
      return false;
    }
    var registry = registryFor(built.window);
    moveTo(registry);
    put(registry.utterance, built.ranges);
    put(registry.word, []);
    return true;
  }

  function showWord(ranges) {
    var built = build(ranges);
    if (!built) {
      report(why(ranges));
      return;
    }
    var registry = registryFor(built.window);
    moveTo(registry);
    put(registry.word, built.ranges);
  }

  /* The word the highlight belongs on, walking back over any whose range list is
     empty — a word can fall entirely on the space rejoin.ts inserted between two
     Blocks, which is in the Utterance and in no Block. */
  function showAt(index) {
    if (!state || !state.words) return;
    var at = index < state.words.length ? index : state.words.length - 1;
    for (; at >= 0; at--) {
      if (state.words[at].ranges.length) {
        showWord(state.words[at].ranges);
        return;
      }
    }
    if (index < 0 && installed) put(installed.word, []);
  }

  /* ---- the loop ---- */

  function start() {
    if (frame || !state || state.held || !state.words) return;
    if (state.next >= state.words.length) return;
    frame = window.requestAnimationFrame(tick);
  }

  function stop() {
    if (!frame) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
  }

  function tick(now) {
    frame = 0;
    if (!state || state.held || !state.words) return;
    var words = state.words;
    /* Clamped to the speech's own length: the gap that follows belongs to the
       pause, and the highlight belongs on the words. */
    var elapsed = Math.min(Math.max(0, now - state.epoch), state.durationMs);
    /* The same forward scan as cursor.ts's wordIndexAt, which is what the
       once-a-second correction is computed with, so a frame and a correction
       cannot disagree about which word is current. */
    while (state.next < words.length && words[state.next].atMs <= elapsed) {
      var word = words[state.next];
      state.next++;
      if (word.ranges.length) showWord(word.ranges);
    }
    /* The loop exists to schedule the next word, so it stops when there is none.
       Nothing here re-renders anything and no frame is spent on a Clip that has
       finished speaking. */
    if (state.next < words.length) frame = window.requestAnimationFrame(tick);
  }

  /* ---- bringing the reading into view (ADR 0005) ---- */

  function reveal(range) {
    var record = blocks.get(range.block);
    if (!record || !record.cfi) return;
    try {
      var here = rendition.currentLocation();
      if (here && here.start && here.end) {
        var compare = ePub.CFI.prototype.compare;
        if (compare(record.cfi, here.start.cfi) >= 0 && compare(record.cfi, here.end.cfi) <= 0) return;
      }
      /* epub.js's own dialect, and its own resolver (ADR 0011). Paginating lands
         on the Block, not on the word: a Block longer than a page is revealed at
         its start, which is never the wrong place, only a coarse one. */
      rendition.display(record.cfi);
    } catch (error) {
      report('could not bring the Block into view: ' + error);
    }
  }

  /* ---- a section arriving, or arriving again ---- */

  /* Whether the Utterance being read lives in this section. Asked so that a
     section rendering while the reading is elsewhere neither re-installs nor
     reports: that is the reader turning a page, not a problem. */
  function covers(section, ranges) {
    for (var i = 0; i < ranges.length; i++) {
      var record = blocks.get(ranges[i].block);
      if (record && record.section === section) return true;
    }
    return false;
  }

  function attach(contents) {
    if (!contents || !contents.document || !contents.document.defaultView) return;
    var known = maps.has(contents.document);
    adopt(contents);
    if (known) return;

    /* The section that just rendered may be the one being read: its document is
       new, so the highlight has to be built against it. Never revealed from here —
       a reveal that caused this render would reveal for ever. */
    if (state && covers(contents.sectionIndex, state.utteranceRanges) && showUtterance()) {
      showAt(state.next - 1);
      start();
    }
  }

  function sweep() {
    var list = rendition.getContents();
    for (var i = 0; i < list.length; i++) {
      /* A throw here would come out inside epub.js's own event emitter and take
         the rest of its listeners with it. Reported instead — which is not a
         capability check and not a fallback: there is no second way to draw a
         highlight, only a way to say that this one could not be drawn. */
      try {
        attach(list[i]);
      } catch (error) {
        report('could not read the rendered section: ' + error);
      }
    }
  }

  rendition.on('rendered', sweep);
  /* And again whenever the reading position moves. A section can be on the page
     without this program having seen a 'rendered' event for it — the event fires
     from inside epub.js's own hook chain, and a display() that replaces the view
     can resolve without it reaching a listener registered later. Sweeping on the
     move as well makes the invariant the one that matters: what is on the page
     has been reported. Both are idempotent per document, so the second sweep
     costs one lookup per rendered view. */
  rendition.on('relocated', sweep);
  /* The shape of the document, once and before any section reports, so the app
     never has to act on a section without knowing whether another follows it.
     The spine's length is set by the unpack that a rendition cannot exist
     without, so by here it is a number. */
  post({ type: DOCUMENT, spine: book.spine.length });
  /* Installed from the library's onReady, which fires after rendition.display()
     resolved — so the first section has already rendered and its 'rendered' event
     has already been and gone. */
  sweep();

  /* ---- the one entry point ---- */

  function dispatch(message) {
    if (message.kind === 'clear') {
      stop();
      state = null;
      clearHighlights();
      return;
    }
    if (message.kind === 'hold') {
      stop();
      if (state) state.held = true;
      return;
    }
    if (message.kind === 'speak') {
      stop();
      state = {
        utterance: message.utterance,
        utteranceRanges: message.utteranceRanges,
        words: message.words,
        durationMs: message.durationMs,
        epoch: window.performance.now(),
        next: 0,
        held: false,
        reported: false
      };
      var wrong = mismatch(message.utteranceRanges);
      if (wrong) {
        report(wrong);
        state = null;
        clearHighlights();
        return;
      }
      /* Whether or not the section is on screen, the state is kept: attach()
         installs the highlight when epub.js renders it. And the reveal is
         attempted either way — a Block whose iframe epub.js has destroyed still
         has its CFI here, and that is exactly the case where the reading has
         crossed into text the reader cannot see. */
      var shown = showUtterance();
      if (message.reveal) reveal(message.utteranceRanges[0]);
      if (!shown) return;
      start();
      return;
    }
    if (message.kind === 'correct') {
      /* A correction for an Utterance we are not showing means a cue was missed.
         The engine re-cues before correcting, so this one is stale. */
      if (!state || state.utterance !== message.utterance) return;
      /* The correction is authoritative: the epoch and the word both come from it
         rather than from what the loop had reached on its own. This is the whole
         of the drift correction, once a second (ADR 0005). */
      state.epoch = window.performance.now() - message.elapsedMs;
      state.held = message.hold;
      state.next = message.word + 1;
      showAt(message.word);
      if (message.hold) stop();
      else start();
    }
  }

  window.${HIGHLIGHTER} = function (message) {
    if (!message) return;
    /* Every message is an eval of its own, so an uncaught throw here is lost —
       no stack reaches Hermes and nothing on the React Native side notices. It is
       reported instead. This is the project's "report, never hang" and not a
       capability check: it branches on nothing and offers no second way to
       highlight. */
    try {
      dispatch(message);
    } catch (error) {
      report('could not draw the highlight: ' + error);
    }
  };

  return true;
})();
true;
`;
}
