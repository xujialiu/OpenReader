/**
 * The WebView half: the highlighter, and the `requestAnimationFrame` loop.
 *
 * **Everything in the template literal below runs in Safari's JavaScript, not in
 * Hermes.** It is not type-checked, it cannot import anything, and nothing in the
 * type system says so — which is why `README.md` puts it in a file of its own and
 * why this file contains nothing else. Read it as a small program, not as part of
 * the app: `var`, no arrow functions, no template literals of its own, and every
 * name it touches is either its own or one the library's template already put on
 * `window` (`book`, `rendition`, `ReactNativeWebView`).
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
 *   epub.js replaces a section's document as the reader moves through the book —
 *   under `scrolled-continuous` several are alive at once and the manager destroys
 *   the ones that scroll out of reach — so a remembered node, element or
 *   `Contents` is a reference into a document that may already have lost its
 *   browsing context, and `isConnected` does not say so, because a detached
 *   document still owns its nodes and they still report themselves connected to
 *   it. The text nodes are therefore resolved against the live document at paint
 *   time, cached per document rather than per Block, so the walk happens once when
 *   a section renders and never per word. A device run found the other way round:
 *   a correct `Range` built in a dead document, painting nothing, and every step
 *   looking right from the inside.
 * - **The page following the voice.** The reader is mounted with
 *   `flow: 'scrolled-continuous'` (ADR 0011), and when a Clip starts the document
 *   is scrolled so the Utterance being spoken is **centred**. It is measured from
 *   the `Range`s that were just painted and the scroll container's own box, and it
 *   runs once per Utterance on the Clip cue the bridge already sends — no message
 *   of its own, and nothing at the `requestAnimationFrame` rate (ADR 0005).
 *   Centred in what can be *seen*: ADR 0020's player floats over the bottom of
 *   that container and tells this file how much it covers.
 * - **Where a tap landed.** The only thing here that starts on the page rather
 *   than arriving from the app: a tap hit-tests to a text node, the enclosing
 *   Block's id and the offset within it cross the bridge, and the app turns that
 *   into an Utterance to read from (ADR 0020). It is a `click` and not a long
 *   press, for the reason `SELECTABLE` below exists.
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
 * - **How the text is set.** The owner's **Appearance** (ADR 0019, ADR 0021)
 *   arrives as finished CSS and goes into the same stylesheet as the highlight
 *   rules, because one `<style>` element is enough and a second would be a second
 *   thing to keep installed. A change reflows every line in the book, so the
 *   Utterance being spoken is brought back to the middle afterwards — which is
 *   the opposite of what the `inset` message does, and the difference is that the
 *   player collapsing moves not one character while a font change moves all of
 *   them.
 *
 * The DOM mutations it makes are a `<style>` element per rendered document,
 * because a `::highlight()` rule has to live in the document it styles, and one
 * attribute on each element the Document itself centres or sets to the right,
 * so that the owner's Text Alignment can pass over it (ADR 0034). Both happen
 * once per document, not once per word, and neither changes any text — an
 * Appearance change rewrites the element's contents and renumbers nothing, so
 * no Block's text, offset, span or CFI moves.
 */

import { isPixelSize, PLAIN_BODY_TEXT_SIZE } from './body-text';
import type { HighlightMessage } from './messages';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, PROBLEM_MESSAGE, TAP_MESSAGE } from './messages';

/** The two Highlight Levels of ADR 0005, as CSS custom highlight names. The word rides on top of the Utterance. */
export const UTTERANCE_HIGHLIGHT = 'openreader-utterance';
export const WORD_HIGHLIGHT = 'openreader-word';

/** The name the program installs itself under. Both halves have to agree on it, so it is written once. */
export const HIGHLIGHTER = '__openReaderHighlighter';

/**
 * How the two levels are painted.
 *
 * CSS declarations, not an object, because `::highlight()` accepts only a handful
 * of properties — `color`, `background-color`, `text-decoration`, `text-shadow`,
 * `-webkit-text-stroke` — and a structured type would imply the rest work.
 */
export interface HighlightStyles {
  /** Declarations for `::highlight(openreader-utterance)`: the sentence being read. */
  utterance: string;
  /** Declarations for `::highlight(openreader-word)`: the word being spoken. Absent Word Timings, this is never painted. */
  word: string;
}

export const DEFAULT_HIGHLIGHT: HighlightStyles = {
  utterance: 'background-color: rgba(255, 196, 0, 0.22);',
  word: 'background-color: rgba(255, 168, 0, 0.62);',
};

/**
 * The fonts **Appearance** offers, as the owner reads them and as CSS names
 * them.
 *
 * A fixed list and not a field the owner types, which is what makes
 * `appearanceCss` unable to inject anything: a stack here is written by this
 * file, and an id that is not in this list produces no rule at all rather than a
 * rule built out of whatever the id said.
 *
 * **Every stack ends in a generic family.** That is the rule, and it is load
 * bearing rather than tidy: WebKit falls through a stack *per script*, so the
 * generic at the end is what a Chinese book gets when the named face has no
 * glyphs for it. `Georgia, serif` lays Latin out in Georgia and Chinese out in
 * the system's own serif CJK face, in the same paragraph.
 *
 * This list used to hold three categories — System, Serif, Sans-serif. ADR 0029
 * names faces instead, so that an owner choosing one is told which face they
 * got.
 *
 * **It names no CJK face, and that is a measurement rather than a rule.** The
 * list briefly held 苹方, 宋体, 楷体 and 圆体, because naming a CJK face is safe
 * as long as a generic is behind it — `"Songti SC", serif` wins where it has
 * glyphs and falls through everywhere else. That reasoning still holds. What
 * does not is the assumption that those faces exist: on the iOS 27.0 simulator
 * runtime `UIFont.familyNames` contains **only PingFang** of the four, so three
 * of the rows rendered identically to the system font and changed nothing.
 * A row that does nothing is worse than no row, so they came out. See ADR 0029
 * for what would have to be true to put them back.
 *
 * A Chinese book still gets both kinds through the generics: Georgia, Times and
 * Palatino give it a serif CJK face, Avenir and Helvetica a modern one. That is
 * what the three categories gave it, unchanged.
 *
 * `serif` and `sans` are gone as ids. `settings-storage.ts` migrates them to
 * `georgia` and `helvetica`, which are the faces those stacks already named
 * first, so an owner's existing choice keeps rendering exactly as it did.
 *
 * `preview` is the same face named for React Native rather than for CSS, so the
 * Appearance list can set each row in the font it offers. It is a **sample and
 * not a promise**: what a document gets for any other script is decided by the
 * fall-through, so Georgia and Palatino preview differently and still lay a
 * Chinese book out identically. `null` is the interface font, which is what
 * `system` means on this platform.
 */
export const READING_FONTS = [
  { id: 'system', label: 'System', stack: '-apple-system, system-ui, sans-serif', preview: null },
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, serif', preview: 'Georgia' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", serif', preview: 'Times New Roman' },
  { id: 'palatino', label: 'Palatino', stack: 'Palatino, serif', preview: 'Palatino' },
  { id: 'avenir', label: 'Avenir Next', stack: '"Avenir Next", sans-serif', preview: 'Avenir Next' },
  { id: 'helvetica', label: 'Helvetica', stack: 'Helvetica, sans-serif', preview: 'Helvetica' },
] as const;

/** One of `READING_FONTS`. Not a free string: see that list. */
export type ReadingFont = (typeof READING_FONTS)[number]['id'];

/**
 * The sizes the Font Size row steps through, in CSS pixels of body text: one
 * pixel at a time from 12 to 24, where people read and a pixel is visible, then
 * two at a time up to 32, where one pixel is not.
 */
export const FONT_SIZES = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32] as const;

/** One of `FONT_SIZES`. */
export type FontSize = (typeof FONT_SIZES)[number];

