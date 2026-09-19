import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BLOCKS_MESSAGE, PROBLEM_MESSAGE, TAP_MESSAGE } from '../../src/renderer/messages';
import { highlightCall, highlighterSource } from '../../src/renderer/highlighter';

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
    expect(code('highlighter.ts')).toContain('requestAnimationFrame');
    expect(highlighterSource()).toContain('window.requestAnimationFrame(tick)');
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
  it('uses the CSS Custom Highlight API', () => {
    expect(code('highlighter.ts')).toContain('CSS.highlights.set(');
    expect(code('highlighter.ts')).toContain('new win.Highlight()');
    expect(code('highlighter.ts')).toContain('::highlight(');
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

  it('mutates the DOM exactly once, for the stylesheet a ::highlight() rule has to live in', () => {
    const program = code('highlighter.ts');
    expect(program.match(/createElement\(/g)).toHaveLength(1);
    expect(program).toContain("createElement('style')");
    expect(program.match(/appendChild\(/g)).toHaveLength(1);
    expect(program).toContain('appendChild(style)');
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
        // The one exception, and it is the stylesheet's own text.
        expect(program).toContain('style.textContent = CSS_TEXT');
        continue;
      }
      expect(program).not.toContain(mutation);
    }
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
    expect(code('highlighter.ts')).not.toContain('isConnected');
    expect(code('highlighter.ts')).toContain('contents.document.defaultView');
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
    const program = code('highlighter.ts');
    expect(program).toContain('-webkit-user-select: text !important');
    expect(program).toContain('user-select: text !important');
    // The property that actually suppresses the iOS long-press menu stays, which is
    // the part `enableSelection: false` was really buying.
    expect(program).toContain('-webkit-touch-callout: none !important');
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
    const program = code('highlighter.ts');
    expect(program).toContain("message.kind === 'inset'");
    expect(program).toContain('covered = ');
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

  it('does not scroll when the inset changes, because that would move the text under the reader', () => {
    // The one thing the floating player exists to prevent. The new inset applies to
    // the next Utterance; the sentence being spoken stays where it is.
    const program = code('highlighter.ts');
    const inset = program.slice(program.indexOf("message.kind === 'inset'"));
    const branch = inset.slice(0, inset.indexOf('return;'));
    expect(branch).not.toMatch(/centre|scrollBy|follow\(/);
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
    expect(highlighterSource()).toContain('sweep();');
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
