import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BLOCKS_MESSAGE, PROBLEM_MESSAGE, TAP_MESSAGE } from '../../src/renderer/messages';
import {
  appearanceCss,
  DEFAULT_APPEARANCE,
  DEFAULT_HIGHLIGHT,
  HIGHLIGHTER,
  highlightCall,
  highlightCss,
  highlighterSource,
  themeCss,
  UTTERANCE_HIGHLIGHT,
  WORD_HIGHLIGHT,
} from '../../src/renderer/highlighter';
import { pin, pinCount } from '../structural';

/**
 * The three things ADR 0005 says this directory must never do, checked against the
 * source text — and the facts about `@epubjs-react-native/core` the bridge depends
 * on, checked against the installed package.
 *
 * ADR 0011 puts half of this directory inside Safari's JavaScript, which no Node
 * test environment simulates (test/README.md), so the loop, the `Range` building
 * and the `::highlight()` painting are **not tested here and will not be**. A DOM
 * mock would prove the mock was called. What a suite that cannot open a WebView can
 * still do is the same thing `test/playback/footguns.test.ts` does for the playback
 * library: read the lines that obey each rule, and fail when one of them goes.
 *
 * Each rule rules out the obvious implementation, and each would fail as something
 * else — a dropped frame, a highlight a word behind, a fallback path nobody meant
 * to write. None of them throws.
 */

const directory = new URL('../../src/renderer/', import.meta.url).pathname;

const sources = new Map<string, string>(
  readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, readFileSync(directory + name, 'utf8')]),
);

/**
 * The code, without the comments.
 *
 * Needed because this directory explains each rule where it obeys it, so
 * `updateAnnotation`, `useState` and "capability check" all appear in prose beside
 * the lines that avoid them. A naive search would find the explanation and call it
 * the offence.
 */