/** The size one tap away, or null where the ladder ends in that direction. */
export function stepFontSize(size: FontSize, direction: 1 | -1): FontSize | null {
  return FONT_SIZES[FONT_SIZES.indexOf(size) + direction] ?? null;
}

/**
 * The two **Text Alignments** (CONTEXT.md), in the order the Appearance menu
 * offers them: lines flush with the left margin only, or with both (ADR 0034).
 *
 * `left` is written as `start` in the stylesheet, the margin a line begins
 * from, so the word names what the owner sees in the books they read and a
 * right-to-left Document would still be ragged on the side it ends on.
 */
export const TEXT_ALIGNMENTS = ['left', 'justify'] as const;

/** One of `TEXT_ALIGNMENTS`. */
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

/**
 * The attribute the program puts on each element a Document itself centres or
 * sets to the right, so that the owner's Text Alignment passes over it (ADR
 * 0034). Written once, because `appearanceCss` excludes by it and the program
 * sets it.
 */
export const OWN_ALIGNMENT = 'data-openreader-own-alignment';

/**
 * The computed `text-align` values that mean the Document placed a line itself
 * rather than left it to the margin. Everything else — `start`, `left`,
 * `justify` — is body text, and takes the owner's choice. `end` and `right`
 * are the same side in a left-to-right Document; `-webkit-center` and
 * `-webkit-right` are what WebKit computes for the legacy `<center>` and
 * `align` attributes.
 */
export const OWN_ALIGNMENTS = ['center', 'right', 'end', '-webkit-center', '-webkit-right'] as const;

/**
 * How the document's text is set: **Appearance** (ADR 0019), which is the sheet
 * over the reader.
 *
 * **The size is the owner's and never the document's** (ADR 0030, which revises
 * ADR 0021 here). `size` is how big the body text of *every* Document is shown,
 * in CSS pixels, so two books typeset differently read at the same size and a
 * tap on + is always one step of what is on the screen.
 *
 * **The font still starts on the document's own.** `null` is "follow the
 * document", which a book's face keeps until the owner picks one.
 *
 * **The Text Alignment never does** (ADR 0034): it is the owner's from the
 * first page, and it reaches body text only — a heading, or a line the
 * Document centres or sets to the right, keeps the place the Document gave it.
 */
export interface Appearance {
  font: ReadingFont | null;
  size: FontSize;
  textAlignment: TextAlignment;
}

/** 16px, the Document's own font and justified body text, which is what a Document is read as until the owner says otherwise. */
export const DEFAULT_APPEARANCE: Appearance = { font: null, size: 16, textAlignment: 'justify' };

/** A quarter to four times, whatever the two numbers were: a measurement gone wrong must not make a book unreadable. */
const MIN_PERCENT = 25;
const MAX_PERCENT = 400;

/**
 * Every element the owner's Text Alignment reaches: all of them inside the body
 * but a heading, what is inside a heading, and what the Document aligned itself.
 *
 * **Not the two roots**, unlike the font. `text-align` inherits, so a heading
 * that declares nothing takes whatever `body` says; with the owner's value on
 * `body`, every such heading computed `justify` (measured on the Alignment
 * Fixture, notes 2026-09-22). Left alone, the roots keep the Document's own
 * answer for whatever inherits from them, and every element that holds body
 * text is reached directly anyway.
 */
const OWN = '[' + OWN_ALIGNMENT + ']';
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const BODY_TEXT = 'body *:not(' + [...HEADINGS, ...HEADINGS.map((heading) => heading + ' *'), OWN].join(', ') + ')';

/**
 * Appearance as CSS, for a Document whose own body text is `bodyTextSize`
 * pixels, or `PLAIN_BODY_TEXT_SIZE` while that is not known.
 *
 * **The size is one percentage over everything the Document set**, through
 * `text-size-adjust` rather than `font-size`. Measured on the iOS 27.0 simulator
 * inside the reader's own section documents (ADR 0030): it multiplies em, rem,
 * px and keyword sizes alike, so the body text lands on the owner's size and a
 * heading, a note or a chapter badge keeps its proportion to it. A root
 * `font-size` reaches only what is sized relative to the root, and a keyword such
 * as `x-small` is not.
 *
 * **On every element, not only the root.** A Document's own
 * `body { -webkit-text-size-adjust: 100% }` beat a root-only rule and left its
 * text at its own size; the same value declared on every element is still
 * applied once, not compounded through nesting. Both spellings, because that is
 * the pair that was measured.
 *
 * **The Text Alignment is one rule, over body text only** (ADR 0034). It is set
 * on every element inside the body, for the reason the font is, except a
 * heading and what is inside one, and an element carrying `OWN_ALIGNMENT` —
 * which the program puts on whatever the Document itself centres or sets to the
 * right, before this stylesheet reaches that document. Justifying everything
 * instead would be wrong in the most visible place: a one-line centred title
 * *is* the last line of its block, which justification sets flush left, so
 * every chapter title would move to the margin.
 *
 * It cannot produce a fourth kind of rule: the font is looked up in
 * `READING_FONTS` rather than interpolated, the size is arithmetic on two
 * numbers, and the alignment is one of two words written here — so nothing an
 * owner could type reaches a stylesheet, and in particular **nothing here can
 * declare `user-select`**, which silently stops `::highlight()` from painting
 * (see `SELECTABLE`). That is asserted in `test/renderer/appearance.test.ts`
 * rather than left to care.
 *
 * `!important` because an EPUB's own stylesheet is loaded into the same document
 * and is as entitled to these properties as this is; the owner's choice is the
 * later word and has to win.
 */
export function appearanceCss(appearance: Appearance, bodyTextSize?: number | null): string {
  const size = isPixelSize(appearance.size) ? appearance.size : PLAIN_BODY_TEXT_SIZE;
  const body = isPixelSize(bodyTextSize) ? bodyTextSize : PLAIN_BODY_TEXT_SIZE;
  const scaled = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, (size / body) * 100));
  const percent = String(Math.round(scaled * 10_000) / 10_000) + '%';
  let css =
    'html, body, body * { -webkit-text-size-adjust: ' + percent + ' !important; }\n' +
    'html, body, body * { text-size-adjust: ' + percent + ' !important; }\n';
  const font = READING_FONTS.find((one) => one.id === appearance.font);
  // The descendants too, and not only the two roots: `font-family` inherits, so a
  // Document that names a face on an element holding its text — a `p`, a `div`, a
  // `span` — would keep that face wherever it named one.
  if (font) css += 'html, body, body * { font-family: ' + font.stack + ' !important; }\n';
  // Anything that is not `left` is the default, so a value from a settings file
  // this build does not know still lays the book out the way a new one would.
  const align = appearance.textAlignment === 'left' ? 'start' : 'justify';
  css += BODY_TEXT + ' { text-align: ' + align + ' !important; }\n';
  return css;
}

/** Light or dark, once the owner's setting and the system's have been resolved into one (`settings.ts`'s `resolveTheme`). */
export type ReadingScheme = 'light' | 'dark';

/** The page under a dark theme. Near-black rather than black, and a text that is not pure white: an unrelieved #000/#fff pair is what makes a long reading tiring. */
const DARK_PAGE = '#111114';
const DARK_TEXT = '#e6e6ea';

