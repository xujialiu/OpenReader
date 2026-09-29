import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BLOCKS_MESSAGE, PROBLEM_MESSAGE, TAP_MESSAGE } from '../../src/renderer/messages';
import { GLIDE_SOURCE } from '../../src/renderer/glide';
import {
  appearanceCss,
  DEFAULT_APPEARANCE,
  DEFAULT_HIGHLIGHT,
  HIGHLIGHTER,
  highlightCall,
  READER_THEME,
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

describe('the page follows the line being spoken (ADR 0011, ADR 0050)', () => {
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

  it('scrolls in one place, and only bring() and a glide reach it', () => {
    // ADR 0005 keeps the frame path off the bridge; this keeps the scroll in one
    // function, so there is one thing to read to know how the page moves. Each
    // scroll costs the continuous manager a pass over its views, so a scroll from
    // the word loop itself would fail as a reader that stutters, not as an error.
    const program = code('highlighter.ts');
    expect(program.match(/scrollBy\(/g)).toHaveLength(1);
    pin(fn(program, 'nudge'), 'rendition.manager.scrollBy(0, by, false);', 'highlighter.ts, function nudge');
    // One call in bring(), for a move made at once, one a frame in glideStep(),
    // and one a frame in drift() (Continuous, #71); the declaration is the fourth.
    expect(program.match(/nudge\(/g)).toHaveLength(4);
    expect(fn(program, 'bring').match(/nudge\(/g)).toHaveLength(1);
    expect(fn(program, 'glideStep').match(/nudge\(/g)).toHaveLength(1);
    expect(fn(program, 'drift').match(/nudge\(/g)).toHaveLength(1);
    for (const perWord of ['tick', 'showWord', 'showAt', 'start']) {
      expect({ perWord, scrolls: /nudge|scrollBy|bring\(|steer\(|kick\(|settle|place(Once)?\(/.test(fn(program, perWord)) }).toEqual({ perWord, scrolls: false });
    }
  });

  it('moves the page for a word only when the word is on another line (ADR 0050)', () => {
    // The page follows the line, not the word and not the sentence: a word on the
    // line being read moves nothing, which is what keeps the loop from scrolling
    // once a word. And a word painted by attach() is quiet — attach() places the
    // page itself, a frame later when epub.js is still moving it (#50).
    const program = code('highlighter.ts');
    pin(fn(program, 'showWord'), 'if (!quiet) followWord(built, ranges);', 'highlighter.ts, function showWord');
    const follow = fn(program, 'followWord');
    pin(follow, 'if (!state || !state.follow || browsing || !state.words) return;', 'highlighter.ts, function followWord');
    pin(follow, 'if (sameLine(followed, line)) return;', 'highlighter.ts, function followWord');
    pin(follow, 'bring({ line: line }, false);', 'highlighter.ts, function followWord');
    expect(follow.indexOf('sameLine(followed, line)')).toBeLessThan(follow.indexOf('bring('));
  });

  it('in Continuous, lets every word move where the page drifts, and only the drift move the page (#71)', () => {
    // Continuous is decided before the By line test, and hands the word to
    // steer(), which moves nothing itself for a drift: the drift's own frames do,
    // a pixel at a time. The word loop still never scrolls (the rule above).
    const program = code('highlighter.ts');
    const follow = fn(program, 'followWord');
    pin(follow, "if (SCROLLING === 'continuous') {", 'highlighter.ts, function followWord');
    pin(follow, 'steer({ line: line, lead: leadOf(ranges, line) });', 'highlighter.ts, function followWord');
    expect(follow.indexOf("SCROLLING === 'continuous'")).toBeLessThan(follow.indexOf('sameLine(followed, line)'));
    const steer = fn(program, 'steer');
    expect(steer).not.toMatch(/nudge\(|scrollBy/);
    // Another Block, or more than a line, is a move of its own, made as every
    // other move is: a paragraph gap glides however small the Document's margin.
    pin(steer, 'var crossed = !!was && was.block !== aimed.line.block;', 'highlighter.ts, function steer');
    pin(steer, 'if (crossed || Math.abs(move) > aimed.line.height) {\n      rest();\n      return bring(aimed, false);', 'highlighter.ts, function steer');
    // `was` is the line followed before this one, read before it is replaced.
    expect(steer.indexOf('var was = followed;')).toBeLessThan(steer.indexOf('followed = aimed.line;'));
    // Every line knows its Block: build() keeps them beside the Ranges.
    pin(fn(program, 'build'), 'blocks.push(ranges[i].block);', 'highlighter.ts, function build');
    pin(fn(program, 'lineOf'), 'block: built.blocks[i]', 'highlighter.ts, function lineOf');
    pin(steer, 'if (!glide) kick();', 'highlighter.ts, function steer');
    // A glide hands over to the drift when it ends.
    pin(fn(program, 'glideStep'), 'kick();', 'highlighter.ts, function glideStep');
  });

  it('drifts with the follower the tests run, in whole pixels, steering by what it has not yet paid (#71)', () => {
    const program = code('highlighter.ts');
    const drift = fn(program, 'drift');
    pin(drift, 'var move = moveFor(drifting.aimed);', 'highlighter.ts, function drift');
    // The owed fraction is taken off the move, or the pixel not yet paid would
    // read as one still to make and it would push past the line and back.
    pin(drift, 'var error = move - drifting.owed;', 'highlighter.ts, function drift');
    pin(drift, 'drifting.speed = driftVelocity(error, drifting.speed, dt);', 'highlighter.ts, function drift');
    pin(drift, 'var whole = drifting.owed > 0 ? Math.floor(drifting.owed) : Math.ceil(drifting.owed);', 'highlighter.ts, function drift');
    // Timed in drawn frames, as a glide is, so a stall slows it and does not throw it.
    pin(drift, 'var dt = drifting.last === null ? FRAME_MS : Math.min(now - drifting.last, 2 * FRAME_MS);', 'highlighter.ts, function drift');
    pin(drift, "if (!state || !state.follow || browsing || SCROLLING !== 'continuous') {", 'highlighter.ts, function drift');
    // A finger stops it as it stops a glide.
    const halt = fn(program, 'halt');
    pin(halt, 'rest();', 'highlighter.ts, function halt');
    pin(halt, 'window.cancelAnimationFrame(driftFrame);', 'highlighter.ts, function halt');
  });

  it('carries the line past the line position by the word’s place along it, measured on the text around it (#71)', () => {
    const program = code('highlighter.ts');
    pin(fn(program, 'moveFor'), 'return middle === null ? null : middle - at + (aimed.lead || 0);', 'highlighter.ts, function moveFor');
    const lead = fn(program, 'leadOf');
    // The text around the word, not the whole Block: a Block the length of a
    // chapter must cost what a paragraph does.
    pin(lead, 'var span = nearby(live, at.start - NEAR, at.start + NEAR);', 'highlighter.ts, function leadOf');
    pin(lead, 'return lineLead(line.left, from, to, pitch);', 'highlighter.ts, function leadOf');
    pin(program, 'var NEAR = 400;', 'highlighter.ts');
    const aim = fn(program, 'aim');
    pin(aim, "return SCROLLING === 'continuous' ? { line: line, lead: leadOf(ranges, line) } : { line: line };", 'highlighter.ts, function aim');
  });

  it('glides a move within the visible page, and makes any other at once (ADR 0050)', () => {
    const program = code('highlighter.ts');
    const bring = fn(program, 'bring');
    pin(bring, 'if (Math.abs(move) < 1) {', 'highlighter.ts, function bring');
    pin(bring, 'if (instant || !glides(move, visibleOf(scroller()))) {', 'highlighter.ts, function bring');
    // A glide to the line already being glided to is left alone; any other is
    // taken over from where the page is.
    pin(bring, 'if (!instant && glide && aimed.line && glide.aimed.line && sameLine(glide.aimed.line, aimed.line)) return true;', 'highlighter.ts, function bring');
    pin(bring, 'glide = { aimed: aimed, from: move, elapsed: 0, last: null };', 'highlighter.ts, function bring');
    // Each frame measures the line again and moves by what the curve still
    // leaves, so epub.js moving the scroll position under a glide is absorbed.
    const step = fn(program, 'glideStep');
    pin(step, 'var move = moveFor(glide.aimed);', 'highlighter.ts, function glideStep');
    pin(step, 'var left = glideLeft(glide.from, glide.elapsed);', 'highlighter.ts, function glideStep');
    // Timed in drawn frames, at most two frames' worth each, so a stalled main
    // thread pauses a glide rather than using the curve up in a jump.
    pin(step, 'glide.elapsed += glide.last === null ? FRAME_MS : Math.min(now - glide.last, 2 * FRAME_MS);', 'highlighter.ts, function glideStep');
    pin(step, 'var by = move - left;', 'highlighter.ts, function glideStep');
    pin(step, 'if (!state || !state.follow || browsing) {', 'highlighter.ts, function glideStep');
    // The Utterance is the unit only without Word Timings.
    const aim = fn(program, 'aim');
    pin(aim, 'if (state.words || !state.durationMs) {', 'highlighter.ts, function aim');
    pin(aim, 'var ranges = (state.words && spokenRanges()) || state.utteranceRanges;', 'highlighter.ts, function aim');
    pin(aim, 'var built = build(ranges);', 'highlighter.ts, function aim');
    pin(aim, 'return whole ? { whole: whole } : null;', 'highlighter.ts, function aim');
  });

  it('runs the glide source the tests run', () => {
    // glide.test.ts evaluates GLIDE_SOURCE; this is what makes that the program's.
    pin(highlighterSource(), GLIDE_SOURCE, 'the program');
  });

  it('does not scroll on the once-a-second correction itself', () => {
    // The correction is the second and last thing the bridge sends (ADR 0005). It
    // moves the highlight to the word the voice is on; the page follows that word
    // only if it is on another line, through showAt() like any word, and never
    // from the correction's own branch.
    const program = code('highlighter.ts');
    const correction = program.slice(program.indexOf("message.kind === 'correct'"));
    expect(correction).not.toMatch(/nudge|scrollBy|bring\(|place(Once)?\(|follow\(/);
  });

  it('places at most once per document per Utterance', () => {
    // A placing can make the continuous manager render a section, which reaches
    // `attach`, which would place again, which would render again. The WeakSet is
    // what ends that, and it is weak because the alternative is the renderer
    // holding a document epub.js means to destroy.
    const program = code('highlighter.ts');
    expect(program).toContain('placed: new WeakSet()');
    expect(fn(program, 'placeOnce')).toContain('if (state.placed.has(doc)) return;');
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
    // Two stylesheets, and the second is not in a Document at all: it is the
    // page epub.js lays the sections out on, and it holds one rule, the room kept
    // above the first section for the navigation bar (#67, `reserve`). Nothing of
    // the book's text is in that page, so no text node, offset or CFI can move.
    expect(program.match(/createElement\(/g)).toHaveLength(2);
    expect(program.match(/createElement\('style'\)/g)).toHaveLength(2);
    expect(program.match(/appendChild\(/g)).toHaveLength(2);
    expect(program.match(/appendChild\(style\)/g)).toHaveLength(2);
    expect(fn(program, 'reserve')).toContain("document.createElement('style')");
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
        // And the bar's room, built from a number and nothing else.
        expect(program.match(/textContent = /g)).toHaveLength(2);
        expect(fn(program, 'reserve')).toContain("style.textContent = barReserved > 0");
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
   * `test/manual-test/scrolling-and-theme/leading-strip.sh` photographs what they paint.
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
  it('holds the line in what can be seen rather than in the container', () => {
    // ADR 0011 measured against `clientHeight`; ADR 0020's player covers the bottom
    // of that container. Aiming against the full height aims at a point the player
    // is standing on, and the line being spoken sits behind it — which fails as
    // "the highlight is off screen", not as an error.
    const program = code('highlighter.ts');
    // What can be seen now lies between the bar and the player, both floating
    // over the container (ADR 0020, #67).
    pin(fn(program, 'visibleOf'), 'var visible = view.clientHeight - covered - barCovered;', 'highlighter.ts, function visibleOf');
    const moveFor = fn(program, 'moveFor');
    pin(moveFor, 'var at = lineAt(view, bounds);', 'highlighter.ts, function moveFor');
    expect(moveFor).not.toContain('clientHeight');
    // What the line position is a share of: the page between the room kept for
    // the bar (#67) and the open player (#71), or what is covered now until each
    // is measured — so that hiding the bar and collapsing the player move nothing.
    const lineAt = fn(program, 'lineAt');
    pin(lineAt, 'var over = barReserved > 0 ? barReserved : barCovered;', 'highlighter.ts, function lineAt');
    pin(lineAt, 'var visible = view.clientHeight - over - under;', 'highlighter.ts, function lineAt');
    pin(lineAt, 'return bounds.top + over + visible * LINE_POSITION;', 'highlighter.ts, function lineAt');
    // The middle, until the owner's Line Position reaches it.
    pin(highlighterSource(), 'var LINE_POSITION = 0.5;', 'the program');
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
    expect(branch).toContain("send({ kind: 'inset', bottomPx: inset.current, openPx: openPlayer.current })");
  });

  it('sends the Line Position again once the program says it has installed, unless it is the one baked in (#71)', () => {
    // The same trap as the inset: the setting's first message goes before the
    // program exists. The middle is in the program's source already, so only
    // another position needs sending.
    const bridge = code('reader-bridge.ts');
    const document = bridge.slice(bridge.indexOf('message.type === DOCUMENT_MESSAGE'));
    const branch = document.slice(0, document.indexOf('return;'));
    expect(branch).toContain('if (linePosition.current !== BAKED_LINE_POSITION || scrolling.current !== BAKED_SCROLLING) {');
    expect(branch).toContain("send({ kind: 'following', linePosition: linePosition.current, scrolling: scrolling.current });");
    expect(code('highlighter.ts')).toContain("'var LINE_POSITION = ' + BAKED_LINE_POSITION + ';\\n'");
    // And the way of scrolling, baked in beside it, By line.
    expect(code('highlighter.ts')).toContain("'var SCROLLING = ' + JSON.stringify(BAKED_SCROLLING) + ';\\n'");
  });

  it('sends the Line Position and the way of scrolling together, every time (#71)', () => {
    // One message with both, so the program never holds half of an old choice.
    const bridge = code('reader-bridge.ts');
    expect(bridge.match(/send\(\{ kind: 'following'/g)).toHaveLength(3);
    for (const sent of bridge.match(/send\(\{ kind: 'following'[^}]*\}/g) ?? []) {
      expect(sent).toMatch(/linePosition: /);
      expect(sent).toMatch(/scrolling: /);
    }
  });

  it('measures the line position above the open player, not above what it covers now (#71)', () => {
    // `covered` grows with every note on the player and shrinks to one button when
    // it collapses. Measured against it, a note that came and went while paused
    // left the line 87 px above the middle until Play (notes, 2026-09-26). The
    // open player's own height changes only with its controls.
    const program = code('highlighter.ts');
    pin(fn(program, 'lineAt'), 'var under = openPlayer > 0 ? openPlayer : covered;', 'highlighter.ts, function lineAt');
    const inset = program.slice(program.indexOf("message.kind === 'inset'"));
    pin(inset.slice(0, inset.indexOf('return;')), 'openPlayer = ', "highlighter.ts, the 'inset' branch");
    // And the player reports that height from its controls alone, so no note is in it.
    const player = readFileSync(new URL('../../src/app/player.tsx', import.meta.url).pathname, 'utf8');
    expect(player).toContain('<View style={styles.controls} onLayout={measureControls}>');
    expect(player.indexOf('notes.map(')).toBeLessThan(player.indexOf('<View style={styles.controls} onLayout={measureControls}>'));
  });

  it('brings a following page to a new Line Position, and leaves a browsed one where it is (#71)', () => {
    const program = code('highlighter.ts');
    const following = program.slice(program.indexOf("message.kind === 'following'"));
    const branch = following.slice(0, following.indexOf('return;\n    }\n'));
    expect(branch).toContain('LINE_POSITION = share;');
    expect(branch).toContain("if (message.scrolling === 'line' || message.scrolling === 'continuous') SCROLLING = message.scrolling;");
    // Leaving Continuous forgets where it drifted, so By line starts from the words.
    expect(branch).toContain('drifting = null;');
    expect(branch).toContain('if (state && state.follow && !browsing) approach(aim());');
    // approach() is bring() By line, and steer() in Continuous.
    pin(fn(program, 'approach'), "return SCROLLING === 'continuous' ? steer(aimed) : bring(aimed, false);", 'highlighter.ts, function approach');
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
    const call = highlightCall({ kind: 'inset', bottomPx: 190, openPx: 0 });

    const early: Record<string, unknown> = {};
    expect(() => vm.runInNewContext(call, { window: early })).not.toThrow();
    // Not a no-op that reported something either: an empty window is left empty.
    expect(Object.keys(early)).toEqual([]);

    const seen: unknown[] = [];
    const installed: Record<string, unknown> = { [HIGHLIGHTER]: (message: unknown) => seen.push(message) };
    vm.runInNewContext(call, { window: installed });
    expect(seen).toEqual([{ kind: 'inset', bottomPx: 190, openPx: 0 }]);
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

describe('the navigation bar floats over the page too, and the page keeps room for it (#67, ADR 0048)', () => {
  it('holds the line below the room for the bar, and puts a tall Utterance just below the bar', () => {
    // The bar covers the top of the container while it is shown, as the player
    // covers the bottom; a line position measured from the container's top would
    // hold the line being spoken a bar's height too high, and a tall Utterance's
    // opening words would start under the bar. The line position is measured
    // from the room kept for the bar, which stays when the bar hides with the
    // player (#71), and what can be seen now from what the bar covers now.
    const program = code('highlighter.ts');
    const lineAt = fn(program, 'lineAt');
    expect(lineAt).toContain('barReserved');
    expect(lineAt).toContain('return bounds.top + over + visible * LINE_POSITION;');
    expect(fn(program, 'moveFor')).toContain('move = box.top - bounds.top - barCovered;');
    expect(fn(program, 'onVisiblePage')).toContain('view.getBoundingClientRect().top + barCovered;');
  });

  it('takes what the bar covers and the room it needs as a message, and scrolls nothing when they change', () => {
    // The same rule as the inset: hiding the bar moves no text, and a scroll to
    // the new middle would.
    const program = code('highlighter.ts');
    pin(program, "message.kind === 'bar'", 'highlighter.ts');
    const bar = program.slice(program.indexOf("message.kind === 'bar'"));
    const branch = bar.slice(0, bar.indexOf('return;'));
    pin(branch, 'barCovered = ', "highlighter.ts, the 'bar' branch");
    pin(branch, 'barReserved = reserved;', "highlighter.ts, the 'bar' branch");
    expect(branch).not.toMatch(/centre|scrollBy|follow\(/);
  });

  it('keeps the room above the document with a pseudo-element, never with the container’s padding', () => {
    // Padding changes the size epub.js's stage measures, and a stage that changes
    // size destroys every view (the blank open). A ::before takes room in the
    // scroll without changing the container's box.
    const reserve = fn(code('highlighter.ts'), 'reserve');
    expect(reserve).toContain('.epub-container::before');
    expect(code('highlighter.ts')).not.toMatch(/paddingTop|padding-top/);
  });

  it('lands a section already on the page below the bar, by the one offset epub.js reads', () => {
    // A section epub.js has already laid out is displayed by scrolling to its
    // view's offsetTop, which counts the room above; without this its first line
    // would go under the bar. Installed with the rest.
    const program = code('highlighter.ts');
    const land = fn(program, 'landBelowBar');
    expect(land).toContain('at.top - barReserved');
    expect(program).toContain('landBelowBar(rendition.manager);');
    // epub.js reads a view's offset() in exactly one place, which is why wrapping
    // it moves nothing else. A second reader would be a second thing moved.
    const epubjs = readFileSync(new URL('../../node_modules/@epubjs-react-native/core/lib/module/epubjs.js', import.meta.url), 'utf8');
    expect(epubjs.match(/\.offset\(\)/g)?.length).toBe(1);
  });

  it('sends the bar again once the program says it has installed', () => {
    // The screen knows the bar's height before the WebView has loaded its template,
    // and a message sent then is lost without a word, as the inset's is.
    const bridge = code('reader-bridge.ts');
    const document = bridge.slice(bridge.indexOf('message.type === DOCUMENT_MESSAGE'));
    const branch = document.slice(0, document.indexOf('return;'));
    expect(branch).toContain("send({ kind: 'bar', ...bar.current })");
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

  it('gives the reading page a viewport that cannot be scaled, so a pinch never magnifies it', () => {
    // The library's template set `width=device-width, initial-scale=1.0` and no
    // limit, and a WKWebView honours the page's viewport: a pinch magnified the
    // reading page 2.6x and ran its text off the screen (#79, design 0052). The
    // template is one string in the library, so the limit is added by `patches/`.
    pin(
      library('template.js'),
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />',
      'the installed @epubjs-react-native/core template.js',
    );
  });

  it('lets Safari\'s Web Inspector reach the reader\'s WebView and the Indexer\'s in Debug Mode, and no other build (#82)', () => {
    // The library hands its WebView a fixed list of props and `webviewDebuggingEnabled`
    // (react-native-webview's name for WKWebView's `isInspectable`, iOS 16.4 and
    // later) is not among them, so `patches/` adds it to View.js, default false, and
    // to `ReaderProps`. Reader spreads the rest of its props into View, so the app
    // sets it on `<Reader>` itself, to Debug Mode, in both places a Reader is made
    // (ADR 0054). commonjs is what Metro bundles; module is patched alike.
    for (const build of ['commonjs', 'module']) {
      const view = readFileSync(new URL(`../../node_modules/@epubjs-react-native/core/lib/${build}/View.js`, import.meta.url).pathname, 'utf8');
      const where = `the installed @epubjs-react-native/core lib/${build}/View.js`;
      pin(view, '  webviewDebuggingEnabled = false\n}) {', where);
      pin(view, 'webviewDebuggingEnabled: webviewDebuggingEnabled,', where);
    }
    const types = readFileSync(new URL('../../node_modules/@epubjs-react-native/core/lib/typescript/types.d.ts', import.meta.url).pathname, 'utf8');
    pin(types, 'webviewDebuggingEnabled?: boolean;', 'the installed @epubjs-react-native/core types.d.ts');
    for (const file of ['../../src/app/reading-view.tsx', '../../src/offline/indexer.tsx']) {
      pin(readFileSync(new URL(file, import.meta.url), 'utf8'), 'webviewDebuggingEnabled={DEBUG_MODE}', file.slice(6));
    }
  });

  it('leaves a long press on the page to WebKit, so no gesture of the library races text selection (#74)', () => {
    // The library wraps the WebView in a gesture-handler `GestureDetector` whose
    // `Gesture.LongPress()` has the default 500 ms minimum, the same as UIKit's
    // selection loupe on WKContentView. On the owner's iPhone the two raced: when
    // `RNBetterLongPressGestureRecognizer` began first (+503 ms), UIKit failed the
    // loupe before WebKit was asked, and the press selected nothing; when WebKit
    // was asked first (+504 ms), the word was selected (engineering log,
    // 2026-09-29). The app passes the reader no `onLongPress`, so `patches/`
    // removes the gesture. commonjs is what Metro bundles (`"react-native"` in the
    // library's package.json); module is patched alike.
    for (const build of ['commonjs', 'module']) {
      const handler = readFileSync(
        new URL(`../../node_modules/@epubjs-react-native/core/lib/${build}/utils/GestureHandler.js`, import.meta.url).pathname,
        'utf8',
      );
      const where = `the installed @epubjs-react-native/core lib/${build}/utils/GestureHandler.js`;
      expect(handler, where).not.toContain('Gesture.LongPress(');
      pinCount(handler, 'Gesture.Exclusive(swipeLeft, swipeRight, swipeUp, swipeDown, doubleTap, singleTap)', 2, where);
    }
  });

  it('restyles every rendered section and then re-centres, because the text has moved', () => {
    // The opposite of the `inset` message, and the difference is the whole of it:
    // the player collapsing moves not one character (01:11), and a font change
    // moves every one of them — so the sentence being spoken is no longer where it
    // was put.
    const program = code('highlighter.ts');
    const branch = program.slice(program.indexOf("message.kind === 'appearance'"), program.indexOf("message.kind === 'theme'"));
    expect(branch).toContain('restyle();');
    expect(branch).toContain('settle(SETTLE_FRAMES, 0);');
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
    expect(branch).not.toMatch(/place(Once)?\(|bring\(/);
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

  it('marks the spoken word in blue under dark and leaves its letters the page text (#69)', () => {
    // Amber cannot carry the page's light letters: `#e6e6ea` on the old word amber
    // measured 1.85:1, so the letters were set to the page colour and the spoken
    // word was the one dark word on the page. Blue carries them at 4.65:1, so the
    // highlight rules must declare no `color` at all — any value there recolours
    // the word the owner is following.
    const highlights = themeCss('dark').split('\n').filter((line) => line.startsWith('::highlight('));
    expect(highlights).toEqual([
      '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: #434665; }',
      '::highlight(' + WORD_HIGHLIGHT + ') { background-color: #4456de; }',
    ]);
    for (const line of highlights) expect(line).not.toMatch(/(^|[\s;{])color:/);
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
    pin(settle, 'if (left > 0) window.requestAnimationFrame(function () { settle(left - 1, 0); });', 'highlighter.ts, function settle');
    pin(settle, 'window.requestAnimationFrame(function () {\n      settle(left - 1, steady);', 'highlighter.ts, function settle');
    pin(settle, 'var steady = Math.abs(move) < 1 ? still + 1 : 0;', 'highlighter.ts, function settle');
    // Every frame of the window, not once at the end: the first version centred
    // once and left the Utterance 4,285 px out when the text **shrank**, because a
    // page can look settled for a frame while epub.js is still relaying its views.
    // And at once, never a glide: the text has jumped by itself.
    expect(settle.indexOf('bring(aimed, true);')).toBeLessThan(settle.indexOf('if (steady >= 3'));
    // The library's own observer, read rather than trusted.
    expect(library('epubjs.js')).toContain('new ResizeObserver((t) => {\n            requestAnimationFrame(this.resizeCheck.bind(this));');
  });

  it('still scrolls from one place, so Appearance did not put a scroll on the frame path', () => {
    const program = code('highlighter.ts');
    expect(program.match(/scrollBy\(/g)).toHaveLength(1);
    for (const perWord of ['tick', 'showWord', 'showAt', 'start']) {
      expect({ perWord, scrolls: /nudge|scrollBy|settle|place(Once)?\(/.test(fn(program, perWord)) }).toEqual({ perWord, scrolls: false });
    }
  });
});

describe('tapping a word reads from there, and it is a tap (ADR 0020)', () => {
  it('keeps native selection while observing passive lookup gestures', () => {
    // A long press on text is iOS's selection gesture, and suppressing it means
    // `user-select: none` — which silently stops ::highlight() from painting
    // (notes/NOTES_2026-09-19.md, 20:10, bisected on the device). So the long press
    // stays the platform's; lookup observes selection and passive touch events.
    const program = code('highlighter.ts');
    expect(program).toContain("addEventListener('click', tapped, false)");
    for (const gesture of ['contextmenu', 'selectstart', 'longpress', 'mousedown']) {
      expect({ gesture, listened: program.includes("'" + gesture + "'") }).toEqual({ gesture, listened: false });
    }
    expect(program).not.toContain('user-select: none');
    expect(program).toContain("addEventListener('touchstart', selectionStarted, { passive: true })");
    expect(program).toContain("addEventListener('selectionchange', selectionChanged)");
    expect(fn(program, 'tapped')).toContain('lookupHeld || Date.now() < suppressTapUntil');
  });

  it('holds following through lookup and restores the prior browsing state (#71, #73)', () => {
    const program = highlighterSource();
    const hold = fn(program, 'holdForLookup');
    expect(hold.indexOf('beforeLookupBrowsing = browsing;')).toBeLessThan(hold.indexOf('setBrowsing(true);'));
    expect(hold).toContain('halt();');
    const close = fn(program, 'closeLookup');
    expect(close).toContain('setBrowsing(beforeLookupBrowsing);');
    expect(close).toContain('state.placed = new WeakSet();');
    expect(close).toContain('if (resumeFollow && !browsing && state)');
    const dispatch = fn(program, 'dispatch');
    const returning = dispatch.slice(dispatch.indexOf("message.kind === 'return'"), dispatch.indexOf("message.kind === 'followOnly'"));
    expect(returning.indexOf('if (lookupHeld) return;')).toBeLessThan(returning.indexOf('setBrowsing(false);'));
    expect(returning).toContain('lookupKeepBrowsing = false;');
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

describe('wherever no section is drawn, the page is the app’s own (#27, ADR 0043)', () => {
  /** The library's own default theme, evaluated out of the installed package rather than copied from it. */
  const libraryTheme = (): Record<string, Record<string, string>> => {
    const context = library('context.js');
    const start = context.indexOf('{', context.indexOf('const defaultTheme = exports.defaultTheme = {'));
    return vm.runInNewContext('(' + context.slice(start, context.indexOf('\n};', start) + 2) + ')');
  };

  it('colours the WebView itself with the theme’s page, which by default is white', () => {
    // The two facts the white rests on. Before the first section is displayed,
    // below a short document, and between sections in a fast fling, what shows is
    // the WebView's own colour — and the library sets it from `theme.body.background`,
    // whose default is `#fff`.
    pin(library('View.js'), 'backgroundColor: theme.body.background,', 'the installed @epubjs-react-native/core View.js');
    expect(libraryTheme().body).toEqual({ background: '#fff' });
  });

  it('hands the reader the library’s own theme with nothing changed but a transparent page', () => {
    // Transparent, so the WebView is not opaque and the reader's own view behind it
    // shows: `INK.page`, dark under the dark theme and `#ffffff` under the light
    // one. Every other rule is the library's, so the light theme looks as it did.
    const library = libraryTheme();
    expect(READER_THEME).toEqual({ ...library, body: { ...library.body, background: 'transparent' } });
  });

  it('gives it to <Reader> through readerProps, declared and given', () => {
    const bridge = code('reader-bridge.ts');
    pin(bridge, 'defaultTheme: Theme;', 'reader-bridge.ts, the readerProps type');
    pin(bridge, 'defaultTheme: READER_THEME,', 'reader-bridge.ts, the readerProps value');
  });

  it('puts it in the provider before the first WebView is created, not when the template starts', () => {
    // The WebView's colour is the provider's theme, not the prop, and the provider
    // starts on the library's white and takes the prop only from the template's
    // `onStarted`. A WebView created white stays white after that — until the first
    // section covers it — so the first open after a launch flashed white in 6 of 6
    // runs with the prop alone (#27). The provider lives above the navigator and
    // keeps what it is given, so this happens once per launch.
    const context = library('context.js');
    const initial = context.slice(context.indexOf('const initialState = {'), context.indexOf('};', context.indexOf('const initialState = {')));
    pin(initial, 'theme: defaultTheme,', 'the installed @epubjs-react-native/core context.js, initialState');
    pin(library('View.js'), 'changeTheme(defaultTheme);', 'the installed @epubjs-react-native/core View.js, onStarted');
    pin(code('reader-bridge.ts'), 'if (theme !== READER_THEME) changeTheme(READER_THEME);', 'reader-bridge.ts');
  });
});

describe('every section the page shows is adopted, however fast it arrived (ADR 0036)', () => {
  /**
   * **Issue #34.** A fast fling left a chapter white on a dark page, at the book's
   * own size, answering no tap. epub.js had displayed it after the last
   * `relocated`, and the program's `rendered` listener — the one meant to catch
   * exactly that — had never run once. Measured 2026-09-22
   * (notes/NOTES_2026-09-22.md): 6 of 15 flings towards the start of a book left a
   * displayed chapter without the program's stylesheet, and 0 of 15 once the
   * library's own `rendered` listener could no longer throw.
   *
   * Structural, like the rest of this file: the fling, the queue and the hook
   * chain live in Safari. `test/manual-test/scrolling-and-theme/scroll-theme.cjs` is the run that
   * shows it on the device.
   */
  it('adopts from epub.js’s content hook, and not from its rendered event', () => {
    const program = code('highlighter.ts');
    pin(program, 'rendition.hooks.content.register(sweep);', 'highlighter.ts');
    expect(program).not.toContain("rendition.on('rendered'");
  });

  it('because the library’s own rendered listener serialises the whole Section, which is cyclic', () => {
    // Evaluated in the reader's WebView: `TypeError: JSON.stringify cannot
    // serialize cyclic structures`. A Section's spine hooks are Hook objects whose
    // `context` is themselves, so this throws for every section.
    pin(library('template.js'), "type: 'onRendered',\n          section: section,", 'the installed @epubjs-react-native/core template.js');
  });

  it('and epub.js’s emitter stops at a listener that throws, while its hook chain goes on past one', () => {
    const epub = library('epubjs.js');
    // The emitter has no try, so a throw ends the dispatch. The template registers
    // its listener before the program exists, so every later listener starves.
    pin(epub, 'for (r = r.slice(), e = 0; (n = r[e]); ++e) d.call(n, this, s);', "the bundled epub.js, the emitter's emit");
    // The hook chain runs each hook in its own try.
    pin(epub, 'try {\n                var r = n.apply(e, t);\n              } catch (t) {\n                console.log(t);\n              }', 'the bundled epub.js, Hook.trigger');
    // And it runs for every section document epub.js displays, before `rendered`.
    pin(
      epub,
      '? this.hooks.content.trigger(t.contents, this).then(() => {\n                    this.emit(l.c.RENDITION.RENDERED, t.section, t);',
      'the bundled epub.js, Rendition.afterDisplayed',
    );
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
    // Whatever else changes, this must not: the page's one scroll reaches epub.js
    // as a finger scroll does, which is what makes it append the section the
    // reading is walking into. A scroll it was told to ignore renders nothing new.
    expect(fn(program, 'nudge')).toContain('rendition.manager.scrollBy(0, by, false)');
  });
});

describe('a section the page has not reached is not a highlight that failed', () => {
  const program = highlighterSource();

  it('is silent only while the page follows the reading, which is what brings the section back', () => {
    // Since renderAhead this happens at every section boundary of a document whose
    // sections are taller than their text, and follow() answers it by displaying the
    // section — so calling it a highlight that could not be drawn would leave that
    // sentence standing while the highlight was, in fact, drawn a moment later.
    // And while the owner is browsing (#52), whose return brings it back.
    pin(fn(program, 'awaited'), 'return !!(state && (state.follow || browsing) && offPage(ranges));', 'highlighter.ts, function awaited');
    pin(
      fn(program, 'showUtterance'),
      'if (!awaited(state.utteranceRanges)) report(why(state.utteranceRanges));',
      'highlighter.ts, function showUtterance',
    );
    const speak = program.slice(program.indexOf("message.kind === 'speak'"), program.indexOf("message.kind === 'correct'"));
    expect(speak).toContain('var shown = showUtterance();');
    expect(speak).toContain('if (message.reveal || (begins && !browsing)) follow(shown);');
  });

  it('is silent for the word by the same rule, since the correction arrives before the section does (#50)', () => {
    // play() cues and then corrects at once, so the first thing to meet a section on
    // its way was the word, and it reported unconditionally: "Block 6.13 is in
    // section 6, which is not on the page", under a highlight drawn half a second
    // later (measured 2026-09-23 19:28). The word and the Utterance now wait by one
    // predicate, so they cannot disagree about whether a section is coming.
    pin(fn(program, 'showWord'), 'if (!awaited(ranges)) report(why(ranges));', 'highlighter.ts, function showWord');
    expect(program.match(/awaited\(/g)).toHaveLength(3);
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

describe('a section follow() asked for is centred after epub.js has placed it (#50)', () => {
  /**
   * Measured on the owner's book on 2026-09-23 at 19:28 with a probe on every
   * scroll: Play with the page scrolled away from Block 6.13 displayed its section,
   * `attach()` centred it from inside epub.js's content hook by scrolling 725 px,
   * and the same display then ran its own `moveTo` to the Block's CFI and scrolled
   * 958 px more. The sentence was painted and sat 724 px above the top of the
   * screen. Structural, like the rest of this file; `test/manual-test/place-and-following/follow-probe.cjs`
   * is the run that shows it on the device.
   */
  const program = highlighterSource();

  it('marks the section it asked for on the Utterance it asked for it for', () => {
    const follow = fn(program, 'follow');
    pin(follow, 'state.awaiting = record.section;', 'highlighter.ts, function follow');
    expect(follow.indexOf('state.awaiting = record.section;')).toBeLessThan(follow.indexOf('rendition.display(record.cfi);'));
    // Per Utterance: a new cue starts with nothing awaited.
    const speak = program.slice(program.indexOf("message.kind === 'speak'"), program.indexOf("message.kind === 'correct'"));
    pin(speak, 'awaiting: null', "highlighter.ts, the 'speak' branch");
  });

  it('paints that section at once and places it on the next frame, through settle', () => {
    const attach = fn(program, 'attach');
    pin(attach, 'if (state.awaiting === contents.sectionIndex) {', 'highlighter.ts, function attach');
    pin(
      attach,
      'window.requestAnimationFrame(function () {\n        if (state === mine) settle(SETTLE_FRAMES, 0);',
      'highlighter.ts, function attach',
    );
    // The highlight is not deferred with it: only the scroll waits for epub.js.
    // And the word is painted quietly, so it does not start a glide of its own
    // in the middle of epub.js's display.
    expect(attach.indexOf('var built = showUtterance();')).toBeLessThan(attach.indexOf('if (state.awaiting ==='));
    expect(attach.indexOf('showAt(state.next - 1, true);')).toBeLessThan(attach.indexOf('if (state.awaiting ==='));
    // Any other arrival has no scroll of epub.js's behind it and is placed at once.
    pin(attach, '    } else {\n      placeOnce(built);\n    }', 'highlighter.ts, function attach');
  });

  it('because epub.js runs the content hook before the moveTo of the same display', () => {
    const epub = library('epubjs.js');
    // IframeView.display: onDisplayed — which reaches the content hook — before the
    // promise add() returns is resolved.
    pin(
      epub,
      'this.emit(h.c.VIEWS.DISPLAYED, this),\n                      this.onDisplayed(this),\n                      (this.displayed = !0),\n                      e.resolve(this);',
      'the bundled epub.js, IframeView.display',
    );
    // DefaultViewManager.display: the moveTo to the target, once add() has resolved.
    pin(
      epub,
      'this.add(t, o)\n              .then(\n                function (t) {\n                  if (e) {\n                    let i = t.locationOf(e),\n                      n = t.width();\n                    this.moveTo(i, n);',
      'the bundled epub.js, DefaultViewManager.display',
    );
  });

  it('and not on the display’s promise, which the library resolves as soon as the section’s iframe starts loading', () => {
    // Measured 2026-09-23: every section iframe's `about:srcdoc` load reaches the
    // library's onShouldStartLoadWithRequest, which answers with
    // `goToLocation('about:srcdoc')` — and epub.js resolves the display in flight
    // whenever another is asked for. Before the section arrives, not on arrival.
    pin(library('View.js'), "goToLocation(request.url.replace(request.mainDocumentURL, ''));", 'the installed @epubjs-react-native/core View.js');
    pin(
      library('epubjs.js'),
      'this.displaying && this.displaying.resolve(),\n            this.q.enqueue(this._display, t)',
      'the bundled epub.js, Rendition.display',
    );
    expect(fn(program, 'follow')).not.toContain('.then(');
  });
});

describe('browsing leaves the page where the owner put it (#52)', () => {
  /**
   * Measured on the owner's book on 2026-09-23 at 23:30, with a probe on every
   * scroll: the reading paused in section 14, a display of section 16 — the call a
   * Contents row makes — rendered 16, 15 and then 14, and attach() centred the
   * paused sentence as 14 arrived (`scrollBy -7424`, from
   * `centre<centreOnce<attach<sweep`). epub.js then trimmed 16 away, and the page
   * was back on the reading. Structural, like the rest of this file;
   * `test/manual-test/place-and-following/browse-probe.cjs` is the run on the device.
   */
  const program = highlighterSource();
  const dispatch = fn(program, 'dispatch');
  const branch = (kind: string, next: string) => dispatch.slice(dispatch.indexOf("message.kind === '" + kind + "'"), dispatch.indexOf("message.kind === '" + next + "'"));

  it('starts browsing on the message a Contents row sends, and ends it when asked or at a sentence the owner can see (#71)', () => {
    pin(branch('browse', 'return'), 'setBrowsing(true);', "highlighter.ts, the 'browse' branch");
    const speak = branch('speak', 'correct');
    pin(speak, 'if (message.reveal && !lookupHeld && !lookupKeepBrowsing) setBrowsing(false);', "highlighter.ts, the 'speak' branch");
    // Before the state is replaced, so that the new one is built knowing it.
    expect(speak.indexOf('if (message.reveal && !lookupHeld && !lookupKeepBrowsing) setBrowsing(false);')).toBeLessThan(speak.indexOf('state = {'));
    // Zotero-TTS's rule (ADR 0050): the reading moving on takes the page back
    // only at a sentence whose first line the owner can see, measured on the
    // sentence just painted and before anything follows it.
    const recover = 'if (!message.reveal && begins && browsing && !lookupHeld && !lookupKeepBrowsing && onVisiblePage(shown)) setBrowsing(false);';
    pin(speak, recover, "highlighter.ts, the 'speak' branch");
    expect(speak.indexOf('var shown = showUtterance();')).toBeLessThan(speak.indexOf(recover));
    expect(speak.indexOf(recover)).toBeLessThan(speak.indexOf('follow(shown);'));
    // M, and the player collapsing, which brings a browsed page back as M would.
    pin(branch('return', 'followOnly'), 'setBrowsing(false);', "highlighter.ts, the 'return' branch");
    pin(branch('followOnly', 'speak'), "if (only && browsing) dispatch({ kind: 'return' });", "highlighter.ts, the 'followOnly' branch");
    // The declaration, and the one place it is written.
    pin(program, 'var browsing = false;', 'highlighter.ts, the declaration');
    expect(program.match(/\bbrowsing = /g)).toHaveLength(2);
    pin(fn(program, 'setBrowsing'), 'browsing = !!value;', 'highlighter.ts, function setBrowsing');
  });

  it('asks whether the sentence can be seen as the owner sees it now, and never while the page still moves', () => {
    const visible = fn(program, 'onVisiblePage');
    // A fling coasting on is the owner's, and a glide would fight it.
    pin(visible, 'if (moving()) return false;', 'highlighter.ts, function onVisiblePage');
    // What can be seen now, above whatever the player covers at this moment —
    // not lineAt(), the open player the line position is measured against.
    pin(visible, 'return middle >= top && middle <= top + visibleOf(view);', 'highlighter.ts, function onVisiblePage');
    expect(visible).not.toContain('lineAt(');
  });

  it('moves nothing by itself while browsing: not a section of the reading arriving, not an Appearance change, not a word', () => {
    pin(fn(program, 'placeOnce'), 'if (!state || !state.follow || browsing) return;', 'highlighter.ts, function placeOnce');
    pin(fn(program, 'settle'), 'if (!state || !state.follow || browsing) return;', 'highlighter.ts, function settle');
    pin(fn(program, 'followWord'), 'if (!state || !state.follow || browsing || !state.words) return;', 'highlighter.ts, function followWord');
    // A glide under way stops the frame browsing begins.
    pin(fn(program, 'glideStep'), 'if (!state || !state.follow || browsing) {', 'highlighter.ts, function glideStep');
    pin(branch('browse', 'return'), 'halt();', "highlighter.ts, the 'browse' branch");
    // attach() and the Appearance branch reach the page only through those.
    const attach = fn(program, 'attach');
    expect(attach).not.toMatch(/\bplace\(|bring\(|nudge\(/);
    expect(attach).not.toContain('scrollBy');
    expect(branch('appearance', 'measured')).not.toMatch(/\bplace(Once)?\(|bring\(/);
  });

  it('lets a repaint keep whether the page follows, and only a revealed highlight or a followed cue scroll to it', () => {
    const speak = branch('speak', 'correct');
    pin(speak, 'var following = message.reveal || begins || !!(state && state.follow);', "highlighter.ts, the 'speak' branch");
    pin(speak, 'follow: following,', "highlighter.ts, the 'speak' branch");
    // A cue the reading moved on to follows only a page that is following: one
    // the owner took away displays nothing, even for a section not on the page.
    pin(speak, 'if (message.reveal || (begins && !browsing)) follow(shown);', "highlighter.ts, the 'speak' branch");
  });

  it('counts only a new Utterance as a sentence beginning, so a re-cue ends no Browsing and moves no page (#71)', () => {
    // A speed change or a Voice switched mid-sentence cues the Utterance being
    // spoken again, with `recover`. Nothing began: a page the owner took away
    // stays away, and a following page is left for the correction's word.
    const speak = branch('speak', 'correct');
    const begins = 'var begins = !!message.recover && !(state && state.utterance === message.utterance);';
    pin(speak, begins, "highlighter.ts, the 'speak' branch");
    // Read off the old state, before it is replaced.
    expect(speak.indexOf(begins)).toBeLessThan(speak.indexOf('state = {'));
    // And nothing downstream reads `recover` itself.
    expect(speak.slice(speak.indexOf(begins) + begins.length)).not.toContain('message.recover');
  });

  it('stops the page on the frame the owner pauses, and not on the hold after a Clip cued while paused (#71)', () => {
    pin(branch('hold', 'browse'), 'if (message.stop) halt();', "highlighter.ts, the 'hold' branch");
    const reading = readFileSync(new URL('../../src/app/use-reading.ts', import.meta.url).pathname, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // pause(), and the reading ending on a failure: both the owner's stop.
    expect(reading.match(/bridgeRef\.current\?\.hold\(\{ stop: true \}\);/g)).toHaveLength(2);
    // The paused cue's hold stops the tick loop only.
    pin(reading, 'if (!playIntent.current) bridgeRef.current?.hold();', 'use-reading.ts, the clock');
  });

  it('counts a finger dragging the page as browsing, and a tap as nothing of the kind', () => {
    const dragged = fn(program, 'dragged');
    // A new finger is a new identifier, measured from where it first moved.
    pin(dragged, 'if (touch.identifier !== touchId) {', 'highlighter.ts, function dragged');
    // Measured on the screen: in a section document the page's own scroll under
    // the finger is added back, or a drag the phone scrolls reads as standing still.
    pin(dragged, 'touchTop = top;', 'highlighter.ts, function dragged');
    pin(dragged, 'var scrolled = event.currentTarget === stage ? 0 : top - touchTop;', 'highlighter.ts, function dragged');
    pin(dragged, 'if (Math.abs(touch.clientY - touchY - scrolled) > DRAG_PX) setBrowsing(true);', 'highlighter.ts, function dragged');
    // A page that only follows (the player collapsed, #71) is neither stopped
    // nor browsed by a finger: the first thing it asks.
    pin(dragged, 'if (followOnly) return;', 'highlighter.ts, function dragged');
    expect(dragged.indexOf('if (followOnly) return;')).toBeLessThan(dragged.indexOf('halt();'));
    // Any move of a finger stops a glide where the page is (ADR 0050), before it
    // is known to be a drag — and still from touchmove, never touchstart.
    expect(dragged.indexOf('halt();')).toBeGreaterThan(-1);
    expect(dragged.indexOf('halt();')).toBeLessThan(dragged.indexOf('if (touch.identifier !== touchId) {'));
    pin(fn(program, 'adopt'), "contents.document.addEventListener('touchmove', dragged, { passive: true });", 'highlighter.ts, function adopt');
    // The margins between the section documents, heard once on the container.
    pin(program, "if (stage) stage.addEventListener('touchmove', dragged, { passive: true });", 'highlighter.ts, the install');
    expect(program.match(/addEventListener\('touchmove'/g)).toHaveLength(2);
    // A tap is still a click, and a click is not heard as a drag. The long press
    // stays the platform's; lookup only observes its passive events.
    expect(fn(program, 'tapped')).not.toContain('browsing');
  });

  /**
   * **Issue #79.** Once the page could no longer be magnified, a pinch still
   * switched the player's A to M, measured on the simulator: its fingers move
   * further than a tap's jitter, and `dragged` took that for a drag. The owner's
   * rule is that a pinch does nothing at all. Run here, `landed` and `dragged` as
   * the program has them, against touches a test writes; the rest of the program
   * is replaced by counters.
   */
  describe('a pinch, run', () => {
    interface Page {
      halts(): number;
      browsing: boolean[];
      landed(event: unknown): void;
      dragged(event: unknown): void;
    }
    const page = (): Page =>
      vm.runInNewContext(
        [
          'var stage = { scrollTop: 0 };',
          'function scroller() { return stage; }',
          'var lookupHeld = false; var followOnly = false;',
          'var touchId = null; var touchY = null; var touchTop = null; var pinched = false; var DRAG_PX = 10;',
          'var halted = 0; function halt() { halted += 1; }',
          'var browsing = []; function setBrowsing(value) { browsing.push(value); }',
          fn(program, 'landed'),
          fn(program, 'dragged'),
          '({ halts: function () { return halted; }, browsing: browsing, landed: landed, dragged: dragged });',
        ].join('\n'),
      ) as Page;
    /** The fingers down, as `[identifier, clientY]`, in a section document whose page has not scrolled. */
    const fingers = (...down: [number, number][]) => ({
      touches: down.map(([identifier, clientY]) => ({ identifier, clientY })),
      currentTarget: {},
    });

    it('still takes one finger dragging the page for Browsing, which is what makes the rest mean anything', () => {
      const p = page();
      p.landed(fingers([1, 300]));
      p.dragged(fingers([1, 300]));
      p.dragged(fingers([1, 340]));
      expect(p.halts()).toBe(2);
      expect(p.browsing).toEqual([true]);
    });

    it('neither browses nor stops a glide when a second finger lands and the two move apart', () => {
      const p = page();
      p.landed(fingers([1, 300]));
      p.landed(fingers([1, 300], [2, 400]));
      for (let step = 1; step <= 6; step += 1) p.dragged(fingers([1, 300 - step * 20], [2, 400 + step * 20]));
      expect(p.halts()).toBe(0);
      expect(p.browsing).toEqual([]);
    });

    it('ignores the finger left on the page after the other lifts, until a new gesture begins', () => {
      const p = page();
      p.landed(fingers([1, 300]));
      p.landed(fingers([1, 300], [2, 400]));
      p.dragged(fingers([1, 280], [2, 420]));
      // The second finger lifts; the first goes on moving, far past a tap.
      p.dragged(fingers([1, 240]));
      p.dragged(fingers([1, 120]));
      expect(p.halts()).toBe(0);
      expect(p.browsing).toEqual([]);
      // Every finger lifts, and the next gesture is one finger: a drag again.
      p.landed(fingers([3, 500]));
      p.dragged(fingers([3, 500]));
      p.dragged(fingers([3, 440]));
      expect(p.browsing).toEqual([true]);
    });

    it('knows a pinch by its moves alone when the second finger landed where it was not heard', () => {
      const p = page();
      p.landed(fingers([1, 300]));
      p.dragged(fingers([1, 300], [2, 400]));
      p.dragged(fingers([1, 260], [2, 440]));
      expect(p.halts()).toBe(0);
      expect(p.browsing).toEqual([]);
    });

    it('is heard wherever a finger is, in every section document and in the margins between them', () => {
      pin(fn(program, 'adopt'), "contents.document.addEventListener('touchstart', landed, { passive: true });", 'highlighter.ts, function adopt');
      pin(program, "if (stage) stage.addEventListener('touchstart', landed, { passive: true });", 'highlighter.ts, the install');
      // Only landed writes a gesture's start; dragged may only ever set it.
      expect(program.match(/pinched = /g)).toHaveLength(3);
      pin(fn(program, 'landed'), 'pinched = count > 1;', 'highlighter.ts, function landed');
    });
  });

  it('sends the browse message before the display that moves the page', () => {
    const bridge = code('reader-bridge.ts');
    const browse = bridge.slice(bridge.indexOf('const browse = useCallback('), bridge.indexOf('const onWebViewMessage = useCallback('));
    pin(browse, "send({ kind: 'browse' });", 'reader-bridge.ts, browse');
    expect(browse.indexOf("send({ kind: 'browse' });")).toBeLessThan(browse.indexOf('goToLocation(String(index));'));
  });

  it('reveals a cue or a shown sentence unless the caller says not to', () => {
    const bridge = code('reader-bridge.ts');
    expect(bridge.match(/reveal: latest\.current\.follow !== false && options\?\.reveal !== false/g)).toHaveLength(2);
    // And a cue recovers only when asked to: the screen says which cues are the
    // reading moving on (#71).
    expect(bridge.match(/recover: latest\.current\.follow !== false && options\?\.recover === true/g)).toHaveLength(1);
  });
});

describe('A or M, and M bringing the page back (#71, #53, ADR 0050)', () => {
  /** An app file's code, without its comments, as `code()` reads this directory's. */
  const appCode = (name: string): string =>
    readFileSync(new URL('../../src/app/' + name, import.meta.url).pathname, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  const program = highlighterSource();
  const dispatch = fn(program, 'dispatch');
  const branch = (kind: string, next: string) => dispatch.slice(dispatch.indexOf("message.kind === '" + kind + "'"), dispatch.indexOf("message.kind === '" + next + "'"));

  it('tells the player whether the page follows only when it changes, and never per word', () => {
    const set = fn(program, 'setBrowsing');
    pin(set, 'if (following === announced) return;', 'highlighter.ts, function setBrowsing');
    pin(set, 'post({ type: FOLLOWING, following: following });', 'highlighter.ts, function setBrowsing');
    expect(program.match(/type: FOLLOWING\b/g)).toHaveLength(1);
    // Nothing on the frame path or the word path posts anything (ADR 0005).
    for (const name of ['tick', 'showWord', 'followWord', 'glideStep']) expect(fn(program, name)).not.toMatch(/\bpost\(|setBrowsing\(/);
  });

  it('goes back to the sentence being shown, keeping its words, and starts nothing', () => {
    const back = branch('return', 'followOnly');
    pin(back, 'state.follow = true;', "highlighter.ts, the 'return' branch");
    pin(back, 'follow(build(state.utteranceRanges));', "highlighter.ts, the 'return' branch");
    // No new state: the words of a Clip that is playing stay where they were.
    expect(back).not.toContain('state = {');
    const bridge = code('reader-bridge.ts');
    const returning = bridge.slice(bridge.indexOf('const returnToReading = useCallback('), bridge.indexOf('const followOnly = useRef('));
    pin(returning, 'if (utterance === null || cued.current?.utterance === utterance) {', 'reader-bridge.ts, returnToReading');
    pin(returning, "send({ kind: 'return' });", 'reader-bridge.ts, returnToReading');
    pin(returning, 'show(utterance);', 'reader-bridge.ts, returnToReading');
    const reading = appCode('use-reading.ts');
    const start = reading.indexOf('const returnToReading = useCallback(');
    const hook = reading.slice(start, reading.indexOf('}, []);', start));
    pin(hook, 'bridgeRef.current?.returnToReading(atRef.current);', 'use-reading.ts, returnToReading');
    // M moves the page and nothing else: no seek, no engine, no Play.
    expect(hook).not.toMatch(/engineRef|seekTo|pointAt|play\(|playIntent/);
  });

  it('reveals only the first cue after Play; the reading moving on recovers instead', () => {
    const reading = appCode('use-reading.ts');
    pin(reading, 'const asked = playIntent.current && revealCue.current;', 'use-reading.ts, the clock');
    pin(
      reading,
      'bridgeRef.current?.clock.onClip(cue, !playIntent.current ? { reveal: false } : asked ? { reveal: true } : { reveal: false, recover: true });',
      'use-reading.ts, the clock',
    );
    const play = reading.slice(reading.indexOf('const play = useCallback('), reading.indexOf('const pause = useCallback('));
    pin(play, 'playIntent.current = true;\n    revealCue.current = true;', 'use-reading.ts, play');
    const start = reading.indexOf('const pause = useCallback(');
    pin(reading.slice(start, reading.indexOf('}, []);', start)), 'revealCue.current = false;', 'use-reading.ts, pause');
  });

  it('shows A as a mark with no press, and M as the one button', () => {
    const player = appCode('player.tsx');
    const mark = player.slice(player.indexOf('function FollowingMark('), player.indexOf('function Transport('));
    // From A's branch to the function's own return, which is M's: two spaces in.
    const a = mark.slice(mark.indexOf('if (following) {'), mark.indexOf('\n  return (', mark.indexOf('if (following) {')));
    expect(a).toContain('accessibilityLabel="Following the reading"');
    expect(a).not.toMatch(/onPress|Pressable/);
    pin(mark, 'accessibilityLabel="Return to the reading" onPress={onReturn}', 'player.tsx, FollowingMark');
    // In the slot beside the Voice name, and only in the open player.
    pin(player, '<FollowingMark following={following} onReturn={onReturn} />', 'player.tsx, the head row');
    const folded = player.indexOf('if (collapsed && notes.length === 0) {');
    expect(player.slice(folded, player.indexOf('\n  return (', folded))).not.toContain('FollowingMark');
  });

  it('only follows while the player is collapsed, through epub.js’s own overflow switch', () => {
    const lock = fn(program, 'lockPage');
    pin(lock, "stage.overflow('hidden');", 'highlighter.ts, function lockPage');
    pin(lock, 'stage.overflow(unlockedOverflow);', 'highlighter.ts, function lockPage');
    expect(lock).not.toMatch(/classList|\.style\b|createElement|preventDefault/);
    pin(branch('followOnly', 'speak'), 'lockPage(only);', "highlighter.ts, the 'followOnly' branch");
    // No listener that could stop the phone's own scrolling: every touchmove stays passive.
    expect(program).not.toContain('passive: false');
    const view = appCode('reading-view.tsx');
    // Exactly while the Reading Button is shown (#67's `chrome` is its negation).
    pin(view, 'const chrome = !(collapsed && notes.length === 0);', 'reading-view.tsx');
    pin(view, 'const followOnly = !chrome;', 'reading-view.tsx');
    pin(view, 'reading.bridge.setFollowOnly(followOnly);', 'reading-view.tsx');
  });
});

describe('nothing above the page changes while the page moves (#58, ADR 0045)', () => {
  /**
   * **Issue #58.** A fast scroll past the text epub.js had laid out jumped the
   * page by whole chapters and showed it empty. epub.js keeps the text still,
   * when it changes what lies above the viewport, by moving the scroll position
   * itself, and iOS drops that move while it is moving the page — under the
   * finger, in the fling's momentum, in the bounce at either end. Measured on
   * the owner's book (notes/NOTES_2026-09-24.md): a section of 5,362 px erased
   * above left the page 5,362 px further on, past the laid-out text and empty
   * for six frames; four sections prepended during a bounce left it four
   * sections back and empty for half a second. A relative `Element.scrollBy()`
   * was dropped the same way, and a scroll set while iOS was not moving the
   * page was kept every time.
   *
   * Structural, like the rest of this file: the fling and the dropped scroll
   * live in iOS. `test/manual-test/scrolling-and-theme/fling-jump.cjs` is the run that shows it.
   */
  const epub = library('epubjs.js');
  const continuous = epub.slice(epub.indexOf('afterScrolledTimeout: 10,'), epub.indexOf('addScrollListeners() {', epub.indexOf('afterScrolledTimeout: 10,')));
  const program = highlighterSource();

  it('slices the continuous manager, and no more', () => {
    expect(continuous).toContain('prepend(t) {');
    expect(continuous).toContain('trim() {');
    expect(continuous).not.toContain('addScrollListeners() {');
  });

  it('rests on epub.js scrolling the page itself whenever it changes what is above the viewport', () => {
    // Forward: update() destroys the view of a section that has left the screen
    // and trims 250 ms later; trim() erases the views above and scrolls back by
    // each one's height, which iOS drops mid-fling.
    pin(continuous, 'this.q.enqueue(this.trim.bind(this));', 'the bundled epub.js, ContinuousViewManager.update');
    pin(continuous, '? this.scrollTo(0, i - r.height, !0)', 'the bundled epub.js, ContinuousViewManager.erase');
    // Back: check() prepends when the scroll it last heard is within the offset
    // of the top, and a prepended view scrolls forward by its own growth once it
    // has laid out.
    pin(continuous, 'let h = s ? this.scrollLeft : this.scrollTop,', 'the bundled epub.js, ContinuousViewManager.check');
    pin(continuous, 'e && !s && (o = e);', 'the bundled epub.js, ContinuousViewManager.check');
    pin(continuous, 'g < 0 && p();', 'the bundled epub.js, ContinuousViewManager.check');
    pin(continuous, 'this.counter(t), (e.expanded = !0);', 'the bundled epub.js, ContinuousViewManager.prepend');
    pin(continuous, '? this.scrollBy(0, t.heightDelta, !0)', 'the bundled epub.js, ContinuousViewManager.counter');
  });

  it('parks a trim while the page moves', () => {
    const hold = fn(program, 'holdStill');
    pin(hold, 'manager.trim = function () {', 'highlighter.ts, function holdStill');
    pin(hold, 'if (!moving()) return trim.apply(this, arguments);', 'highlighter.ts, function holdStill');
    pin(hold, 'parked.trim = true;', 'highlighter.ts, function holdStill');
  });

  it('parks only the prepend of a check, and lets the rest of it go ahead', () => {
    const hold = fn(program, 'holdStill');
    pin(hold, 'manager.check = function (left, top) {', 'highlighter.ts, function holdStill');
    pin(hold, 'if (this.scrollTop - offset >= 0 || !moving()) return check.apply(this, arguments);', 'highlighter.ts, function holdStill');
    pin(hold, 'parked.check = true;', 'highlighter.ts, function holdStill');
    // check() reads the manager's own scrollTop, so for the one call it reads a
    // position that prepends nothing, and gets the real one back after.
    pin(hold, 'this.scrollTop = offset;', 'highlighter.ts, function holdStill');
    pin(hold, 'this.scrollTop = real;', 'highlighter.ts, function holdStill');
    expect(hold.indexOf('this.scrollTop = offset;')).toBeLessThan(hold.indexOf('return check.apply(this, arguments);\n      } finally {'));
  });

  it('knows the page moves from its scroll position, never from touches', () => {
    // The WebView's scroll events stop for 100 to 280 ms while a fling goes on,
    // whenever its main thread lays a section out, and a finger that lands on a
    // moving page reached the page's touch listeners in 1 to 4 of 10 flicks.
    const moving = fn(program, 'moving');
    pin(moving, 'performance.now() - scrolledAt < REST_MS', 'highlighter.ts, function moving');
    pin(moving, 'stage.scrollTop !== scrolledTop', 'highlighter.ts, function moving');
    expect(moving).not.toContain('touch');
    pin(program, "if (stage) stage.addEventListener('scroll', noteScroll, { passive: true });", 'highlighter.ts, the install');
  });

  /**
   * The program's own scroll is not the page moving (#71, ADR 0050), and nothing
   * else is let off: run, not read. Continuous scrolls the page every few frames
   * for as long as a sentence is read, and counted as moving it would park every
   * trim until the reading paused. What the gate is for — iOS moving the page,
   * which drops epub.js's correction — must still close it.
   *
   * The five functions are the program's own text, evaluated against a stage
   * whose `scrollTop` the test moves, a manager whose `scrollBy` is epub.js's
   * `container.scrollTop += y` in whole pixels, and a clock the test sets.
   */
  describe('the rest gate, run', () => {
    interface Gate {
      stage: { scrollTop: number };
      clock: { now: number };
      frames: ((now: number) => void)[];
      enqueued: string[];
      parked: { trim: boolean; check: boolean };
      nudge(by: number): void;
      noteScroll(): void;
      moving(): boolean;
      watch(): void;
    }

    const gate = (): Gate =>
      vm.runInNewContext(
        [
          'var stage = { scrollTop: 1000 };',
          'var clock = { now: 0 };',
          'var performance = { now: function () { return clock.now; } };',
          'var frames = [];',
          'var enqueued = [];',
          'var window = { requestAnimationFrame: function (f) { frames.push(f); return frames.length; } };',
          'var manager = { scrollBy: function (x, y) { stage.scrollTop += Math.round(y); }, trim: function () { return "trim"; }, check: function () { return "check"; },',
          '  q: { enqueue: function (task) { enqueued.push(task()); } } };',
          'var rendition = { manager: manager };',
          'function scroller() { return stage; }',
          'var REST_MS = 200; var REST_FRAMES = 4;',
          'var parked = { trim: false, check: false };',
          'var scrolledAt = -Infinity; var scrolledTop = null; var ownTop = null;',
          'var resting = { top: null, since: 0, frames: 0 }; var watching = false;',
          ...['nudge', 'noteScroll', 'moving', 'watchForRest', 'watch'].map((name) => fn(program, name)),
          '({ stage: stage, clock: clock, frames: frames, enqueued: enqueued, parked: parked, nudge: nudge, noteScroll: noteScroll, moving: moving, watch: watch });',
        ].join('\n'),
      ) as Gate;

    /** Run the frames asked for, one at a time, `every` ms apart, until none is asked for or `until`. */
    const run = (g: Gate, every: number, until: number, between?: () => void): void => {
      while (g.frames.length && g.clock.now < until) {
        g.clock.now += every;
        between?.();
        const frame = g.frames.shift()!;
        frame(g.clock.now);
      }
    };

    it('does not count the page as moving when it is where the program put it, before or after the scroll event', () => {
      const g = gate();
      g.clock.now = 1000;
      g.nudge(3);
      expect(g.stage.scrollTop).toBe(1003);
      expect(g.moving()).toBe(false);
      g.noteScroll();
      expect(g.moving()).toBe(false);
    });

    it('still counts a finger or a fling as moving, for REST_MS after its last scroll event', () => {
      const g = gate();
      g.clock.now = 1000;
      g.nudge(3);
      g.noteScroll();
      // iOS moves the page: newer than its event, then the event.
      g.stage.scrollTop = 1400;
      expect(g.moving()).toBe(true);
      g.noteScroll();
      g.clock.now = 1199;
      expect(g.moving()).toBe(true);
      g.clock.now = 1201;
      expect(g.moving()).toBe(false);
    });

    it('forgets the program\u2019s own position once anything else moves the page, so a fling back to it still holds a trim (#58)', () => {
      // The program leaves the page at 1003; a fling goes away and comes back to
      // rest against exactly 1003, bouncing there for a while (iOS's positions
      // and events). Remembered, 1003 would read as the program's and open the
      // gate mid-bounce.
      const g = gate();
      g.clock.now = 1000;
      g.nudge(3);
      g.noteScroll();
      g.parked.trim = true;
      g.watch();
      const path = [1100, 1300, 1200, 1050, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003, 1003];
      let step = 0;
      run(g, 1000 / 60, 4000, () => {
        if (step < path.length) {
          g.stage.scrollTop = path[step];
          g.noteScroll();
          step += 1;
        }
      });
      expect(g.enqueued).toEqual(['trim']);
      // Not before REST_MS after the last of the fling's events at 1003.
      expect(g.clock.now).toBeGreaterThan(1000 + (path.length * 1000) / 60 + 200);
    });

    it('does not let a program scroll during a fling paper over it', () => {
      // The page has moved since the last event, so the position that says the
      // page is moving is left to say it.
      const g = gate();
      g.clock.now = 1000;
      g.noteScroll();
      g.stage.scrollTop = 1600;
      g.nudge(2);
      expect(g.moving()).toBe(true);
    });

    it('runs a parked trim while the program drifts the page a pixel every few frames (Continuous)', () => {
      const g = gate();
      g.clock.now = 1000;
      g.parked.trim = true;
      g.watch();
      let frame = 0;
      run(g, 1000 / 60, 3000, () => {
        frame += 1;
        if (frame % 3 === 0) {
          g.nudge(1);
          g.noteScroll();
        }
      });
      expect(g.enqueued).toEqual(['trim']);
      // Well inside the reading, not at the end of it: REST_MS and REST_FRAMES from the start.
      expect(g.clock.now).toBeLessThan(1000 + 300);
    });

    it('keeps a parked trim parked while a fling moves the page, and runs it once the page rests', () => {
      const g = gate();
      g.clock.now = 1000;
      g.parked.trim = true;
      g.watch();
      // A fling decelerating over a second: iOS's positions, not the program's.
      let speed = 40;
      run(g, 1000 / 60, 2000, () => {
        if (speed > 0) {
          g.stage.scrollTop += speed;
          g.noteScroll();
          speed -= 1;
        }
      });
      expect(g.enqueued).toEqual(['trim']);
      // Not before the fling stopped (40 frames) and REST_MS after it.
      expect(g.clock.now).toBeGreaterThan(1000 + (40 * 1000) / 60 + 200);
    });
  });

  it('runs parked work once the position has held for REST_MS over REST_FRAMES frames, through the manager’s own queue', () => {
    const watch = fn(program, 'watchForRest');
    pin(watch, 'now - resting.since < REST_MS', 'highlighter.ts, function watchForRest');
    pin(watch, 'resting.frames < REST_FRAMES', 'highlighter.ts, function watchForRest');
    pin(watch, 'manager.q.enqueue(manager.trim.bind(manager));', 'highlighter.ts, function watchForRest');
    pin(watch, 'manager.q.enqueue(manager.check.bind(manager));', 'highlighter.ts, function watchForRest');
    pin(program, 'var REST_MS = 200;', 'highlighter.ts');
    pin(program, 'var REST_FRAMES = 4;', 'highlighter.ts');
  });

  it('holds the manager the page scrolls, once, as the program installs', () => {
    pin(program, 'holdStill(rendition.manager);', 'highlighter.ts, the install');
  });
});