function code(name: string): string {
  const text = sources.get(name);
  if (text === undefined) throw new Error('src/renderer/' + name + ' does not exist');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const everyFile = (): string[] => [...sources.keys()];
const allCode = (): string => everyFile().map(code).join('\n');

/**
 * One function of the WebView program, from its `function` keyword to the next
 * one at the same indentation.
 *
 * Crude, and it only has to hold for one file that is written in one style — but
 * it is what lets a rule be asserted about *where* something happens rather than
 * only about whether it appears, which is the difference between "the program
 * scrolls" and "the program scrolls once per Utterance".
 */
function fn(program: string, name: string): string {
  const from = program.indexOf('function ' + name + '(');
  if (from < 0) throw new Error('highlighter.ts has no function ' + name);
  const next = program.indexOf('\n  function ', from + 1);
  return next < 0 ? program.slice(from) : program.slice(from, next);
}

/** The library's own source, read rather than trusted: every fact below was read out of it and none of it is documented. */
const library = (path: string): string =>
  readFileSync(new URL('../../node_modules/@epubjs-react-native/core/lib/commonjs/' + path, import.meta.url).pathname, 'utf8');

describe('the comment stripper this file relies on', () => {
  // First, so that a stripper that ate the whole file reports itself as that rather
  // than as three rules mysteriously obeyed.
  it('keeps code and removes prose', () => {
    expect(code('reader-bridge.ts')).toContain('useReaderBridge');
    // The words appear only in the comments explaining why they are never used.
    expect(sources.get('reader-bridge.ts')).toContain('updateAnnotation');
    expect(sources.get('reader-bridge.ts')).toContain('useState');
    expect(code('reader-bridge.ts')).not.toContain('updateAnnotation');
  });
});

describe('never send a position update per word across the bridge (ADR 0005)', () => {
  it('has one place that injects, and it injects one message', () => {
    // `postMessage` into a WebView is a script injection and an `eval` per message.
    // One funnel means there is one thing to read to know what crosses the bridge.
    expect(code('reader-bridge.ts').match(/injectJavascript\(/g)).toHaveLength(1);
    expect(code('reader-bridge.ts')).toContain('injectJavascript(highlightCall(message))');
  });

  it('has nothing on the React Native side that could fire per word', () => {
    // No clock of its own and no loop: the only things that call into the WebView
    // are the two `ReaderClock` methods and the two commands, each once per call.
    const bridge = code('reader-bridge.ts');
    for (const forbidden of ['requestAnimationFrame', 'setInterval', 'setTimeout', 'forEach', 'for (', 'while (']) {
      expect(bridge).not.toContain(forbidden);
    }
  });

  it('interpolates inside the WebView instead, against a start time', () => {
    // The whole Word Timing array goes over once; `requestAnimationFrame` fills in
    // between corrections. That is where the three-to-five-words-a-second live.
    //
    // Two calls, scoped to the two functions that make them, because a search of
    // the program finds four `requestAnimationFrame`s and `window.requestAnimationFrame(tick)`
    // twice — and the two fail differently: without the first the loop never
    // starts and the highlight moves only on the once-a-second correction;
    // without the second it runs for exactly one frame.
    const program = code('highlighter.ts');
    pin(fn(program, 'start'), 'frame = window.requestAnimationFrame(tick);', 'highlighter.ts, function start');
    pin(
      fn(program, 'tick'),
      'if (state.next < words.length) frame = window.requestAnimationFrame(tick);',
      'highlighter.ts, function tick',
    );
  });

  it('agrees with cursor.ts about which word is current, by running the same scan', () => {
    // A binary search in one and a forward scan in the other would disagree on any
    // Word Timing array a Provider did not report in order — visibly, once a second.
    expect(code('cursor.ts')).toContain('while (index + 1 < words.length && words[index + 1].atMs <= elapsedMs)');
    expect(highlighterSource()).toContain('while (state.next < words.length && words[state.next].atMs <= elapsed)');
  });
});

describe('the page follows the voice, once per Utterance (ADR 0011)', () => {
  it('mounts the reader in the layout the highlight was proved under', () => {
    // The highlighter was re-proved on a device under *this* layout, and both
    // findings behind it were re-measured there. Changing either of these two
    // values does not break anything visible — it silently moves the code back
    // to a layout nothing has been measured in since, which is the state ADR 0011
    // describes as the evidence not carrying over.
    // Twice each, and deliberately: the declared type and the value it is given.
    // A search for the literal alone passes while the value is changed, because
    // the type still names it — which is what the first version of this test did.
    const bridge = code('reader-bridge.ts');
    for (const spelling of ["flow: 'scrolled-continuous'", "manager: 'continuous'"]) {
      expect({ spelling, declared: bridge.includes(spelling + ';'), given: bridge.includes(spelling + ',') }).toEqual({
        spelling,
        declared: true,
        given: true,
      });
    }
  });

  it('scrolls in one place, and it is the Clip cue that reaches it', () => {
    // ADR 0005 keeps the frame path off the bridge; this keeps it off the page.
    // A scroll from `tick` would run at `requestAnimationFrame` rate, and each one
    // costs the continuous manager a pass over its views — it would fail as a
    // reader that stutters, not as an error.
    const program = code('highlighter.ts');
    expect(program.match(/scrollBy\(/g)).toHaveLength(1);
    expect(fn(program, 'centre')).toContain('rendition.manager.scrollBy(0, move, false)');
    for (const perWord of ['tick', 'showWord', 'showAt', 'start']) {
      expect({ perWord, scrolls: /centre|scrollBy/.test(fn(program, perWord)) }).toEqual({ perWord, scrolls: false });
    }
  });

  it('does not scroll on the once-a-second correction either', () => {
    // The correction is the second and last thing the bridge sends (ADR 0005). It
    // moves the highlight inside an Utterance that is already centred; scrolling
    // from it would drag the page under the reader once a second.
    const program = code('highlighter.ts');
    const correction = program.slice(program.indexOf("message.kind === 'correct'"));
    expect(correction).not.toMatch(/centre|scrollBy|follow\(/);
  });

  it('centres at most once per document per Utterance', () => {
    // A centring can make the continuous manager render a section, which reaches
    // `attach`, which would centre again, which would render again. The WeakSet is
    // what ends that, and it is weak because the alternative is the renderer
    // holding a document epub.js means to destroy.
    const program = code('highlighter.ts');
    expect(program).toContain('centred: new WeakSet()');
    expect(fn(program, 'centreOnce')).toContain('if (state.centred.has(doc)) return;');
  });
});

describe('never put playback position in React state (ADR 0005)', () => {
  it('has no React state at all', () => {
    for (const hook of ['useState', 'useReducer', 'useSyncExternalStore']) {
      expect(allCode()).not.toContain(hook);
    }
  });

  it('keeps everything the clock touches in a ref', () => {
    const bridge = code('reader-bridge.ts');
    for (const held of ['utterances = useRef', 'ids = useRef', 'blocks = useRef', 'cued = useRef']) {
      expect(bridge).toContain(held);
    }
  });
});

describe('never highlight by mutating the DOM, and never check whether you can (ADR 0005, 0001)', () => {
  it('uses the CSS Custom Highlight API, for the sentence and for the word', () => {
    // Two `Highlight` objects, two registrations and two rules — and each pair is
    // the sentence and the word, so a whole-file search for any of the three
    // spellings is answered by whichever half survives. Losing the word half is
    // losing what ADR 0005 says the app exists for, and it paints nothing rather
    // than reporting anything.
    const registry = fn(code('highlighter.ts'), 'registryFor');
    pin(registry, 'var utterance = new win.Highlight();', 'highlighter.ts, function registryFor');
    pin(registry, 'var word = new win.Highlight();', 'highlighter.ts, function registryFor');
    pin(registry, 'win.CSS.highlights.set(UTTERANCE, utterance);', 'highlighter.ts, function registryFor');
    pin(registry, 'win.CSS.highlights.set(WORD, word);', 'highlighter.ts, function registryFor');

    // And the rules those two names paint through. The stylesheet is built on this
    // side of the bridge, so the argument is a value a test can read.
    const css = highlightCss(DEFAULT_HIGHLIGHT);
    pin(css, '::highlight(' + UTTERANCE_HIGHLIGHT + ') {', 'the stylesheet highlightCss builds');
    pin(css, '::highlight(' + WORD_HIGHLIGHT + ') {', 'the stylesheet highlightCss builds');
  });

  it('has no capability check and no fallback around it', () => {
    // `::highlight()` arrived in Safari 17.2 and ADR 0001 raised the deployment
    // target to 17.2 for exactly this reason. A capability check would reintroduce
    // the per-word DOM-wrapping renderer that ADR 0005 exists to delete — a second
    // implementation of the hardest part of the app, written to be worse.
    const everything = allCode();
    expect(everything).not.toMatch(/@supports/);
    expect(everything).not.toMatch(/\bsupports\s*\(/);
    expect(everything).not.toMatch(/typeof\s+(CSS|Highlight)\b/);
    expect(everything).not.toMatch(/['"](Highlight|highlights)['"]\s+in\b/);
    expect(everything).not.toMatch(/\bfallback\b/i);
    expect(everything).not.toMatch(/\bHighlight\s*(===|!==|&&|\|\|)/);
  });

  it('mutates the DOM in two ways only: the stylesheet a ::highlight() rule has to live in, and the mark on a Document’s own alignment', () => {
    const program = code('highlighter.ts');
    expect(program.match(/createElement\(/g)).toHaveLength(1);
    expect(program).toContain("createElement('style')");
    expect(program.match(/appendChild\(/g)).toHaveLength(1);
    expect(program).toContain('appendChild(style)');
    // ADR 0034: one attribute, under one name, on the elements a Document centres
    // or sets to the right — an attribute moves no text node, offset or CFI, and
    // nothing else about an element is touched.
    expect(program.match(/setAttribute\(/g)).toHaveLength(1);
    expect(program).toContain("own[k].setAttribute(OWN_ALIGNMENT, '');");
    expect(program).not.toMatch(/removeAttribute|toggleAttribute|setAttributeNS|\.dataset\b|classList|className\s*=|\.style\./);
    for (const mutation of [
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML',
      'createTextNode',
      'surroundContents',
      'replaceChild',
      'splitText',
      'textContent =',
    ]) {
      if (mutation === 'textContent =') {
        // The one exception, and it is the stylesheet's own text. It stopped being
        // a constant when Appearance arrived — the owner changes the font while the
        // book is open — and the theme (ADR 0022) is the third string in it. The
        // assertion is that the text is those three and nothing built from anything
        // else, and that the theme did not become a second `<style>` element out of
        // tidiness: the count above is still one `createElement`.
        expect(program).toContain('var wanted = CSS_TEXT + THEME + APPEARANCE;');
        expect(program).toContain('if (style.textContent !== wanted) style.textContent = wanted;');
        continue;
      }
      expect(program).not.toContain(mutation);
    }
  });

  it('reads a Document’s own alignment before the owner’s rule is in the document, and all of it before marking any', () => {
    // After the stylesheet is installed, a computed text-align is the owner's
    // answer and not the Document's, so the reading has to come first — on the
    // branch that creates the stylesheet, which runs once per document whichever
    // caller reaches it.
    const program = code('highlighter.ts');
    const ensure = fn(program, 'ensureStyle');
    const marks = ensure.indexOf('markOwnAlignment(doc);');
    expect(marks).toBeGreaterThan(-1);
    expect(marks).toBeLessThan(ensure.indexOf("createElement('style')"));
    expect(marks).toBeGreaterThan(ensure.indexOf('if (!style) {'));
    // Reading and writing interleaved would restyle the section once per mark.
    const mark = fn(program, 'markOwnAlignment');
    expect(mark.lastIndexOf('getComputedStyle(')).toBeGreaterThan(-1);
    expect(mark.lastIndexOf('getComputedStyle(')).toBeLessThan(mark.indexOf('setAttribute('));
    // What counts as the Document's own is the one list, and what is marked is
    // what the owner's rule excludes.
    pin(program, "'var OWN_ALIGNMENT = ' + JSON.stringify(OWN_ALIGNMENT)", 'highlighter.ts, highlighterSource');
    pin(highlighterSource(), 'var OWN_ALIGNMENTS = {"center":1,"right":1,"end":1,"-webkit-center":1,"-webkit-right":1};', 'the program');
  });
});

describe('never highlight through the library’s annotation API (ADR 0011)', () => {
  it('names none of it', () => {
    // `updateAnnotation` re-renders every view's annotation pane and each call is a
    // fresh string evaluation. `injectJavascript` installs our own highlighter once.
    for (const forbidden of ['Annotation', 'annotation', 'addMark', 'removeSelection']) {
      expect(allCode()).not.toContain(forbidden);
    }
  });
});

describe('Word Timings arrive already scaled (ADR 0005, rate.ts)', () => {
  it('has no rate in the arithmetic that builds the message', () => {
    // rate.ts divided them, once per Clip. Dividing again is, in ADR 0005's words,
    // the single easiest way to reintroduce drift — and it fails as a highlight
    // that is correct at the start of a sentence and wrong by the end of it.
    expect(code('cursor.ts')).not.toMatch(/\brate\b/);
    expect(code('messages.ts')).not.toMatch(/\brate\b/);
    expect(allCode()).not.toContain('playback/rate');
  });
});

describe('the two halves stay in separate files (README.md)', () => {
  it('lets only the bridge see the platform', () => {
    // Nothing in the type system distinguishes Hermes from Safari, so the boundary
    // is the file boundary. `highlighter.ts` is a string; if it could import
    // `react-native` the string would stop being the only thing that runs over there.
    const platform = /from\s+'(react|react-native|@epubjs-react-native\/core|expo[^']*)'/;
    for (const name of everyFile()) {
      const found = platform.test(code(name));
      expect({ name, platform: found }).toEqual({ name, platform: name === 'reader-bridge.ts' });
    }
  });

  it('keeps the WebView program parseable, since nothing else will notice a typo in it', () => {
    // It is a string: TypeScript does not look inside it and eslint does not either.
    // A missing bracket would first appear as a book that renders and never
    // highlights, on a device, with no error anywhere.
    expect(() => new vm.Script(highlighterSource(), { filename: 'highlighter.js' })).not.toThrow();
    expect(() => new vm.Script(highlighterSource(undefined, undefined, 'dark', null), { filename: 'measuring.js' })).not.toThrow();
    expect(() => new vm.Script(highlightCall({ kind: 'clear' }), { filename: 'call.js' })).not.toThrow();
  });

  it('escapes the two characters that are legal in JSON and end a statement in JavaScript', () => {
    const separator = String.fromCharCode(0x2028);
    const call = highlightCall({
      kind: 'speak',
      utterance: 0,
      utteranceRanges: [{ block: '0.0', start: 0, end: 3, text: 'a' + separator + 'b' }],
      words: null,
      durationMs: 1,
      reveal: false,
    });
    expect(call).not.toContain(separator);
    expect(call).toContain('u2028');
    expect(() => new vm.Script(call, { filename: 'call.js' })).not.toThrow();
  });
});

describe('nothing that does not survive a render is remembered', () => {
  /**
   * The defect a device run found on 2026-09-19, and the one this whole file exists
   * to stop coming back: the word highlight painted nothing while every step of the
   * chain looked correct from the inside. `blocks` had held `parts`, `element` and
   * `contents` — DOM references — across renders. epub.js replaces a section's
   * document as the reader pages through it, which is what a paginated reader does,
   * so a correct `Range` was built in a document that had lost its browsing context
   * and `build()` refused it with no message.
   */
  it('keeps only the text, the CFI and the section in the durable record', () => {
    const program = code('highlighter.ts');
    expect(program).toMatch(/blocks\.set\(id, \{ text: [^}]*cfi: [^}]*section: [^}]*\}\)/);
    expect(program).not.toMatch(/blocks\.set\([^)]*\b(parts|element|contents)\s*:/);
  });

  it('resolves the DOM against the live document instead', () => {
    // Walked once per document, not once per word: `maps` is keyed by the document,
    // so a document epub.js has replaced is simply not in it.
    const program = code('highlighter.ts');
    expect(program).toContain('maps.set(contents.document, map)');
    expect(program).toContain('var live = liveBlock(range.block)');
    expect(program).toContain('var dom = live.document.createRange()');
  });

  it('asks defaultView, which is the question isConnected cannot answer', () => {
    // A detached document still owns its nodes and they still report themselves
    // connected to it. Losing the browsing context is the thing that can be seen.
    //
    // Both gates, each scoped: the question is asked in the two places a document
    // enters the program, and a whole-file search is answered by either one. They
    // are not redundant — `liveContents` refuses a dead document for a Block the
    // reading is on *now*, and `attach` refuses to adopt one at all, which is what
    // keeps a dead document out of `maps` in the first place.
    const program = code('highlighter.ts');
    expect(program).not.toContain('isConnected');
    pin(fn(program, 'liveContents'), 'if (!contents.document || !contents.document.defaultView) continue;', 'highlighter.ts, function liveContents');
    pin(fn(program, 'attach'), 'if (!contents || !contents.document || !contents.document.defaultView) return;', 'highlighter.ts, function attach');
  });

  it('says so out loud when it cannot draw a highlight', () => {
    // The one step in the chain that was silent, which is why a defect in the thing
    // this project exists to do took a device run to find rather than arriving as a
    // message. Philosophy rule 1.
    const program = code('highlighter.ts');
    expect(program).toContain('report(why(state.utteranceRanges))');
    expect(program).toContain('report(why(ranges))');
  });
});

describe('the highlight actually paints', () => {
  /**
   * **`user-select: none` silently stops `::highlight()` painting.** Measured on a
   * device, 2026-09-19, and written down nowhere else — not in the CSS Custom
   * Highlight API's documentation and not in the library's.
   *
   * Nothing about it looks like a failure: `CSS.highlights` accepts the `Highlight`,
   * `::highlight()` parses into `cssRules`, the `Range` covers exactly the right
   * word, and the page stays blank. It cost a run through the DOM, the CFIs, the
   * coordinate chain, the multi-column layout and the iframe's sandbox before the
   * cause was found, and it is the single line between a working highlight and a
   * reader that paints nothing.
   */
  it('declares the text selectable, which is what makes ::highlight() paint', () => {
    /**
     * **The assertion that was vacuous, and the most expensive one in the file to
     * have been.** `user-select: text !important` is a substring of
     * `-webkit-user-select: text !important`, so a whole-file `toContain` for the
     * standard property was answered by the prefixed line: the standard property —
     * the one Safari on iOS 17.2 actually honours, and the single line between a
     * working highlight and a reader that paints nothing — could be deleted with
     * all 122 renderer assertions still passing. Confirmed by deleting it,
     * 2026-09-20.
     *
     * So the stylesheet is checked as a value rather than as a search: the rule the
     * highlight needs has exactly these three declarations, in this order, and
     * anything added, removed or renamed in it fails.
     */
    const css = highlightCss(DEFAULT_HIGHLIGHT);
    const selectable = css.slice(0, css.indexOf('}') + 1);
    expect(selectable.split('\n')).toEqual([
      'html, body, body * {',
      '  -webkit-user-select: text !important;',
      // The one that was deletable. `-webkit-user-select` alone does not restore
      // selectability on the iOS WebKit this app ships against.
      '  user-select: text !important;',
      // The property that actually suppresses the iOS long-press menu stays, which
      // is the part `enableSelection: false` was really buying.
      '  -webkit-touch-callout: none !important;',
      '}',
    ]);
    // And it is the first rule in the sheet, because the ::highlight() rules that
    // follow are what it exists to let paint.
    pin(css, 'html, body, body * {', 'the stylesheet highlightCss builds');
    expect(css.indexOf('html, body, body * {')).toBe(0);
  });

  it('is still fighting something, so the rule is still needed', () => {
    // The library's template applies `body { user-select: none }` through
    // `rendition.themes.default` whenever `enableSelection` is false, which is its
    // default and the app's. If that ever goes, this stylesheet is merely harmless.
    expect(library('template.js')).toContain("'user-select': 'none'");
  });

  it('installs the stylesheet before any highlight is registered', () => {
    // Order is load-bearing: flipping `user-select` after a `Highlight` is already
    // registered does not repaint it — the device run needed a re-register to see
    // anything. Nothing re-registers at runtime, so the rule has to be there first.
    const program = code('highlighter.ts');
    expect(program).toContain('ensureStyle(contents.document)');
    expect(program).toContain('ensureStyle(win.document)');
  });
});

describe('a highlight that moves takes all of itself with it (#35, ADR 0038)', () => {
  /**
   * WebKit paints a `::highlight()` background on a line with a line above it
   * from the bottom of the upper line's text, and before 319154@main it repaints
   * only the text's own box when a highlight's ranges change. On the first line
   * of a text node the strip between the two is painted by any whole repaint and
   * never erased: on the owner's phone, an amber line above a word the voice had
   * already left. Nothing in a DOM shows it — the registry holds the right Range
   * the whole time — so these pin the lines that repaint the Block, and
   * `test/manual-test/leading-strip.sh` photographs what they paint.
   */
  it('repaints the Block of every Range it takes out and of every Range it puts in', () => {
    const put = fn(code('highlighter.ts'), 'put');
    pin(put, 'touched.push(owners.get(range));', 'highlighter.ts, function put');
    pin(put, 'touched.push(owners.get(ranges[i]));', 'highlighter.ts, function put');
    pin(put, 'repaintBlocks(touched);', 'highlighter.ts, function put');
    // The ranges going out are read before the clear, when there are still some to read.
    expect(put.indexOf('highlight.forEach(')).toBeLessThan(put.indexOf('highlight.clear();'));
  });

  it('knows a Range’s Block because it wrote it down when it built the Range', () => {
    pin(fn(code('highlighter.ts'), 'domRange'), 'owners.set(dom, live.element);', 'highlighter.ts, function domRange');
  });

  it('repaints through a Range over the element itself, in a Highlight that can paint nothing', () => {
    const program = code('highlighter.ts');
    const repaint = fn(program, 'repaintBlocks');
    // `selectNode` and not `selectNodeContents`: only a Range that covers the
    // element makes WebKit repaint the element's own renderer, the whole block.
    // One over its contents repaints the text nodes, which is the bug.
    pin(repaint, 'whole.selectNode(element);', 'highlighter.ts, function repaintBlocks');
    expect(repaint).not.toContain('selectNodeContents');
    pin(repaint, 'registry.repaint.add(whole);', 'highlighter.ts, function repaintBlocks');
    pin(repaint, 'registry.repaint.delete(whole);', 'highlighter.ts, function repaintBlocks');
    // Never registered: a registered Highlight holding a whole Block, even for a
    // moment, is a Block painted by whatever rule names it.
    const registry = fn(program, 'registryFor');
    pin(registry, 'var repaint = new win.Highlight();', 'highlighter.ts, function registryFor');
    expect(registry.match(/CSS\.highlights\.set\(/g)).toHaveLength(2);
  });

  it('changes a highlight nowhere but in put, so no change can skip the repaint', () => {
    const program = code('highlighter.ts');
    const elsewhere = program.replace(fn(program, 'put'), '');
    expect(elsewhere).not.toMatch(/\bhighlight\.(clear|add|delete)\(/);
    expect(elsewhere).not.toMatch(/\.(utterance|word)\.(clear|add|delete)\(/);
  });
});

describe('the player floats over the page, and the centring is told (ADR 0020)', () => {
  it('centres in what can be seen rather than in the container', () => {
    // ADR 0011 centres against `clientHeight`; ADR 0020's player covers the bottom
    // of that container. Centring against the full height aims at a point the player
    // is standing on, and the sentence being spoken sits behind it — which fails as
    // "the highlight is off screen", not as an error.
    const program = code('highlighter.ts');
    const centre = fn(program, 'centre');
    expect(centre).toContain('var visible = height - covered;');
    expect(centre).toContain('visible / 2');
    expect(centre).not.toContain('height / 2');
  });

  it('takes the covered height as a message, because it changes when the player collapses', () => {
    // A constant subtracted once would be wrong the moment the player collapsed to
    // one button, and the centring runs once per Utterance on the Clip cue — so a
    // stale offset is not corrected by the next frame or by anything else.
    // Scoped to that branch, and it has to be: `covered = ` matches the
    // declaration `var covered = 0;` as well as the assignment, so the assignment
    // could go with this rule still green — and `covered` would then stay 0 for
    // ever, which is the defect the `visible / 2` rule above exists to prevent,
    // arriving through the other half of the same arithmetic.
    const program = code('highlighter.ts');
    pin(program, "message.kind === 'inset'", 'highlighter.ts');
    const inset = program.slice(program.indexOf("message.kind === 'inset'"));
    pin(inset.slice(0, inset.indexOf('return;')), 'covered = ', "highlighter.ts, the 'inset' branch");
  });

  it('sends the inset again once the program says it has installed', () => {
    // The player measures itself while the WebView is still loading its template, and
    // `highlightCall` is `window.X && window.X(...)` — a call into a function that is
    // not there yet, which does nothing and says nothing. Losing that first message
    // leaves the centring aiming at the middle of a container whose bottom is covered
    // and nothing reports it: the sentence is simply low on the screen until the
    // player happens to change size. The document message is the one signal that the
    // program exists.
    const bridge = code('reader-bridge.ts');
    const document = bridge.slice(bridge.indexOf('message.type === DOCUMENT_MESSAGE'));
    const branch = document.slice(0, document.indexOf('return;'));
    expect(branch).toContain("send({ kind: 'inset', bottomPx: inset.current })");
  });

  /**
   * The premise of the rule above, which was recorded as an argument and has never
   * been watched — `notes/NOTES_2026-09-20.md` at 01:45 lists the re-send as
   * "asserted, and **never observed working**", because the message it recovers is
   * one lost before the WebView loads and that was not reproduced on the device.
   *
   * The loss itself needs no device. `highlightCall` is `window.X && window.X(…)`,
   * which is an expression, and what it does when `window.X` is not there yet is
   * the whole of why the re-send exists. Run both ways here: nothing thrown and
   * nothing recorded when the program is absent, and the same string delivering the
   * message once it is present.
   */
  it('loses a message sent before the program installs, and says nothing about it', () => {
    const call = highlightCall({ kind: 'inset', bottomPx: 190 });

    const early: Record<string, unknown> = {};
    expect(() => vm.runInNewContext(call, { window: early })).not.toThrow();
    // Not a no-op that reported something either: an empty window is left empty.
    expect(Object.keys(early)).toEqual([]);

    const seen: unknown[] = [];
    const installed: Record<string, unknown> = { [HIGHLIGHTER]: (message: unknown) => seen.push(message) };
    vm.runInNewContext(call, { window: installed });
    expect(seen).toEqual([{ kind: 'inset', bottomPx: 190 }]);
  });

  it('does not scroll when the inset changes, because that would move the text under the reader', () => {
    // The one thing the floating player exists to prevent. The new inset applies to
    // the next Utterance; the sentence being spoken stays where it is.
    const program = code('highlighter.ts');
    const inset = program.slice(program.indexOf("message.kind === 'inset'"));
    const branch = inset.slice(0, inset.indexOf('return;'));
    expect(branch).not.toMatch(/centre|scrollBy|follow\(/);
  });
});

describe('Appearance reaches an open book, and the reading stays in the middle (ADR 0019)', () => {
  it('is a message, not a rebuilt program, because the program is installed once', () => {
    // `injectedJavascript` is evaluated at page load and the program's first line
    // refuses a second installation, so a source string rebuilt for a new font
    // changes nothing on a book that is already open — it fails as a setting that
    // appears to do nothing, which is exactly how the 01:01 note was bought.
    const bridge = code('reader-bridge.ts');
    expect(bridge).toContain("send({ kind: 'appearance', css: appearanceCss(next, bodyTextSize.current) })");
    // Built once, from the first render's options, and never rebuilt.
    expect(bridge).toContain(
      "highlighterSource(options.styles ?? DEFAULT_HIGHLIGHT, options.appearance ?? DEFAULT_APPEARANCE, options.scheme ?? 'light', options.bodyTextSize ?? null)",
    );
    // The theme is the same message-not-a-rebuild, and it is the same trap.
    expect(bridge).toContain("send({ kind: 'theme', css: themeCss(next) })");
    expect(bridge).not.toContain('[options.styles]');
  });

  it('bakes the owner’s choice into the program as well, against the Document’s own body text', () => {
    // A Document measured before opens at the owner's size on its first paint,
    // and is not measured again (ADR 0030).
    const chosen = { font: 'georgia', size: 20, textAlignment: 'left' } as const;
    const measured = highlighterSource(undefined, chosen, 'light', 12);
    pin(measured, 'var APPEARANCE = ' + JSON.stringify(appearanceCss(chosen, 12)) + ';', 'a measured Document');
    pin(measured, 'var MEASURE = false;', 'a measured Document');
    // One never measured opens as if its body text were 16 — which is what every
    // current Document's is — and is measured.
    const unknown = highlighterSource(undefined, undefined, 'light', null);
    pin(unknown, 'var APPEARANCE = ' + JSON.stringify(appearanceCss(DEFAULT_APPEARANCE, 16)) + ';', 'an unmeasured Document');
    pin(unknown, 'var MEASURE = true;', 'an unmeasured Document');
    // The download indexer's program lays nothing out for the owner to read.
    pin(highlighterSource(), 'var MEASURE = false;', 'the indexer’s program');
  });

  it('counts the Document’s own sizes only while it is being measured, and a bounded amount per page', () => {
    const program = code('highlighter.ts');
    pin(fn(program, 'adopt'), 'sizes: MEASURE ? sizesOf(contents, found) : null', 'highlighter.ts, function adopt');
    const sizesOf = fn(program, 'sizesOf');
    // However long the page: the owner ruled out a stall to measure a book (#17).
    // Both loops stop, so a page of one huge paragraph stops too.
    pinCount(sizesOf, 'counted < COUNT_LIMIT', 2, 'highlighter.ts, function sizesOf');
    // A computed size already carries the owner's percentage (measured, ADR 0030),
    // so it is divided back out to reach the size the Document set.
    pin(sizesOf, "getPropertyValue('-webkit-text-size-adjust')", 'highlighter.ts, function sizesOf');
    pin(sizesOf, '/ factor', 'highlighter.ts, function sizesOf');
  });

  it('stops counting once the bridge has decided, and moves nothing when it does', () => {
    const program = code('highlighter.ts');
    const branch = program.slice(program.indexOf("message.kind === 'measured'"), program.indexOf("message.kind === 'theme'"));
    pin(branch, 'MEASURE = false;', "the 'measured' branch");
    expect(branch).not.toContain('settle(');
    // Decided once, from one count per section, and handed to the app to keep —
    // after the section's Blocks, so nothing the app does with it can cost them.
    const bridge = code('reader-bridge.ts');
    pin(bridge, 'const counted = countPage(pages.current, message.sectionIndex, message.sizes);', 'reader-bridge.ts');
    pin(bridge, "send({ kind: 'measured' });", 'reader-bridge.ts');
    const handed = bridge.indexOf('latest.current.onBodyTextSize?.(decided);');
    pin(bridge, 'latest.current.onBodyTextSize?.(decided);', 'reader-bridge.ts');
    expect(handed).toBeGreaterThan(bridge.indexOf('latest.current.onBlocks?.(next.blocks'));
  });

  it('asks the WebView for its mobile content mode, which an iPad needs for text-size-adjust to do anything', () => {
    // An iPad-sized WKWebView defaults to the desktop content mode, where the
    // percentage computes and nothing moves: 12px stayed 12px at 200% on the
    // iPad Air simulator, and was 24px once the mode was mobile (ADR 0030). The
    // library passes the WebView a fixed list of props, so the one it needs is
    // added by `patches/` through `postinstall`; this reads the installed file.
    pin(library('View.js'), 'contentMode: "mobile",', 'the installed @epubjs-react-native/core View.js');
  });

  it('restyles every rendered section and then re-centres, because the text has moved', () => {
    // The opposite of the `inset` message, and the difference is the whole of it:
    // the player collapsing moves not one character (01:11), and a font change
    // moves every one of them — so the sentence being spoken is no longer where it
    // was put.
    const program = code('highlighter.ts');
    const branch = program.slice(program.indexOf("message.kind === 'appearance'"), program.indexOf("message.kind === 'theme'"));
    expect(branch).toContain('restyle();');
    expect(branch).toContain('settle(SETTLE_FRAMES, null, 0);');
    expect(fn(program, 'restyle')).toContain('ensureStyle(list[i].document)');
  });

  it('restyles for a theme change and does NOT re-centre, because a colour moves nothing (ADR 0022)', () => {
    // The other side of the same distinction. A font change moves every character
    // and has to be followed; a colour change moves none of them, so re-centring
    // would scroll the page under the reader for a repaint — which is the defect
    // the `inset` message exists to avoid.
    const program = code('highlighter.ts');
    const branch = program.slice(program.indexOf("message.kind === 'theme'"), program.indexOf("message.kind === 'clear'"));
    expect(branch).toContain('restyle();');
    expect(branch).not.toContain('settle(');
    expect(branch).not.toContain('centre(');
  });

  it('cannot declare user-select, in either theme (ADR 0021, ADR 0022)', () => {
    // `user-select: none` silently stops `::highlight()` from painting, and a
    // second builder of page CSS is a second way to reintroduce it. There is
    // nothing an owner typed in either theme — the argument is one of two words —
    // so this is checkable exhaustively rather than argued.
    for (const scheme of ['light', 'dark'] as const) {
      const css = themeCss(scheme);
      expect(css).not.toContain('user-select');
      for (const line of css.split('\n').filter(Boolean)) {
        expect({ scheme, line, ok: /^(html, body|body \*|::highlight\()/.test(line) }).toEqual({ scheme, line, ok: true });
      }
    }
    // Light leaves the document's own colours alone: it is the absence of a demand.
    expect(themeCss('light')).toBe('');
    // Dark makes one, and it reaches the descendants — colour inherits, so a rule
    // on the two roots alone is beaten by any book with `p { color: … }` of its own.
    expect(themeCss('dark')).toContain('body * { color:');
    expect(themeCss('dark')).toContain('background-color: transparent !important');
  });

  it('bakes the theme into the program too, so a book opens dark rather than flashing white', () => {
    expect(highlighterSource(undefined, undefined, 'dark')).toContain('var THEME = ' + JSON.stringify(themeCss('dark')));
    expect(highlighterSource()).toContain('var THEME = "";');
  });

  it('waits for the reflow instead of measuring a box that is about to move', () => {
    // epub.js resizes each section's iframe from the section's own ResizeObserver,
    // whose callback is a `requestAnimationFrame` — so the geometry is a frame or
    // more away and a centring on this frame aims at where the sentence was.
    // Two waits, and each is a different case: nothing to measure yet, and
    // something measured that has not stopped moving. A search of the function
    // finds either, so both are pinned — without the first a document that has not
    // laid out yet is never centred at all, and without the second the window
    // closes after one frame.
    const settle = fn(code('highlighter.ts'), 'settle');
    pin(settle, 'if (left > 0) window.requestAnimationFrame(function () { settle(left - 1, null, 0); });', 'highlighter.ts, function settle');
    pin(settle, 'window.requestAnimationFrame(function () {\n      settle(left - 1, box.top, steady);', 'highlighter.ts, function settle');
    expect(settle).toContain('Math.abs(box.top - was) < 1');
    // Every frame of the window, not once at the end: the first version centred
    // once and left the Utterance 4,285 px out when the text **shrank**, because a
    // page can look settled for a frame while epub.js is still relaying its views.
    expect(settle.indexOf('centre(built);')).toBeLessThan(settle.indexOf('if (steady >= 3'));
    // The library's own observer, read rather than trusted.
    expect(library('epubjs.js')).toContain('new ResizeObserver((t) => {\n            requestAnimationFrame(this.resizeCheck.bind(this));');
  });

  it('still scrolls from one place, so Appearance did not put a scroll on the frame path', () => {
    const program = code('highlighter.ts');
    expect(program.match(/scrollBy\(/g)).toHaveLength(1);
    for (const perWord of ['tick', 'showWord', 'showAt', 'start']) {
      expect({ perWord, scrolls: /centre|scrollBy|settle/.test(fn(program, perWord)) }).toEqual({ perWord, scrolls: false });
    }
  });
});

describe('tapping a word reads from there, and it is a tap (ADR 0020)', () => {
  it('listens for a click and for nothing that would take the platform’s long press', () => {
    // A long press on text is iOS's selection gesture, and suppressing it means
    // `user-select: none` — which silently stops ::highlight() from painting
    // (notes/NOTES_2026-09-19.md, 20:10, bisected on the device). So the long press
    // stays the platform's, and none of these is listened for.
    const program = code('highlighter.ts');
    expect(program).toContain("addEventListener('click', tapped, false)");
    for (const gesture of ['touchstart', 'touchend', 'contextmenu', 'selectstart', 'longpress', 'mousedown']) {
      expect({ gesture, listened: program.includes("'" + gesture + "'") }).toEqual({ gesture, listened: false });
    }
    expect(program).not.toContain('user-select: none');
  });

  it('posts nothing when the tap hit-tests to anything but a text node', () => {
    // Tapping blank space does nothing, and in particular it is not a toggle for the
    // player's visibility (docs/design/0020). nodeType 3 is a text node.
    const program = code('highlighter.ts');
    const tapped = fn(program, 'tapped');
    expect(tapped).toContain('caret.node.nodeType !== 3');
    expect(tapped).toContain('if (!place) return;');
    expect(tapped).toContain('type: TAP');
    expect(TAP_MESSAGE).toBe('openreader:tap');
  });

  /**
   * **The one assertion in this file that stands in for a device run, and it can
   * only ever be structural.**
   *
   * `caretPositionFromPoint` does not answer "there is no text here". It answers
   * with the *nearest* caret position — so a click at (2.0, 23.4), in the body's own
   * left padding and over nothing at all, came back as a caret in the heading beside
   * it and moved the reading to that heading's Utterance
   * (`notes/NOTES_2026-09-20.md`, 01:00). One line is the whole of the fix, and
   * `docs/design/0020` is the whole of why it matters: a gesture that is easy to
   * miss must not move your place in the book when you miss it.
   *
   * Nothing in Node can watch that line work. It needs a hit-test, a layout and a
   * box, and ADR 0011 puts all three inside Safari's JavaScript. A DOM mock would
   * prove the mock was called — `test/README.md` is explicit — and the measurement
   * that *does* prove it is in the log, taken twice, with and without the line.
   *
   * So this reads the program's text, like every other rule in this file, and pins
   * the three things a deletion or a defeat would each break: that the guard is
   * there with its `return`, that nothing reaches the post without passing it, and
   * that all four edges of the box are compared. It is a tripwire, not a proof, and
   * calling it anything else would be the lie this repository keeps catching.
   */
  it('refuses a tap that landed outside the Block the hit-test snapped to', () => {
    const program = code('highlighter.ts');
    const tapped = fn(program, 'tapped');
    expect(tapped).toContain('if (!inside(place.element, event.clientX, event.clientY)) return;');
    // Order, so that the guard cannot be moved below the thing it guards.
    expect(tapped.indexOf('inside(place.element')).toBeLessThan(tapped.indexOf('post({ type: TAP'));
    // All four edges. Dropping either horizontal comparison lets every margin tap
    // through, which is exactly the measurement above, on one axis.
    expect(fn(program, 'inside')).toContain('return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;');
    // And the guard needs the Block's own element, so what it reads that from has to
    // carry one: without it `inside` is called with undefined and every tap dies
    // instead, which is the same line failing the other way.
    expect(fn(program, 'blockOffsetOf')).toContain('element: found.element');
  });

  it('reports a place in a Block rather than an Utterance, the Utterances being on the other side', () => {
    // The WebView does not have the Utterance list. It reports the Block's own
    // coordinate system — the same UTF-16 offsets every other message uses — and
    // `cursor.ts`'s `utteranceAt` resolves it where the Utterances are.
    const program = code('highlighter.ts');
    expect(fn(program, 'blockOffsetOf')).toContain('found.parts[i].at + at');
    expect(code('reader-bridge.ts')).toContain('utteranceAt(utterances.current, ids.current, message.block, message.offset)');
  });
});

describe('the spine’s hrefs cross once, unmodified (ADR 0020)', () => {
  it('sends them with the document message rather than one per rendered section', () => {
    // A row of the contents list is an href and the only thing it can be seeked to
    // is a spine index, so the list cannot exist without this table —
    // `RenderedSection.href` delivers one per section as it renders, far too late for
    // a list that opens before most of 2,077 sections have.
    const program = code('highlighter.ts');
    expect(program).toContain('post({ type: DOCUMENT, spine: book.spine.length, hrefs: spineHrefs() });');
    expect(program.match(/type: DOCUMENT/g)).toHaveLength(1);
  });

  it('reports each href exactly as the spine spells it', () => {
    // epub.js resolves neither the navigation's hrefs nor the spine's against
    // anything, and `core/document/contents.ts` matches the two as strings. A
    // spelling tidied here would match neither side, and every row would resolve to
    // null — which that file reports as all-or-nothing for exactly this reason.
    const spine = fn(code('highlighter.ts'), 'spineHrefs');
    expect(spine).toContain('item && item.href ? item.href : ');
    for (const rewrite of ['decodeURI', 'encodeURI', 'resolve', 'replace', 'trim', 'toLowerCase']) {
      expect({ rewrite, used: spine.includes(rewrite) }).toEqual({ rewrite, used: false });
    }
  });
});

describe('a resize must not be able to lose the page (ADR 0011)', () => {
  /**
   * **The blank open**, diagnosed 2026-09-20 and measured both ways on the device.
   *
   * The manager's `resize` calls `this.clear()` whenever the size really changed,
   * destroying every view; the rendition's own handler then re-displays **only if
   * `this.location && this.location.start`**, which is not set until the opening
   * `display()` has reported a location. A resize landing in that window leaves
   * zero views, an empty container and `currentLocation()` answering `{}` — with
   * the app already holding the Blocks of sections that rendered and went. That is
   * the state recorded on 2026-09-19 at 20:44 and 22:55, on two different books.
   *
   * Forced on the device: with a location, two views come back in 700 ms; with the
   * location cleared, zero views and zero children, for good. With this handler in
   * place the same forced resize recovers on both books.
   *
   * Structural, like everything else in this file, and for the same reason: it
   * needs a stage, a resize observer and a rendition, all of which live in Safari.
   */
  it('puts the page back when epub.js has no location to put it back from', () => {
    const program = code('highlighter.ts');
    expect(program).toContain("rendition.on('resized', function () {");
    const handler = program.slice(program.indexOf("rendition.on('resized'"));
    const body = handler.slice(0, handler.indexOf('});'));
    // Only the case the library drops. With a location it recovers by itself, and
    // a second display would fight it.
    expect(body).toContain('if (rendition.location && rendition.location.start) return;');
    // The section that was on the page, never the start of the book: on a resumed
    // reading spine item 0 is the cover.
    expect(body).toContain('rendition.display(onScreen);');
    expect(body).not.toContain('rendition.display(0)');
  });

  it('remembers what was on the page, since the resize has already destroyed it', () => {
    // By the time the handler runs, `getContents()` is empty — `clear()` has been
    // and gone. The only usable target is one recorded before it.
    const program = code('highlighter.ts');
    expect(fn(program, 'sweep')).toContain('if (lowest !== null) onScreen = lowest;');
    expect(fn(program, 'sweep')).toContain('list[i].sectionIndex < lowest');
  });
});

describe('what was read out of @epubjs-react-native/core rather than its documentation', () => {
  it('still forwards the parsed object, not the WebView event', () => {
    // `onWebViewMessage?: (event: any) => void` and the parameter is called `event`,
    // but `View.js` parses the payload first and hands over the object. `asMessage`
    // in reader-bridge.ts depends on that and the `any` would hide it changing.
    const view = library('View.js');
    expect(view).toContain('JSON.parse(event.nativeEvent.data)');
    expect(view).toContain('onWebViewMessage(parsedEvent)');
  });

  it('still forwards only messages whose type is not one of its own', () => {
    // `if (!internalEvents.includes(type) && onWebViewMessage)`. A name collision
    // would not be an error: the library would handle the message itself and the
    // renderer would simply never see a Block.
    expect(library('View.js')).toContain('!_internalEvents.default.includes(type)');
    const internal = library('utils/internalEvents.util.js');
    expect(internal).not.toContain(BLOCKS_MESSAGE);
    expect(internal).not.toContain(PROBLEM_MESSAGE);
  });

  it('still installs injectedJavascript from onReady, after the first section has rendered', () => {
    // Which is why the program sweeps `rendition.getContents()` as it installs: the
    // first section's `rendered` event has already been and gone by then.
    expect(library('View.js')).toContain('book.current?.injectJavaScript(injectedJavascript)');
    // Scoped to the program's own installation, above `dispatch`: `sweep();`
    // appears twice, the second time in the Clip cue, where the 04:43 rule below
    // asserts it — so a whole-program search is answered by the wrong one, and the
    // installation sweep going takes the first rendered section's Blocks with it.
    const program = highlighterSource();
    const install = program.slice(program.indexOf('post({ type: DOCUMENT'), program.indexOf('function dispatch('));
    pin(install, 'sweep();', 'the highlighter program, between the document message and dispatch()');
  });

  it('still exposes the escape hatch and the CFI move the bridge is built on', () => {
    // ADR 0011 chose this library for `injectJavascript`, `goToLocation` and epub.js's
    // CFI dialect. All three come through `useReader`.
    const context = library('context.js');
    expect(context).toContain('book.current?.injectJavaScript(script)');
    expect(context).toContain("rendition.display('${targetCfi}')");
    expect(code('reader-bridge.ts')).toContain('injectJavascript, goToLocation } = useReader()');
  });
});

describe('the reading is fed by the reading, not by the scroll (notes/NOTES_2026-09-20.md, 04:43)', () => {
  /**
   * The chain that closed on itself: more text needs epub.js to render the next
   * spine item; the continuous manager appends one when its own `onScroll` finds
   * the scroll within `settings.offset` of the bottom; and the only thing that
   * scrolls while a book is read aloud is `centre()`, which stops at the sentence
   * being spoken. On a document whose sections are taller than their text the
   * reading therefore ran out with the rest of the book unrendered, and nothing
   * was left that would make more.
   */
  const program = highlighterSource();
  const ahead = fn(program, 'renderAhead');

  it('slices the function this section is about, and no more', () => {
    // The whole-file-search trap: every assertion below is scoped to renderAhead,
    // so the slice itself is the thing that has to be right.
    expect(ahead).toContain('function renderAhead(section) {');
    expect(ahead).not.toContain('function covers(');
    expect(ahead).not.toContain('function follow(');
  });

  it('is driven by the Clip cue, adding nothing to the bridge (ADR 0011)', () => {
    // The property ADR 0011 states of the centring, and the reason it states it:
    // the cue already arrives once per Utterance, so this costs no message.
    const speak = program.slice(program.indexOf("message.kind === 'speak'"), program.indexOf("message.kind === 'correct'"));
    expect(speak).toContain('renderAhead(sectionSpoken(message.utteranceRanges));');
  });

  it('first reports what is already on the page, because the library\u2019s event does not always arrive', () => {
    // Measured on the owner's book at 05:31, in the state the 04:43 reading died
    // in: views [3, 4d, 5d], section 5 holding a live document, `known` still 108
    // and section 5 never adopted. `liveContents` adopts only the section it is
    // asked about, and nothing asks about a section the reading has not reached.
    const speak = program.slice(program.indexOf("message.kind === 'speak'"), program.indexOf("message.kind === 'correct'"));
    expect(speak).toContain('sweep();');
    expect(speak.indexOf('sweep();')).toBeLessThan(speak.indexOf('renderAhead('));
  });

  it('asks for one section, the one after the voice, through epub.js’s own next()', () => {
    // Never a spine index of our own: `section.next()` is the call the manager's
    // own check() makes, and it is what knows about a spine item that is not linear.
    expect(ahead).toContain('var next = last.section.next();');
    expect(ahead).not.toContain('book.spine.get(');
  });

  it('only when that section is the manager’s last view', () => {
    // The view list is a contiguous run of spine items — append and prepend are the
    // only things that extend it — so appending out of order would put the wrong
    // text under the reader's thumb.
    expect(ahead).toContain('if (!last || !last.section || last.section.index !== section) return;');
  });

  it('once per section, ever', () => {
    // Load-bearing rather than tidy: the manager trims the view again within a
    // second or two (ADR 0011 keeps three alive), so without this the same chapter
    // would be fetched and parsed once per Utterance. `bySection` is the durable
    // half and `asked` covers the window before the Blocks are reported.
    expect(ahead).toContain('if (!next || bySection.has(next.index) || asked.has(next.index)) return;');
    expect(ahead).toContain('asked.add(next.index);');
    expect(program).toContain('var asked = new Set();');
  });

  it('appends through the manager’s own queue, which is what stops it racing update()', () => {
    // Measured 2026-09-20 05:09: appended and displayed straight away, the view was
    // taken apart by the update() a scroll had already scheduled, before its iframe
    // had loaded — no `iframe`, `displayed` false, its promise never settling and no
    // Blocks ever reported. epub.js's own check() appends, displays and updates
    // inside one queued task.
    expect(ahead).toContain('manager.q.enqueue(function () {');
    expect(ahead).toContain('return manager.append(next).display(manager.request);');
  });

  it('sweeps itself, because epub.js’s rendered event does not arrive for this', () => {
    // Watched for five seconds at 05:13 while the view reached `displayed`, held a
    // live document and a paragraph, and this program had not adopted it. Same gap
    // the 'relocated' sweep covers, same answer.
    expect(ahead).toContain('}).then(sweep, function (error) {');
  });

  it('forgets a section it could not render, so the next cue tries again', () => {
    // "Once per section, ever" is right for a section that rendered. Applied to one
    // that failed it would be this defect again, one section further on: a reading
    // stopped for good with nothing left that would ever produce more.
    expect(ahead).toContain('asked.delete(next.index);');
    expect(ahead.indexOf('asked.add(next.index);')).toBeLessThan(ahead.indexOf('asked.delete(next.index);'));
  });

  it('does not move the page', () => {
    // Rendering ahead is not navigation. `rendition.display()` under the continuous
    // manager clears every view and rebuilds from the target; it belongs to follow(),
    // where the reading has actually arrived somewhere.
    expect(ahead).not.toContain('rendition.display(');
    expect(ahead).not.toContain('scrollBy');
    expect(ahead).not.toContain('goToLocation');
  });

  it('leaves the scroll that makes the manager render, with its ignore flag off', () => {
    // Whatever else changes, this must not: `centre()` reaches epub.js as a finger
    // scroll does, which is what makes it append the section the reading is walking
    // into. A scroll it was told to ignore renders nothing new.
    expect(fn(program, 'centre')).toContain('rendition.manager.scrollBy(0, move, false)');
  });
});

describe('a section the page has not reached is not a highlight that failed', () => {
  const program = highlighterSource();

  it('is silent only when the caller is about to bring the section on to the page', () => {
    // Since renderAhead this happens at every section boundary of a document whose
    // sections are taller than their text, and follow() answers it by displaying the
    // section — so calling it a highlight that could not be drawn would leave that
    // sentence standing while the highlight was, in fact, drawn a moment later.
    expect(fn(program, 'showUtterance')).toContain(
      'if (!coming || !offPage(state.utteranceRanges)) report(why(state.utteranceRanges));',
    );
    const speak = program.slice(program.indexOf("message.kind === 'speak'"), program.indexOf("message.kind === 'correct'"));
    expect(speak).toContain('var shown = showUtterance(message.reveal);');
  });

  it('still reports every other reason a highlight could not be drawn', () => {
    // A Block nobody reported, or one the rendered section no longer holds, is a
    // real failure — the silence that let a Range built in a dead document look
    // correct from the inside is what the problem message exists for.
    const off = fn(program, 'offPage');
    expect(off).toContain('if (!record || liveContents(record.section)) return false;');
    expect(off).toContain('if (!ranges.length) return false;');
    // attach() asks without `coming`, because a section that has arrived and still
    // cannot be highlighted is the real thing.
    expect(fn(program, 'attach')).toContain('var built = showUtterance();');
  });
});