/**
 * The theme as CSS for the document, or the empty string under a light theme.
 *
 * **Dark repaints the page; light leaves it alone, and the asymmetry is the
 * decision** (`docs/design/0022`). Dark is a demand the room makes — a white page
 * at two in the morning — and it has to win over whatever the publisher chose.
 * Light is the absence of that demand, so a book that ships cream, or ships its
 * own dark design, keeps it, exactly as the Appearance sheet's "follow the
 * document" does.
 *
 * Two rules and two highlight overrides, and it cannot produce a third: there is
 * no value here that comes from anything the owner typed — the argument is one of
 * two words — so, as with `appearanceCss`, **nothing here can declare
 * `user-select`**, which silently stops `::highlight()` from painting. That is
 * asserted in `test/renderer/rules.test.ts` rather than left to care.
 *
 * `background-color: transparent` on the descendants and not only a page colour:
 * a book that sets a white background on its own paragraphs would otherwise show
 * white blocks on a dark page. `color` on the descendants for the same reason
 * `appearanceCss` sets the font there — it inherits, so a rule on the two roots
 * alone is beaten by any book with `p { color: … }` of its own.
 *
 * **What it cannot do, stated rather than discovered:** an image carries its own
 * colours and is not touched, so a diagram on a white background still glares;
 * and a book that uses colour to *mean* something loses that meaning, because
 * every colour it set becomes one colour. Both are in `docs/design/0022`.
 *
 * The two `::highlight()` rules come last so they beat the ones baked into
 * `highlightCss`, which are tuned for a light page: the word's amber at 0.62 under
 * light text is close to unreadable, so under dark the word is painted more
 * opaque and its text is set back to the page colour.
 */
export function themeCss(scheme: ReadingScheme): string {
  if (scheme !== 'dark') return '';
  return (
    'html, body { background-color: ' + DARK_PAGE + ' !important; color: ' + DARK_TEXT + ' !important; }\n' +
    'body * { color: ' + DARK_TEXT + ' !important; background-color: transparent !important; }\n' +
    '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: rgba(255, 196, 0, 0.20); }\n' +
    '::highlight(' + WORD_HIGHLIGHT + ') { background-color: rgba(255, 176, 0, 0.85); color: ' + DARK_PAGE + '; }\n'
  );
}

/**
 * The theme `<Reader>` is handed: `@epubjs-react-native/core`'s own default, rule
 * for rule, with the page transparent instead of `#fff` (#27, ADR 0043).
 *
 * **The library colours the WebView itself with `body.background`**, and
 * react-native-webview makes a WKWebView whose colour is not opaque draw no
 * background of its own. So wherever no section is drawn — the page before the
 * first one is displayed, below a short document, the gap a fast fling outruns —
 * what shows is the reader's own view behind the WebView, `INK.page`, which is the
 * dark page under the dark theme and `#ffffff` under the light one, and follows a
 * live change of theme. With the library's `#fff` it was a white flash on every
 * open and in every long fling, measured on the owner's own book.
 *
 * The library also registers this theme into every section, and it does so before
 * the program is installed — it injects the program only once the first section
 * has been displayed. So the first section's page is transparent too until
 * `themeCss` reaches it, rather than white.
 *
 * **Every other rule is the library's, unchanged**, including its black text: the
 * light theme looks exactly as it did, since the page behind is the same white.
 * `test/renderer/rules.test.ts` compares this against the installed package.
 */
export const READER_THEME: Record<string, Record<string, string>> = {
  body: { background: 'transparent' },
  span: { color: '#000 !important' },
  p: { color: '#000 !important' },
  li: { color: '#000 !important' },
  h1: { color: '#000 !important' },
  a: { color: '#000 !important', 'pointer-events': 'auto', cursor: 'pointer' },
  '::selection': { background: 'lightskyblue' },
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
export function highlighterSource(
  styles: HighlightStyles = DEFAULT_HIGHLIGHT,
  appearance: Appearance = DEFAULT_APPEARANCE,
  scheme: ReadingScheme = 'light',
  /**
   * The Document's own body text size, when it has been measured before; null
   * when it has not, which makes the program measure it (ADR 0030). The default
   * is for a program that lays nothing out for the owner to read — the download
   * indexer's — and so has nothing to measure for.
   */
  bodyTextSize: number | null = PLAIN_BODY_TEXT_SIZE,
): string {
  const constants =
    'var WORD = ' + JSON.stringify(WORD_HIGHLIGHT) + ';\n' +
    'var UTTERANCE = ' + JSON.stringify(UTTERANCE_HIGHLIGHT) + ';\n' +
    'var BLOCKS = ' + JSON.stringify(BLOCKS_MESSAGE) + ';\n' +
    'var DOCUMENT = ' + JSON.stringify(DOCUMENT_MESSAGE) + ';\n' +
    'var TAP = ' + JSON.stringify(TAP_MESSAGE) + ';\n' +
    'var PROBLEM = ' + JSON.stringify(PROBLEM_MESSAGE) + ';\n' +
    'var CSS_TEXT = ' + JSON.stringify(highlightCss(styles)) + ';\n' +
    /* The one that changes while the document is open, which is why it is a `var`
       the Appearance message reassigns rather than another constant. The owner's
       choice is baked in here as well as sent, so a book opened with an override
       already set is laid out that way on its first paint instead of reflowing
       once the message arrives. */
    'var APPEARANCE = ' + JSON.stringify(appearanceCss(appearance, bodyTextSize)) + ';\n' +
    /* Whether each section's characters are still being counted by size, which
       they are until the bridge has decided the Document's body text size and
       says so ('measured'). A Document measured on an earlier open starts with
       the answer baked into APPEARANCE above and is never counted again. */
    'var MEASURE = ' + String(bodyTextSize === null) + ';\n' +
    /* Where a section's count stops: at the text node that reaches this many
       characters. Enough for a page of prose to outvote its headings, and a bound
       on what a very long section can cost the frame it renders on. */
    'var COUNT_LIMIT = 5000;\n' +
    /* The other one that changes while the document is open, and baked in for the
       same reason: a book opened under a dark theme is painted dark on its first
       paint rather than flashing white until the message lands. */
    'var THEME = ' + JSON.stringify(themeCss(scheme)) + ';\n' +
    'var SETTLE_FRAMES = 60;\n' +
    'var STYLE_ID = "openreader-highlight";\n' +
    /* The mark a Document's own centred and right-aligned lines get, and the
       computed values that earn it (ADR 0034). APPEARANCE excludes by the same
       name, so both halves are written from one constant. */
    'var OWN_ALIGNMENT = ' + JSON.stringify(OWN_ALIGNMENT) + ';\n' +
    'var OWN_ALIGNMENTS = ' + JSON.stringify(Object.fromEntries(OWN_ALIGNMENTS.map((value) => [value, 1]))) + ';\n';

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

     epub.js replaces a section's document as the reader moves through the book —
     under 'scrolled-continuous' several are alive at once and the manager
     destroys the ones that scroll out of reach — so a remembered text node,
     element or Contents is a reference into a document that may already have lost
     its browsing context. \`isConnected\` does not say so: a detached document still
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
  /* Spine items epub.js has been asked for by renderAhead. \`bySection\` is the
     durable half of the same question and cannot answer it alone: it is written
     when the Blocks are reported, which is after the render, so a second Clip cue
     arriving in between would ask for the same section again. */
  var asked = new Set();
  /* The document the two highlights are registered in, so they can be taken out
     of it when the reading moves to another section. */
  var installed = null;
  var registries = new WeakMap();
  /* Each DOM Range a highlight holds -> the element of the Block it was built
     from, so that put() can repaint that Block when the Range is taken out again
     (#35). Keyed weakly by the Range, so it lives exactly as long as the Range
     does, and the element is in the Range's own document; put() still asks that
     document for its defaultView before it repaints anything. */
  var owners = new WeakMap();
  var state = null;
  var frame = 0;
  /* How much of the bottom of the scroll container the player is covering, in CSS
     pixels, from the 'inset' message. Zero until it says otherwise, which is the
     geometry that was true before ADR 0020's player existed. See centre(). */
  var covered = 0;
  /* The lowest spine item on the page, from the last sweep. The only thing the
     resize recovery has to aim at; see the resize handler. */
  var onScreen = null;

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

  /* This section's characters by the size the **Document** set them in, for the
     bridge to decide its body text size from (ADR 0030). Reads only: the walk has
     already found the text nodes, and each costs one computed style of its
     element, cached per element.

     A computed font size already carries the owner's text-size-adjust — measured:
     at 150% a paragraph the Document set at 16px reports 24px — so the percentage
     in effect is divided back out. It is the same on every element, because
     APPEARANCE declares it on every element. What that division leaves is exact
     only up to floating point, and body-text.ts, which is tested, rounds it.

     It stops at the text node that reaches COUNT_LIMIT characters, whatever the
     length of the section: the owner ruled out a stall to measure a book (#17). */
  function sizesOf(contents, found) {
    var win = contents.window;
    var adjust = String(win.getComputedStyle(contents.document.documentElement).getPropertyValue('-webkit-text-size-adjust') || '');
    var factor = /%$/.test(adjust) ? parseFloat(adjust) / 100 : 1;
    if (!(factor > 0)) factor = 1;
    var bySize = new Map();
    var seen = new Map();
    var counted = 0;
    for (var i = 0; i < found.length && counted < COUNT_LIMIT; i++) {
      var parts = found[i].parts;
      for (var j = 0; j < parts.length && counted < COUNT_LIMIT; j++) {
        var element = parts[j].node.parentElement;
        if (!element) continue;
        var characters = parts[j].node.data.replace(/\\s+/g, '').length;
        if (!characters) continue;
        var px = seen.get(element);
        if (px === undefined) {
          px = parseFloat(win.getComputedStyle(element).fontSize) / factor;
          seen.set(element, px);
        }
        if (!(px > 0)) continue;
        bySize.set(px, (bySize.get(px) || 0) + characters);
        counted += characters;
      }
    }
    var sizes = [];
    bySize.forEach(function (count, size) { sizes.push([size, count]); });
    return sizes;
  }

  /* The download indexer runs in its own rendition. It uses this exact walk,
     including the publication's computed CSS, rather than a second text parser. */
  window.openreaderOfflineSection = async function(index, navigationPoints, token) {
    try {
      var section = book.spine.get(index);
      await rendition.display(index);
      var contents = rendition.getContents().filter(function(c) { return c.sectionIndex === index; })[0];
      for (var tries = 0; !contents && tries < 100; tries++) {
        await new Promise(function(resolve) { window.setTimeout(resolve, 50); });
        contents = rendition.getContents().filter(function(c) { return c.sectionIndex === index; })[0];
      }
      if (!contents) throw new Error('Chapter ' + (index + 1) + ' did not render.');
      var found = walk(contents);
      var points = [];
      (navigationPoints || []).forEach(function(entry) {
            var fragment = entry.fragment || '';
            var anchor = fragment ? contents.document.getElementById(fragment) : null;
            if (fragment && !anchor) throw new Error('A chapter anchor could not be found: ' + entry.title);
            var at = 0;
            if (anchor) {
              at = found.findIndex(function(b) {
                return b.element === anchor || anchor.contains(b.element) || !!(anchor.compareDocumentPosition(b.element) & 4);
              });
              if (at < 0) at = found.length;
            }
            points.push({id:entry.id, title:entry.title, depth:entry.depth, parent:entry.parent, block:at});
      });
      post({type:'openreader:offline-section', token:token, index:index, total:book.spine.length,
        language:String(book.package.metadata.language || '').trim() || 'en', points:points,
        blocks:found.map(function(b) { return {text:b.text, role:roleOf(b.element), section:section.href}; })});
    } catch (error) { post({type:'openreader:offline-error', token:token, detail:String(error)}); }
  };

  /* Which lines the Document placed itself (ADR 0034): every element it centres
     or sets to the right is marked with OWN_ALIGNMENT, and the owner's Text
     Alignment in APPEARANCE passes over what is marked.

     **Read before this program's stylesheet is in the document, and only then.**
     That rule sets text-align on every other element with !important, so once it
     is installed a computed value is the owner's answer and no longer the
     Document's. ensureStyle() calls this on the one branch that creates the
     stylesheet, so it runs exactly once per document, whichever of adopt(),
     restyle() and registryFor() reaches the document first.

     All the reading first, then all the marking: an attribute is a change the
     style engine has to answer before the next computed value, so interleaving
     the two would restyle the section once per element marked.

     Every element inside the body, not only Blocks, because inheritance is
     what carries a centred line down: a paragraph inside a centred division
     computes center without declaring it, and left unmarked it would take the
     owner's rule and leave its division's alignment behind. Not the body
     itself, which the owner's rule never reaches. */
  function markOwnAlignment(doc) {
    var win = doc.defaultView;
    if (!win || !doc.body) return;
    var elements = doc.body.getElementsByTagName('*');
    var own = [];
    for (var i = 0; i < elements.length; i++) {
      if (OWN_ALIGNMENTS[String(win.getComputedStyle(elements[i]).textAlign || '')]) own.push(elements[i]);
    }
    for (var k = 0; k < own.length; k++) own[k].setAttribute(OWN_ALIGNMENT, '');
  }

  function ensureStyle(doc) {
    /* One element per document: the ::highlight() rules and the owner's
       Appearance are the same stylesheet because they have to live in the
       document they style and there is no reason for two. Its text is not a
       constant any more — Appearance changes while the book is open — so this
       both creates and updates. The only other DOM change this file makes is the
       attribute markOwnAlignment() puts on the Document's own centred lines, once,
       just before the stylesheet is created. */
    var style = doc.getElementById(STYLE_ID);
    if (!style) {
      markOwnAlignment(doc);
      style = doc.createElement('style');
      style.id = STYLE_ID;
      (doc.head || doc.documentElement).appendChild(style);
    }
    /* Three strings and still one element. THEME sits between them so that its
       ::highlight() overrides beat the ones in CSS_TEXT, which are tuned for a
       light page, while the owner's Appearance — which declares neither a colour
       nor a highlight — stays the last word on the font and the size. */
    var wanted = CSS_TEXT + THEME + APPEARANCE;
    if (style.textContent !== wanted) style.textContent = wanted;
  }

  /* Every section on the page, restyled. Called when Appearance changes; a
     section that renders afterwards gets it from adopt() like any other. */
  function restyle() {
    var list = rendition.getContents();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].document && list[i].document.defaultView) ensureStyle(list[i].document);
    }
  }

  /* ---- tapping a word (ADR 0020) ---- */

  /* The tapped point as a text node and an offset into it.

     Two spellings of one operation: caretPositionFromPoint is the standard and
     WebKit ships it, caretRangeFromPoint is WebKit's original name and is what an
     older one has. They answer with the same node and the same offset, so this is
     not a capability check with a second behaviour behind it — it is one behaviour
     with two names, and neither being there is reported rather than swallowed. */
  function caretAt(doc, x, y) {
    if (doc.caretPositionFromPoint) {
      var position = doc.caretPositionFromPoint(x, y);
      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    if (doc.caretRangeFromPoint) {
      var range = doc.caretRangeFromPoint(x, y);
      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    report('this WebKit has neither caretPositionFromPoint nor caretRangeFromPoint, so a tap cannot be located');
    return null;
  }

  /* Which walked Block a live text node belongs to, and where in that Block's own
     text the offset lands.

     A linear walk of the document's Blocks rather than a node -> Block index:
     \`parts\` already holds the very nodes the Block's text was built from, a
     reverse map would be a second structure keyed by nodes in a document epub.js
     will replace, and this runs once per tap rather than once per frame. */
  function blockOffsetOf(doc, node, within) {
    var map = maps.get(doc);
    if (!map) return null;
    var answer = null;
    map.forEach(function (found, id) {
      if (answer) return;
      for (var i = 0; i < found.parts.length; i++) {
        if (found.parts[i].node !== node) continue;
        /* Clamped to the part's own length: a caret at the very end of a text node
           reports its length as the offset, which is one past the last character
           and belongs to the next part if there is one. */
        var at = within < found.parts[i].len ? within : found.parts[i].len;
        answer = { block: id, offset: found.parts[i].at + at, element: found.element };
        return;
      }
    });
    return answer;
  }

  /* Whether the tap actually landed **on** the Block it resolved to.

     This is what makes tapping blank space do nothing, and it is needed because
     the caret hit-test alone does not say so: **caretPositionFromPoint snaps to
     the nearest text** rather than answering null off the text. Measured on the
     device — a click at (2.0, 23.4), in the body's left padding beside the first
     heading, returned a text node in that heading and moved the reading to its
     first Utterance. The design file's whole objection to a gesture in the blank
     is that missing it would move your place in the book, so the blank has to be
     blank.

     The **Block's own box**, and not the character's: a tap between two lines of a
     paragraph, or past the end of a short last line, is inside the paragraph and is
     an ordinary "read from about here". A tap in the margin, or on the empty page
     below the last paragraph, is inside nothing. */
  function inside(element, x, y) {
    if (!element || !element.getBoundingClientRect) return false;
    var box = element.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }

  /* A tap on the page: report where it landed and let the app decide, because the
     Utterances are on the other side of the bridge (see TapMessage).

     A tap that hit-tests to anything but a text node posts **nothing** — tapping
     blank space does nothing, and in particular it is not a toggle for the
     player's visibility (docs/design/0020). A tap in the gap between two
     paragraphs hit-tests to the element that owns the gap and not to text, which
     is what makes that the ordinary case rather than a special one.

     It is a click and not a long press: the long press on text is iOS's selection
     gesture and taking it would mean \`user-select: none\`, which silently stops
     ::highlight() from painting (see this file's header, and the 20:10 note). */
  function tapped(event) {
    var node = event.target;
    var doc = node && node.ownerDocument ? node.ownerDocument : null;
    if (!doc || !doc.defaultView) return;
    var caret = caretAt(doc, event.clientX, event.clientY);
    /* nodeType 3 is a text node. An element means the point is over layout that
       holds no text of its own. */
    if (!caret || !caret.node || caret.node.nodeType !== 3) return;
    var place = blockOffsetOf(doc, caret.node, caret.offset);
    if (!place) return;
    if (!inside(place.element, event.clientX, event.clientY)) return;
    post({ type: TAP, block: place.block, offset: place.offset });
  }

  /* ---- what a document holds, resolved once per document ---- */

  /* Walk a live document, record what survives of each Block and tell the React
     Native side about them. Idempotent per document: a document already in \`maps\`
     has nothing new in it, and a re-render is a *different* document. */
  function adopt(contents) {
    if (maps.has(contents.document)) return;
    ensureStyle(contents.document);
    /* Once per document, beside the stylesheet and for the same reason: a
       ::highlight() rule and a tap listener both have to live in the document they
       act on, and this function is already the one place that runs once per
       document. A document epub.js destroys takes its listener with it. */
    contents.document.addEventListener('click', tapped, false);

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
    post({ type: BLOCKS, sectionIndex: index, section: href, blocks: reported, sizes: MEASURE ? sizesOf(contents, found) : null });
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
    return { document: contents.document, parts: found.parts, text: found.text, element: found.element };
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
    /* The third is never registered and no rule names it, so it cannot paint.
       It exists to be handed a Range and have it taken back: see repaintBlocks. */
    var repaint = new win.Highlight();
    found = { utterance: utterance, word: word, repaint: repaint };
    registries.set(win.document, found);
    return found;
  }

  /* Every change to a highlight goes through here, and so does the repaint the
     change needs and WebKit does not do (#35, ADR 0038).

     WebKit paints a ::highlight() background over the line's selection
     rectangle, and on a line with another line above it in the same block that
     rectangle starts at the bottom of the upper line's text: 2 CSS px above the
     text's own box for WebKit's serif at 28px with a normal line height, 12.8 px
     at line-height 1.6. It is the leading. When a Highlight's ranges change,
     WebKit repaints only the renderers of the nodes they cover, and a text node's
     repaint rectangle is its own box, which on the first line of a text node does
     not reach up into that strip. So a word added there is drawn short by the
     strip, and a word taken out never has the strip erased. The strip is painted
     whenever something repaints that area whole with the word highlighted, and
     the tiles the centring scroll brings on screen are painted in the frame the
     first word is. Measured on the iOS 27.0 simulator: a strip 6 device pixels
     tall above the Utterance's first word after a <br />, left there until the
     page was repainted for some other reason.

     WebKit repaints the containing blocks itself from 319154@main (2026-08-13),
     which iOS 27.0 does not have. This does the same from here: the Block of
     every Range taken out or put in is repainted whole, once per change. */
  function put(highlight, ranges) {
    var touched = [];
    highlight.forEach(function (range) {
      touched.push(owners.get(range));
    });
    highlight.clear();
    for (var i = 0; i < ranges.length; i++) {
      highlight.add(ranges[i]);
      touched.push(owners.get(ranges[i]));
    }
    repaintBlocks(touched);
  }

  /* A Block repainted whole without touching the DOM or a style. Adding a Range
     to a Highlight, and deleting one, makes WebKit repaint the renderer of every
     node the Range covers, whether or not the Highlight is registered; its source
     has done so since at least 2023. A Range made by selectNode() covers the
     element itself, and an element's repaint rectangle is its whole block. */
  function repaintBlocks(elements) {
    var done = [];
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (!element || done.indexOf(element) >= 0) continue;
      done.push(element);
      var doc = element.ownerDocument;
      /* A document epub.js has replaced paints nothing, so nothing of it needs repainting. */
      var registry = doc && doc.defaultView ? registries.get(doc) : null;
      if (!registry || !element.parentNode) continue;
      var whole = doc.createRange();
      whole.selectNode(element);
      registry.repaint.add(whole);
      registry.repaint.delete(whole);
    }
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
    owners.set(dom, live.element);
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

  /* Whether every Block of this Utterance is one we know and its section is
     simply not rendered.

     That is the ordinary "the reading has crossed into text the page has not
     reached", and follow() answers it by displaying the section — after which
     attach() paints the highlight, a fraction of a second later. Since
     renderAhead() it is what happens at **every section boundary** of a document
     whose sections are taller than their text, so calling it a highlight that
     could not be drawn would leave that sentence standing on the screen while
     the highlight was, in fact, drawn. Every other way build() can fail — a Block
     nobody reported, a Block the rendered section no longer holds — is a real
     failure and is still reported. */
  function offPage(ranges) {
    if (!ranges.length) return false;
    for (var i = 0; i < ranges.length; i++) {
      var record = blocks.get(ranges[i].block);
      if (!record || liveContents(record.section)) return false;
    }
    return true;
  }

  /* Ranges that could not be built only because their section is not on the
     page, while the page is following the reading — which is what brings that
     section back: follow() has asked for it, or will at the next Utterance's cue,
     and attach() paints the highlight when it arrives. Waiting, not failing.

     One predicate for the Utterance and the word (#50). The word used to report
     unconditionally, so Play with the page scrolled away said "Block 6.13 is in
     section 6, which is not on the page" through the correction play() sends
     straight after its cue, while the section was on its way and the highlight
     was, a moment later, drawn. */
  function awaited(ranges) {
    return !!(state && state.follow && offPage(ranges));
  }

  /* Returns the built ranges rather than a boolean, so that the caller which has
     just painted them measures *those* rather than building a second set to
     measure — the centring below needs the very Ranges that are on the page.
     Null where nothing could be drawn. */
  function showUtterance() {
    var built = build(state.utteranceRanges);
    if (!built) {
      clearHighlights();
      /* Reported, not swallowed. Philosophy rule 1, and the reason the problem
         message exists: once per Utterance, so a reading that is ahead of the page
         says so once rather than sixty times a second. */
      if (!awaited(state.utteranceRanges)) report(why(state.utteranceRanges));
      return null;
    }
    var registry = registryFor(built.window);
    moveTo(registry);
    put(registry.utterance, built.ranges);
    put(registry.word, []);
    return built;
  }

  function showWord(ranges) {
    var built = build(ranges);
    if (!built) {
      if (!awaited(ranges)) report(why(ranges));
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

  /* ---- holding the Utterance in the middle of the screen (ADR 0005, ADR 0011) ---- */

  /* The one element that scrolls. Read off the manager rather than looked up by
     id, because epub.js builds it itself: it is the \`epub-container\` div the
     manager's own Stage creates *inside* the element the library's template
     rendered to, and the template gives that outer element
     \`overflow: hidden !important\`. Looking up '#viewer' would find the element
     that cannot scroll. Measured on the device: className 'epub-container',
     computed overflow-y 'scroll', identical to manager.stage.getContainer(). */
  function scroller() {
    var manager = rendition.manager;
    return manager && manager.container ? manager.container : null;
  }

  /* Where an Utterance sits, measured in the top document's own coordinates.
     A Range's client rects are relative to the section's iframe, so the iframe's
     own rect is added: in a scrolled layout each section's iframe is as tall as
     its text and sits at a fixed offset down the scroll, so the two together are
     where the sentence is. Rects, not the CFI — a CFI names a Block and the
     screen is measured in pixels. */
  function boxOf(built) {
    var frame = built.window.frameElement;
    if (!frame) return null;
    var origin = frame.getBoundingClientRect().top;
    var top = 0;
    var bottom = 0;
    var found = false;
    for (var i = 0; i < built.ranges.length; i++) {
      var rect = built.ranges[i].getBoundingClientRect();
      /* A Range over text that wraps to nothing — a collapsed line, or one of the
         newlines a Block's text keeps verbatim — has no geometry to aim at. */
      if (!rect.height) continue;
      if (!found || origin + rect.top < top) top = origin + rect.top;
      if (!found || origin + rect.bottom > bottom) bottom = origin + rect.bottom;
      found = true;
    }
    return found ? { top: top, bottom: bottom } : null;
  }

  /* Scroll so the Utterance being spoken is **centred** — the whole of ADR 0011's
     continuous reader, and the reason a page-turning layout was rejected. It is
     driven by the Clip cue alone: once per Utterance, never per word, and nothing
     extra crosses the bridge to do it (ADR 0005). */
  function centre(built) {
    var view = scroller();
    if (!view) return false;
    var box = boxOf(built);
    if (!box) return false;
    var bounds = view.getBoundingClientRect();
    var height = view.clientHeight;
    /* The middle of what can be **seen**, not the middle of the container.
       ADR 0020's player floats over the bottom of this container so that the text
       never reflows when it appears; the price is that centring against
       \`clientHeight\` would aim at a point the player is standing on and hold the
       sentence being spoken behind it. \`covered\` is the player's own measured
       height, and it changes when the player collapses and expands — which is why
       it is an input here rather than a constant subtracted once.

       An inset at least as tall as the container leaves nothing to centre in, and
       then this is the same arithmetic as the tall-Utterance branch below: the
       Utterance's top goes to the top of the viewport. */
    var visible = height - covered;
    if (visible < 0) visible = 0;
    var move = (box.top + box.bottom) / 2 - bounds.top - visible / 2;
    /* Unless the Utterance is taller than the screen, where centring its middle
       would push its opening words off the top — and those are the words about to
       be spoken. Then its start goes to the top of the screen instead, and the
       word highlight walks down from there. */
    if (move > box.top - bounds.top) move = box.top - bounds.top;
    /* Below a pixel there is nothing to see, and every scroll costs epub.js a
       pass over its views. */
    if (Math.abs(move) < 1) return true;
    /* Through the manager's own scroll, and deliberately **without** its \`ignore\`
       flag: this has to reach epub.js exactly as a finger scroll does, because
       that is what makes the continuous manager append the section the reading is
       about to walk into. A scroll it was told to ignore renders nothing new. */
    rendition.manager.scrollBy(0, move, false);
    return true;
  }

  /* Once per document per Utterance, and \`centred\` is what makes it once: a
     centring that causes epub.js to render a section would otherwise be answered
     by attach(), which would centre again, which would render again. It is a
     WeakSet, so a document epub.js destroys is not held alive by having been
     centred in — the thing the Block records exist not to hold. */
  function centreOnce(built) {
    if (!state || !state.follow) return;
    var doc = built.window.document;
    if (state.centred.has(doc)) return;
    if (centre(built)) state.centred.add(doc);
  }

  /* The text has reflowed under an Appearance change, so the sentence being
     spoken is no longer where it was centred — a font change moves every line in
     the book, and the one the owner is listening to with it.

     **Not on this frame.** epub.js resizes each section's iframe from the
     section's own ResizeObserver, whose callback is
     \`requestAnimationFrame(this.resizeCheck.bind(this))\` — read out of the
     bundled epub.js — so the geometry a re-centre needs is a frame or more away,
     and centring against a box that is about to move aims at where the sentence
     was. So the box is measured every frame until it stops moving and the
     centring is the last measurement.

     **And on every frame of the window, not once at the end.** The first version
     waited for two frames with the same geometry and then centred once; it held
     the Utterance to 0.758 px when the text grew and left it **4,285 px** out when
     the text shrank, because a page can look settled for a frame while epub.js is
     still resizing iframes and the continuous manager has yet to re-lay the views
     out. Centring every frame converges on whatever the layout ends up doing
     instead of guessing when to look, and it is nearly free: centre() scrolls only
     when the move is at least a pixel, so a settled page costs one measurement a
     frame and no scroll at all.

     \`SETTLE_FRAMES\` is a cap and not a duration: it exists so that a document
     whose layout never settles cannot hold a frame loop open. The loop leaves
     early — three frames in which nothing moved — so its value is what a
     pathological document costs and not what an ordinary one does. Nothing is
     centred at all when nothing is being read: there is no Utterance to hold in
     the middle, and scrolling a page the owner is reading with their eyes is the
     thing ADR 0020's floating player exists not to do. */
  function settle(left, was, still) {
    if (!state || !state.follow) return;
    var built = build(state.utteranceRanges);
    var box = built ? boxOf(built) : null;
    if (!built || !box) {
      if (left > 0) window.requestAnimationFrame(function () { settle(left - 1, null, 0); });
      return;
    }
    /* \`box.top\` is measured in the viewport, so it stops changing exactly when
       centre() stops scrolling — which is the convergence this waits for. */
    var steady = was !== null && Math.abs(box.top - was) < 1 ? still + 1 : 0;
    centre(built);
    if (steady >= 3 || left <= 0) return;
    window.requestAnimationFrame(function () {
      settle(left - 1, box.top, steady);
    });
  }

  /* The page following the voice, for the Utterance now starting. \`built\` is
     what showUtterance() just painted, or null.

     Two cases, and only the second moves the reading position: the section is on
     the page, and it is scrolled to the middle; or it is not rendered at all —
     the reading has run ahead of the document — and only a display() can get
     there. The centring then happens in attach(), when the section arrives. */
  function follow(built) {
    if (!state) return;
    if (built) {
      centreOnce(built);
      return;
    }
    var record = blocks.get(state.utteranceRanges[0].block);
    if (!record || !record.cfi) return;
    /* attach() centres this section on the frame after it arrives rather than
       at once, because this display is not finished when it arrives: see there.
       Not on the display's promise, which says nothing about arriving: it is
       resolved as the section's iframe starts to load, when the library's
       onShouldStartLoadWithRequest answers the iframe's about:srcdoc with a
       display of that, and epub.js resolves the display in flight whenever
       another is asked for (measured 2026-09-23, #50). */
    state.awaiting = record.section;
    try {
      /* epub.js's own dialect, and its own resolver (ADR 0011). Under the
         continuous manager this clears every view and rebuilds from the target,
         which is why it is the second case and not the first: it is what to do
         when there is no other way to reach the text, and nothing to do when the
         text is already on the page. */
      rendition.display(record.cfi);
    } catch (error) {
      report('could not bring the Block into view: ' + error);
    }
  }

  /* ---- keeping the document ahead of the voice ---- */

  /* The spine item the Utterance being spoken starts in, or null. Its first
     range's Block, which is unambiguous rather than a choice: rejoin.ts refuses
     to weld two Blocks from different sections, so an Utterance lies entirely
     inside one. */
  function sectionSpoken(ranges) {
    var record = ranges && ranges.length ? blocks.get(ranges[0].block) : null;
    return record ? record.section : null;
  }

  /* Render the section the reading is walking into, **because the reading needs
     it** and not because the page was scrolled to it.

     This is the chain that closed on itself (notes/NOTES_2026-09-20.md, 04:43).
     More text needs epub.js to render the next spine item. The continuous
     manager appends one from its own onScroll, and only when the scroll has come
     within \`settings.offset\` — 500 px — of the bottom of everything it holds.
     The only thing that scrolls while a book is being read aloud is centre(),
     and centre() stops at the sentence being spoken. So a section whose text
     ends far above its own bottom runs the reading out of Utterances with the
     rest of the book still unrendered, and nothing is left that would make more:
     measured on the fixture at 05:03, one view, scrollTop 0, clientHeight 758,
     scrollHeight 3,072 — 758 + 500 is 1,258, and 1,258 < 3,072 for ever.

     The trigger is the Clip cue, which already arrives once per Utterance and
     already drives the centring, so **nothing is added to the bridge** — the
     property ADR 0011 states of the centring and the reason it is stated.

     Three guards, and each is what keeps this from becoming a second, slower
     renderer racing the first:

     - **One section, the one after the voice.** The reading needs the text it is
       walking into and never a chapter beyond that.
     - **Only when that section is the manager's last view**, and then through the
       manager's own \`section.next()\` rather than a spine index of our own — the
       same call its check() makes. The view list is a contiguous run of spine
       items, because append and prepend are the only things that extend it, so
       appending out of order would put the wrong text under the reader's thumb.
       A last view further on than the voice means the next section is already
       there and there is nothing to do.
     - **Once per section, ever.** \`bySection\` is what the Blocks were reported
       under, so a section already reported is never rendered for this again.
       That guard is load-bearing rather than tidy: the manager trims the view
       again within a second or two (ADR 0011 keeps three alive), and without it
       the same chapter would be fetched and parsed once per Utterance.

     Nothing here keeps the section alive, and that is deliberate. The Block
     records survive the view being destroyed — that is what blocks.ts is for —
     and when the voice arrives there, follow() displays it exactly as it already
     does for text that is not on the page. So the manager goes on holding three
     views and ADR 0011's memory figures stand. */
  function renderAhead(section) {
    if (section === null) return;
    var manager = rendition.manager;
    if (!manager || !manager.views || !manager.q) return;
    var last = manager.views.last();
    if (!last || !last.section || last.section.index !== section) return;
    var next = last.section.next();
    if (!next || bySection.has(next.index) || asked.has(next.index)) return;
    asked.add(next.index);
    /* **Through the manager's own queue**, which is the whole difference between
       this working and not. Measured at 05:09 on the fixture: appended and
       displayed straight away, the view was taken apart by the update() a scroll
       had already scheduled before its iframe had finished loading — left with
       \`displayed\` false, no \`iframe\`, a display() that never settled and no
       Blocks ever reported. epub.js's own check() does not race that, because it
       appends, displays and updates inside one queued task and the queue holds
       the next task until the promise a task returns resolves. This is the same
       task, asked for by the reading instead of by the scroll.

       **And it sweeps itself**, which the content hook below has since made a
       second look rather than the only one. Watched for five seconds at 05:13:
       the view reached \`displayed\`, held a live document and a paragraph, and
       this program had not adopted it. The cause was not this way of displaying
       it — no 'rendered' event has ever reached this program, because the
       library's own listener throws first (ADR 0036). Sweeping is idempotent
       per document. */
    manager.q.enqueue(function () {
      return manager.append(next).display(manager.request);
    }).then(sweep, function (error) {
      /* Forgotten rather than remembered as asked, so the next Clip cue tries
         again. "Once per section, ever" is right for a section that rendered;
         applied to one that failed it would be this defect again, one section
         further on — the reading stopped for good, with a sentence to show for
         it this time and nothing that would ever produce another. */
      asked.delete(next.index);
      report('could not render the section the reading is walking into: ' + error);
    });
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
       new, so the highlight has to be built against it. */
    if (!state || !covers(contents.sectionIndex, state.utteranceRanges)) return;
    var built = showUtterance();
    if (!built) return;
    showAt(state.next - 1);
    /* And it arrived wherever epub.js put it, which is not the middle of the
       screen. Two ways in: the reading ran ahead of the document and follow()
       displayed the section, or the manager destroyed this section's view and
       rebuilt it while the same Utterance was being spoken. Both want centring
       now that there is something to measure — and the first wants it a frame
       from now.

       **A section follow() asked for arrives before its display has finished**
       (#50). This runs in epub.js's content hook, and the same display goes on,
       in the same task, to its own moveTo(): a scroll to the top of the Block the
       CFI names, added to whatever this scrolled. Measured on the owner's book at
       19:28 on 2026-09-23, Play with the page scrolled away from Block 6.13: the
       centring scrolled 725 px, the moveTo 958 px more, and the sentence — painted
       — ended 724 px above the top of the screen. So the Utterance is painted now
       and centred on the next frame, after that moveTo and after the views are
       shown, through settle(), which also follows the page while fill() lays the
       neighbouring sections out around it. A section that arrives any other way
       has no scroll of epub.js's behind it, and is centred at once. */
    if (state.awaiting === contents.sectionIndex) {
      state.awaiting = null;
      var mine = state;
      window.requestAnimationFrame(function () {
        if (state === mine) settle(SETTLE_FRAMES, null, 0);
      });
    } else {
      centreOnce(built);
    }
    start();
  }

  function sweep() {
    var list = rendition.getContents();
    var lowest = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && (lowest === null || list[i].sectionIndex < lowest)) lowest = list[i].sectionIndex;
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
    /* The top of what is on the page, kept for the one case that has to put it
       back — see the resize handler. Only when something is on the page: an empty
       sweep is the blank we are recovering from, and forgetting where we were is
       how the recovery would lose its target. */
    if (lowest !== null) onScreen = lowest;
  }

  /* ---- the blank open (notes/NOTES_2026-09-20.md, 01:51) ---- */

  /* A resize destroys every view, and epub.js only puts them back if it has
     somewhere to put them.

     Read out of the bundled epub.js and then measured on the device. The stage's
     resize observer calls the manager's \`resize\`, which — whenever the size really
     changed — calls \`this.clear()\` and destroys every view. The rendition's own
     handler then re-displays:

         onResized(size, cfi) {
           this.emit(RENDITION.RESIZED, ...);
           this.location && this.location.start && this.display(cfi || this.location.start.cfi);
         }

     **\`this.location\` is set by \`reportLocation\`, which first runs when the
     opening \`display()\` resolves.** A resize that lands in the window before that
     — the reader's own layout settling, a navigation transition finishing — finds
     no location, re-displays nothing, and leaves a blank page with zero views, an
     empty container and \`currentLocation()\` answering \`{}\`. Which is exactly the
     state recorded on 2026-09-19 at 20:44 and 22:55, on two different books, with
     the app already holding the Blocks of sections that had rendered and gone.

     Measured both ways on the device: a forced resize with a location recovers to
     two views in 700 ms; the same resize with the location cleared leaves zero
     views and zero children for good.

     So this is the case epub.js drops, and nothing else: when it has a location it
     recovers and this stays out of the way. Not a capability check and not a second
     way to render — it is the only way, run when the library has declined to run
     it. */
  var displaying = false;
  rendition.on('resized', function () {
    if (rendition.location && rendition.location.start) return;
    if (onScreen === null || displaying) return;
    /* The section that was at the top of the page, not the start of the book: on a
       resumed reading, spine item 0 would be the cover. Under a scrolled layout the
       reader may have been partway into it, so they land slightly early rather than
       somewhere unpredictable — the same trade the contents list makes, and better
       than the nothing this replaces. */
    displaying = true;
    try {
      rendition.display(onScreen);
    } catch (error) {
      report('could not restore the page after a resize: ' + error);
    }
    /* Cleared on the next paint rather than on the promise: a display that rejects
       would otherwise wedge this shut for the life of the document. */
    window.setTimeout(function () {
      displaying = false;
    }, 0);
  });

  /* Every section document epub.js displays, as it displays it: the first one,
     one the continuous manager appends or prepends, one it rebuilds after
     destroying it, one renderAhead asked for.

     **Through epub.js's content hook, not its 'rendered' event, which has never
     reached this program** (ADR 0036, #34). The library's template registers
     its own 'rendered' listener first, that listener JSON.stringifies the whole
     Section, a Section is cyclic, and epub.js's emitter has no try — so the
     dispatch ends at the library's listener, every time. The hook chain runs
     each hook in its own try, for every display, before the view is shown; it
     is the chain the library's own theme arrives through. The defect it closes
     was a chapter carrying that theme and not this program's stylesheet:
     reached by a fast fling, displayed after the last 'relocated', and left
     white on a dark page, at the book's own size, deaf to taps. */
  rendition.hooks.content.register(sweep);
  /* And again whenever the reading position moves, which is what keeps
     \`onScreen\` current after the manager trims a view — a trim displays
     nothing, so the hook does not hear it. Idempotent per document: one lookup
     per rendered view. */
  rendition.on('relocated', sweep);
  /* Every spine item's href, in spine order and in the spine's own spelling.

     The contents list cannot exist without it (ADR 0020): a row is a navigation
     entry, a navigation entry is an href, and the only thing a row can be seeked
     to is a spine index. \`adopt\` already reads one of these per section, so this
     is the same accessor in a loop rather than a new mechanism.

     Unmodified — not resolved, not decoded, not trimmed. epub.js resolves neither
     the navigation's hrefs nor the spine's against anything, and
     \`core/document/contents.ts\` matches the two as strings; a spelling tidied here
     would match neither side. A spine item that will not resolve contributes the
     empty string, which that lookup ignores, rather than shortening the array and
     shifting every index after it. */
  function spineHrefs() {
    var hrefs = [];
    for (var i = 0; i < book.spine.length; i++) {
      var item = null;
      try {
        item = book.spine.get(i);
      } catch (error) {
        item = null;
      }
      hrefs.push(item && item.href ? item.href : '');
    }
    return hrefs;
  }

  /* The shape of the document, once and before any section reports, so the app
     never has to act on a section without knowing whether another follows it.
     The spine's length is set by the unpack that a rendition cannot exist
     without, so by here it is a number. */
  post({ type: DOCUMENT, spine: book.spine.length, hrefs: spineHrefs() });
  /* Installed from the library's onReady, which fires after rendition.display()
     resolved — so the first section has already been through epub.js's hook
     chain, before the hook above was registered. */
  sweep();

  /* ---- the one entry point ---- */

  function dispatch(message) {
    if (message.kind === 'inset') {
      /* Geometry, not a highlight. It comes through this entry point because there
         is exactly one, and a second injected function would be a second thing to
         keep installed and to check for.

         **Nothing is re-centred here**, deliberately. The player collapsing changes
         where the middle of the visible text is, and scrolling to the new middle
         would move the text under the reader — which is the one thing ADR 0020's
         floating player exists to prevent. So the new inset applies to the next
         Utterance, and the sentence being spoken stays where it is. */
      covered = typeof message.bottomPx === 'number' && isFinite(message.bottomPx) && message.bottomPx > 0 ? message.bottomPx : 0;
      return;
    }
    if (message.kind === 'appearance') {
      /* How the text is set, from the Appearance sheet (ADR 0019). It arrives as
         finished CSS rather than as a font and a size, so that what a rule may
         say is decided once, on the side that can be tested — \`appearanceCss\`
         builds it out of a fixed list and a clamped number, and in particular
         cannot declare \`user-select\`, which would silently stop the highlight
         painting.

         The page is restyled and then re-centred, because a change that reflows
         the text moves the sentence being spoken away from the middle. That is
         the opposite of what the 'inset' message does above, and the difference
         is the whole of it: the player collapsing does not move a single
         character, and a font change moves every one of them. */
      APPEARANCE = typeof message.css === 'string' ? message.css : '';
      restyle();
      settle(SETTLE_FRAMES, null, 0);
      return;
    }
    if (message.kind === 'measured') {
      /* The bridge has decided the Document's body text size (ADR 0030), so the
         sections still to render are not counted. Nothing is restyled or
         re-centred here: the CSS for the decided size, if it differs from what
         is installed, arrives as an ordinary 'appearance' message. */
      MEASURE = false;
      return;
    }
    if (message.kind === 'theme') {
      /* Light or dark, from General (ADR 0022). Finished CSS again, and built from
         a two-word argument rather than from anything the owner typed, so it
         cannot declare \`user-select\` either.

         **Nothing is re-centred here**, and that is the difference from the
         'appearance' message above: a colour change moves not one character, so
         the sentence being spoken is exactly where it was. This is the 'inset'
         case, not the font case. */
      THEME = typeof message.css === 'string' ? message.css : '';
      restyle();
      return;
    }
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
        reported: false,
        follow: message.reveal,
        /* The documents this Utterance has already been centred in; see centreOnce. */
        centred: new WeakSet(),
        /* The section follow() asked epub.js to display for this Utterance, until
           it arrives; see attach. */
        awaiting: null
      };
      var wrong = mismatch(message.utteranceRanges);
      if (wrong) {
        report(wrong);
        state = null;
        clearHighlights();
        return;
      }
      /* Whether or not the section is on screen, the state is kept: attach()
         installs the highlight when epub.js renders it. And the page is followed
         either way — a Block whose section epub.js has not rendered still has its
         CFI here, and that is exactly the case where the reading has crossed into
         text the reader cannot see. */
      var shown = showUtterance();
      if (message.reveal) follow(shown);
      /* **What is on the page has been reported**, checked once per Utterance —
         and then the section after it asked for if it is missing. Neither depends
         on where the page is or on whether this Utterance could be painted.

         The sweep went here when nothing else reported a section epub.js had put
         on the page by itself — 'rendered' never reached this program (ADR 0036)
         and 'relocated' comes only when a scroll stops. The content hook now does;
         this stays as a second look. Measured on the owner's book at 05:31, in the
         state the 04:43 reading died in:
         views [3, 4d, 5d] with section 5 holding a live document, \`known\` still
         108, and section 5 never adopted — because \`liveContents\` adopts only the
         section it is asked about, and nothing asks about a section the reading
         has not reached. One \`rendition.getContents()\` and a WeakMap lookup per
         rendered view, once a sentence; \`adopt\` is idempotent per document. */
      sweep();
      renderAhead(sectionSpoken(message.utteranceRanges));
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
