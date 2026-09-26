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
 *   `flow: 'scrolled-continuous'` (ADR 0011), and the page holds the **line the
 *   spoken word is on** at the Line Position, the middle of what can be seen
 *   (ADR 0050). By line, the default: when the word moves onto another line the
 *   page glides that line there, in 250 ms, easing out; a sentence that begins
 *   on the line being read moves nothing. Continuous, the owner's other choice:
 *   the page moves all the while, carrying the line past the Line Position by how
 *   far along it the word is, so the next line arrives as the voice does. A Clip
 *   without Word Timings holds its whole Utterance there instead, in either, as
 *   every Utterance was held before. It is measured from the
 *   `Range`s that were just painted and the scroll container's own box, and it
 *   runs in here, on the Clip cue and on the words the loop already draws — no
 *   message of its own, and nothing across the bridge per word (ADR 0005).
 *   What can be *seen*: ADR 0020's player floats over the bottom of that
 *   container and tells this file how much it covers.
 * - **Whether the page is following, and the way back** (#71, ADR 0050). A
 *   finger that drags the page, or a Contents row while paused, is Browsing,
 *   and the page stays where it was put across sentences. It comes back when
 *   the owner asks — a revealed highlight, or M (the 'return' message) — when
 *   the player collapses ('followOnly', which also stops a finger scrolling the
 *   page), or by itself at a sentence that begins, while playing, with its first
 *   line on the visible page. Whether it is following crosses to the app only
 *   when it changes, for the player's A or M.
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
 *   line being spoken is brought back to the Line Position afterwards — which is
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
import { BAKED_LINE_POSITION, BAKED_SCROLLING, GLIDE_SOURCE } from './glide';
import type { HighlightMessage } from './messages';
import { BLOCKS_MESSAGE, DOCUMENT_MESSAGE, FOLLOWING_STATE_MESSAGE, PROBLEM_MESSAGE, TAP_MESSAGE } from './messages';

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
/** The sentence and the word being spoken, on a dark page: blue, so the word keeps `DARK_TEXT` and stays readable (`themeCss`, #69). */
const DARK_UTTERANCE = '#434665';
const DARK_WORD = '#4456de';

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
 * `highlightCss`, which are tuned for a light page. **Under dark they are blue,
 * not amber, and the word's letters keep the page's own `DARK_TEXT`** (#69): no
 * `color` is declared, so the spoken word is the same light text as every other
 * word, marked rather than recoloured. Amber cannot carry light letters: it is a
 * bright colour, so `#e6e6ea` on the old word amber (0.85 over the sentence tint)
 * measured 1.85:1 and pure white 2.31:1, which is why the letters used to be set
 * to the page colour — and an amber dark enough to reach 4.5:1 is brown. Blue is
 * seen as dark while it stays vivid: `DARK_WORD` measures 4.65:1 against
 * `DARK_TEXT`, about what Speechify's dark page gets from white on its own blue,
 * 4.63:1 (sampled from the owner's screenshot, notes 2026-09-25);
 * `DARK_UTTERANCE` is Speechify's own sentence colour, 7.33:1.
 * Both are opaque because the page under them is one colour, so a tint would buy
 * nothing and would make the measured contrast depend on what it is laid over.
 * The light theme keeps its amber, and so does the app's accent (design 0042).
 */
export function themeCss(scheme: ReadingScheme): string {
  if (scheme !== 'dark') return '';
  return (
    'html, body { background-color: ' + DARK_PAGE + ' !important; color: ' + DARK_TEXT + ' !important; }\n' +
    'body * { color: ' + DARK_TEXT + ' !important; background-color: transparent !important; }\n' +
    '::highlight(' + UTTERANCE_HIGHLIGHT + ') { background-color: ' + DARK_UTTERANCE + '; }\n' +
    '::highlight(' + WORD_HIGHLIGHT + ') { background-color: ' + DARK_WORD + '; }\n'
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
    'var FOLLOWING = ' + JSON.stringify(FOLLOWING_STATE_MESSAGE) + ';\n' +
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
    /* Where the line being spoken is held while the page follows, as a share of
       the visible page's height from its top: the Line Position (CONTEXT.md,
       ADR 0050). The middle until the 'following' message says otherwise. */
    'var LINE_POSITION = ' + BAKED_LINE_POSITION + ';\n' +
    /* And how the page moves to keep it there: 'line', a line at a time, or
       'continuous' (#71). By line until the 'following' message says otherwise. */
    'var SCROLLING = ' + JSON.stringify(BAKED_SCROLLING) + ';\n' +
    /* How the page moves to it: glideLeft, sameLine, glides, lineLead and
       driftVelocity, from glide.ts, where the tests run the same text. */
    GLIDE_SOURCE +
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
     geometry that was true before ADR 0020's player existed. See visibleOf(). */
  var covered = 0;
  /* The open player's own height, without the notes it shows (the 'inset'
     message's openPx, #71): what the line position is measured above, so that a
     note and the player collapsing move nothing. Zero until the open player has
     been measured, and \`covered\` stands in. See lineAt(). */
  var openPlayer = 0;
  /* The lowest spine item on the page, from the last sweep. The only thing the
     resize recovery has to aim at; see the resize handler. */
  var onScreen = null;
  /* The owner has moved the page away from the reading, and it stays where they
     put it: Browsing (CONTEXT.md, #52), the player's M (#71). Set by a Contents
     row while the reading is paused (the 'browse' message) and by a finger
     dragging the page. Cleared by a highlight that is revealed — Play's first
     cue, a tapped sentence, a skip or a place from another device — by M (the
     'return' message), by the player collapsing ('followOnly'), and by itself
     at a sentence that begins, while the reading plays, with its first line on
     the visible page ('speak' with \`recover\`): Zotero-TTS's rule, ADR 0050.

     Otherwise nothing brings the reading back: not the next sentence, not the
     reading's own section arriving, and not an Appearance change. Measured on
     2026-09-23 at 23:30 before it existed: a display of the section after the
     reading's re-rendered the reading's section as its neighbour, attach()
     centred the paused sentence as it arrived (a scroll of -7,424 px, from
     centreOnce), and epub.js then trimmed away the section the owner had asked
     for.

     Written only through setBrowsing(), which tells the player when it changes. */
  var browsing = false;
  /* Whether the player has last been told the page follows the reading: what
     setBrowsing() compares against, so that the message crosses only on a
     change. The program starts following, and so does the player. */
  var announced = true;
  /* The player is collapsed and the page only follows (#71): no finger moves it
     and none starts Browsing. See the 'followOnly' message. */
  var followOnly = false;
  /* The scroll container's overflow as epub.js had set it before the page was
     locked, to be given back when it is unlocked, or null while it is not
     locked; see lockPage(). */
  var unlockedOverflow = null;
  /* The line the page last brought to the line position (ADR 0050), as lineOf()
     describes it, or null. A word on another line is what moves the page. */
  var followed = null;
  /* The glide under way, or null: what it aims at, how far it had to go and
     when it began. See bring(). */
  var glide = null;
  var glideFrame = 0;
  /* Continuous (#71): what the page is drifting towards — a line, and how far
     past the line position the spoken word's place along it carries that line
     — with the page's speed, the fraction of a pixel it has yet to move, and the
     last frame. Null in By line, and before the first word. See drift(). */
  var drifting = null;
  var driftFrame = 0;
  /* One frame at 60 Hz, which is what a glide's first frame counts as. */
  var FRAME_MS = 1000 / 60;
  /* The touch that may be dragging the page, and where it first moved. */
  var touchId = null;
  var touchY = null;
  /* Further than a tap's jitter: a finger that moves this far is not tapping. */
  var DRAG_PX = 10;

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

  /* A finger dragging the page is Browsing too (#52): the page goes where the
     owner takes it, and the reading stays. Passive, so the scroll is the
     platform's own and nothing here can slow it down.

     Only touchmove, and no touchstart or touchend: the long press on text is the
     platform's, and this program listens for nothing near it (see tapped). So a
     touch is recognised by its identifier, which is new for every finger that
     comes down, and measured from where it first moved. A tap cannot set it by
     accident: a finger that moves further than a tap's jitter is not a click,
     and a tap that does reach tapped() moves the reading, whose highlight is
     revealed, which clears it again. Heard in each section document, where
     almost every touch lands, and in the scroll container for the margins
     between them; a touch stays in the document it came down in, so its
     coordinates never change hands.

     **Any** move of a finger on the page also stops a glide where the page is,
     as a finger stops a scroll on the phone (ADR 0050), whether or not it goes
     on to be a drag. That alone does not browse: a finger that lifts without
     dragging leaves the page following, and the next line brings it back to the
     line position. It is heard here, on the first move, and not on
     \`touchstart\`, for the rule above; what that costs is a finger held
     perfectly still, under which the rest of one glide — at most 250 ms — still
     plays out. */
  function dragged(event) {
    /* A page that only follows (the player collapsed, #71) cannot be taken by a
       finger at all, so a finger moving on it neither stops a glide nor browses:
       lockPage() has already made its scroll the program's alone. */
    if (followOnly) return;
    var touch = event.touches && event.touches.length ? event.touches[0] : null;
    if (!touch) return;
    halt();
    if (touch.identifier !== touchId) {
      touchId = touch.identifier;
      touchY = touch.clientY;
      return;
    }
    if (Math.abs(touch.clientY - touchY) > DRAG_PX) setBrowsing(true);
  }

  /* Browsing starts or ends, and the player's A or M is told — once, when it
     changes, never per word (#71). The only place \`browsing\` is written. */
  function setBrowsing(value) {
    browsing = !!value;
    var following = !browsing;
    if (following === announced) return;
    announced = following;
    post({ type: FOLLOWING, following: following });
  }

  /* Whether the page can be scrolled by a finger: not while it only follows.

     By epub.js's own switch, its Stage's \`overflow()\`, which is how the
     library itself sets this container's overflow — \`overflow-y: scroll\` when
     it builds a scrolled Stage, and again whenever its flow changes (read out of
     the bundled epub.js). \`hidden\` makes the container one a finger cannot
     scroll and the program still can: \`scrollBy\` and \`scrollTop\` move it and
     fire its scroll events, which is what epub.js appends and trims on, so the
     glides, the displays and the sections the reading walks into all go on.
     Taps are clicks, and a click does not care. The Stage remembers what it was
     given, so anything of epub.js's that set it again would set it to the same.

     Not a non-passive \`touchmove\` calling preventDefault: that puts this
     program in the way of every scroll the phone makes, and this file listens
     passively for exactly that reason. Not a style or a class of this
     program's own: the only DOM this program writes is the stylesheet a
     highlight needs and the alignment mark (ADR 0005, ADR 0034). */
  function lockPage(on) {
    var stage = rendition.manager ? rendition.manager.stage : null;
    if (!stage || typeof stage.overflow !== 'function') return;
    if (on) {
      if (unlockedOverflow === null) unlockedOverflow = (stage.settings && stage.settings.overflow) || 'scroll';
      stage.overflow('hidden');
      return;
    }
    if (unlockedOverflow === null) return;
    stage.overflow(unlockedOverflow);
    unlockedOverflow = null;
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
    /* And a finger dragging this document's text is Browsing, and a finger
       moving on it at all stops a glide: see dragged. */
    contents.document.addEventListener('touchmove', dragged, { passive: true });

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
    return !!(state && (state.follow || browsing) && offPage(ranges));
  }

  /* Returns the built ranges rather than a boolean, so that the caller which has
     just painted them measures *those* rather than building a second set to
     measure — follow() below needs the very Ranges that are on the page.
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

  /* \`quiet\` paints the word and leaves the page where it is: attach() repaints
     a section that has only just arrived, and places the page itself once it has
     (see there). Everything else lets the page follow the word. */
  function showWord(ranges, quiet) {
    var built = build(ranges);
    if (!built) {
      if (!awaited(ranges)) report(why(ranges));
      return;
    }
    var registry = registryFor(built.window);
    moveTo(registry);
    put(registry.word, built.ranges);
    if (!quiet) followWord(built, ranges);
  }

  /* The word the highlight belongs on, walking back over any whose range list is
     empty — a word can fall entirely on the space rejoin.ts inserted between two
     Blocks, which is in the Utterance and in no Block. */
  function showAt(index, quiet) {
    if (!state || !state.words) return;
    var at = index < state.words.length ? index : state.words.length - 1;
    for (; at >= 0; at--) {
      if (state.words[at].ranges.length) {
        showWord(state.words[at].ranges, quiet);
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

  /* ---- following the line being spoken (ADR 0005, ADR 0011, ADR 0050) ---- */

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

  /* The first line a built Range list is drawn on, with what it takes to find
     that line again: its section document, the iframe that places that document
     on the page, the Range, and the line's top and height in the document's own
     coordinates, which scrolling the page does not change. For a word it is the
     line the word begins on, so a word the line breaks is followed where it
     starts; for an Utterance, the line it begins on.

     A rect with no width is not a line: WebKit gives a Range that starts where
     a line wraps an empty rect at the end of the line before, and aiming at it
     would hold the wrong line until the next word moved the page again.

     Also where on that line it begins (\`left\`), and which of the Ranges it is
     (\`index\`), which is what Continuous measures how far along the line the
     word is from (leadOf). */
  function lineOf(built) {
    var frame = built.window.frameElement;
    if (!frame) return null;
    for (var i = 0; i < built.ranges.length; i++) {
      var rects = built.ranges[i].getClientRects();
      for (var j = 0; j < rects.length; j++) {
        if (rects[j].height && rects[j].width) {
          return { doc: built.window.document, frame: frame, range: built.ranges[i], index: i, top: rects[j].top, height: rects[j].height, left: rects[j].left };
        }
      }
    }
    return null;
  }

  /* Continuous (#71): how far past the line position the line being spoken is
     carried, in px — the word's share of the way along its line times the
     distance to the next line (lineLead, glide.ts). \`ranges\` are the Block
     ranges \`line\` was measured from.

     The line's extent is the text drawn on it, not the Block's box: the last
     line of a paragraph stops short, and a Document's own centred line starts
     late, and against the box neither would ever be read to its end, so the page
     would still owe part of a line when the voice left it. The distance to the
     next line is the next line's own top; on a paragraph's last line, where
     there is none, the distance from the line before; on a Block of one line,
     its own height. The gap to the next paragraph is not in it: that is a move
     of its own, made by a glide (steer).

     Measured over the text around the word rather than the whole Block, so that
     a Block the length of a chapter — a Document that is one <div> with <br>s —
     costs the same as a paragraph: NEAR characters either side is more than a
     line of the longest line there is. */
  var NEAR = 400;
  function leadOf(ranges, line) {
    var at = ranges[line.index];
    var live = at ? liveBlock(at.block) : null;
    if (!live) return 0;
    var span = nearby(live, at.start - NEAR, at.start + NEAR);
    if (!span) return 0;
    var rects = span.getClientRects();
    var bottom = line.top + line.height;
    var from = Infinity;
    var to = -Infinity;
    var below = Infinity;
    var above = -Infinity;
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (!rect.height || !rect.width) continue;
      if (Math.min(rect.bottom, bottom) - Math.max(rect.top, line.top) > Math.min(rect.height, line.height) / 2) {
        if (rect.left < from) from = rect.left;
        if (rect.right > to) to = rect.right;
      } else if (rect.top > line.top) {
        if (rect.top < below) below = rect.top;
      } else if (rect.top > above) {
        above = rect.top;
      }
    }
    var pitch = below < Infinity ? below - line.top : above > -Infinity ? line.top - above : line.height;
    if (!(pitch > 0) || pitch > 3 * line.height) pitch = line.height;
    return lineLead(line.left, from, to, pitch);
  }

  /* A Range over the live Block's text from \`from\` to \`to\`, pulled in to the
     text nodes that are there: an offset past either end, or on text the walk
     kept in the Block and no node holds, snaps to the nearest one that does. */
  function nearby(live, from, to) {
    var first = null;
    var last = null;
    for (var i = 0; i < live.parts.length; i++) {
      var part = live.parts[i];
      if (part.at + part.len > from && part.at < to) {
        if (!first) first = part;
        last = part;
      }
    }
    if (!first || !last) return null;
    var dom = live.document.createRange();
    dom.setStart(first.node, Math.max(0, from - first.at));
    dom.setEnd(last.node, Math.min(last.len, to - last.at));
    return dom;
  }

  /* Where that line's middle is now, in the top document's coordinates, or null
     once its document has gone. Measured afresh every time and never
     remembered: epub.js moves the scroll position itself when it adds or trims a
     section above (ADR 0045), and a remembered position would aim at where the
     line used to be. */
  function middleOf(line) {
    if (!line.doc.defaultView) return null;
    var rects = line.range.getClientRects();
    for (var j = 0; j < rects.length; j++) {
      if (rects[j].height && rects[j].width) return line.frame.getBoundingClientRect().top + (rects[j].top + rects[j].bottom) / 2;
    }
    return null;
  }

  /* The ranges of the word being spoken, walking back over any that are empty as
     showAt() does, or null before the Clip's first word. */
  function spokenRanges() {
    for (var at = Math.min(state.next, state.words.length) - 1; at >= 0; at--) {
      if (state.words[at].ranges.length) return state.words[at].ranges;
    }
    return null;
  }

  /* What the page holds at the line position now (ADR 0050).

     With Word Timings, the line the word being spoken begins on — and before the
     Clip's first word, the line the Utterance begins on, so that a sentence
     beginning on the line being read moves nothing. A Clip that came without
     them has no word to follow, and none is estimated (ADR 0005): the Utterance
     is the unit, and the whole of it is held there, as every Utterance was
     before. A sentence shown with no Clip at all — a tap or a skip while
     paused, which the bridge sends with no words and a zero duration — is held
     by its first line, where the first word will be when Play starts it, so that
     Play does not move the page a second time.

     Continuous carries that line past the line position by the \`lead\` of the
     word it is measured from (leadOf): before the first word, the Utterance's
     own start, which is where the sentence before it left off. */
  function aim() {
    if (!state) return null;
    if (state.words || !state.durationMs) {
      var ranges = (state.words && spokenRanges()) || state.utteranceRanges;
      var built = build(ranges);
      var line = built ? lineOf(built) : null;
      if (!line) return null;
      return SCROLLING === 'continuous' ? { line: line, lead: leadOf(ranges, line) } : { line: line };
    }
    var whole = build(state.utteranceRanges);
    return whole ? { whole: whole } : null;
  }

  /* How much of the scroll container can be seen. ADR 0020's player floats over
     its bottom so that the text never reflows when it appears, and \`covered\` is
     the player's own measured height; it changes when the player collapses and
     expands, which is why it is an input here rather than a constant subtracted
     once. An inset at least as tall as the container leaves nothing to aim in,
     and then moveFor() is the tall-Utterance rule: the top goes to the top. */
  function visibleOf(view) {
    var visible = view.clientHeight - covered;
    return visible < 0 ? 0 : visible;
  }

  /* Where the line position is, in the top document's coordinates: that share
     of the visible page with the player **open and without notes** (#71). Not
     visibleOf(), which is what can be seen now: a note on the player makes it
     taller, and the player collapses to one button, and a line position
     measured against either moved the target with it — measured, a note that
     came and went while paused left the line 87 px above the middle until Play.
     The owner's choice is the height as it was before collapsing, so that
     collapsing leaves the line where it is. Before the open player has been
     measured, what can be seen now stands in. */
  function lineAt(view, bounds) {
    var under = openPlayer > 0 ? openPlayer : covered;
    var visible = view.clientHeight - under;
    if (visible < 0) visible = 0;
    return bounds.top + visible * LINE_POSITION;
  }

  /* How far the page has to move for what is aimed at to sit at the line
     position, or null when it cannot be measured. The line position is a share
     of what can be **seen**, not of the container: against \`clientHeight\` it
     would aim at a point the player is standing on and hold the words being
     spoken behind it. A \`lead\` (Continuous) carries the line that much further
     up past it, so the page has that much further to go. */
  function moveFor(aimed) {
    var view = scroller();
    if (!view) return null;
    var bounds = view.getBoundingClientRect();
    var at = lineAt(view, bounds);
    if (aimed.line) {
      var middle = middleOf(aimed.line);
      return middle === null ? null : middle - at + (aimed.lead || 0);
    }
    var box = boxOf(aimed.whole);
    if (!box) return null;
    var move = (box.top + box.bottom) / 2 - at;
    /* Unless the Utterance is taller than the screen, where holding its middle
       would push its opening words off the top — and those are the words about to
       be spoken. Then its start goes to the top of the screen instead, and the
       highlight walks down from there. */
    if (move > box.top - bounds.top) move = box.top - bounds.top;
    return move;
  }

  /* The one place the page is scrolled. Through the manager's own scroll, and
     deliberately **without** its \`ignore\` flag: this has to reach epub.js exactly
     as a finger scroll does, because that is what makes the continuous manager
     append the section the reading is about to walk into. A scroll it was told to
     ignore renders nothing new.

     And the position it leaves the page at is remembered as the program's own
     (\`ownTop\`), so that the wait for the page to rest before anything above it
     changes (#58, holdStill) does not count it as the page moving. That wait is
     for iOS moving the page, which drops epub.js's own corrections; this is a
     scroll the page has already taken, synchronously, before anything else can
     run. Only when nothing else has moved the page since the last scroll event:
     otherwise the page may be under a finger or in a fling, and the position
     that says so is left to say it. */
  function nudge(by) {
    var stage = scroller();
    var before = stage ? stage.scrollTop : null;
    rendition.manager.scrollBy(0, by, false);
    if (!stage) return;
    ownTop = stage.scrollTop;
    if (scrolledTop === null || scrolledTop === before) scrolledTop = ownTop;
  }

  /* Stop the page where it is now: a finger landing on the page, a drag, and
     anything that puts the page somewhere at once. A glide ends, and a drift
     keeps what it is drifting towards but stops moving, until the next word. */
  function halt() {
    glide = null;
    if (glideFrame) {
      window.cancelAnimationFrame(glideFrame);
      glideFrame = 0;
    }
    rest();
    if (driftFrame) {
      window.cancelAnimationFrame(driftFrame);
      driftFrame = 0;
    }
  }

  /* Move the page so that what is aimed at sits at the line position (ADR 0050).
     Returns whether there was anything to measure.

     Nothing under a pixel: there is nothing to see, and every scroll costs
     epub.js a pass over its views. At once when \`instant\`, and when the move is
     further than the visible page: a glide would only pull a page of text the
     owner has not read past their eye. Otherwise a glide of GLIDE_MS, easing out,
     whatever the distance. A glide already on its way to the same line is left
     to arrive; one on its way anywhere else is taken over from where the page is
     now. */
  function bring(aimed, instant) {
    if (!aimed) return false;
    var move = moveFor(aimed);
    if (move === null) return false;
    if (aimed.line) followed = aimed.line;
    if (!instant && glide && aimed.line && glide.aimed.line && sameLine(glide.aimed.line, aimed.line)) return true;
    if (Math.abs(move) < 1) {
      halt();
      return true;
    }
    if (instant || !glides(move, visibleOf(scroller()))) {
      halt();
      nudge(move);
      return true;
    }
    glide = { aimed: aimed, from: move, elapsed: 0, last: null };
    if (!glideFrame) glideFrame = window.requestAnimationFrame(glideStep);
    return true;
  }

  /* One frame of a glide. What it aims at is measured again every frame, and the
     page moved by the difference between where that is and where the curve says
     it should be by now. So a section epub.js trims or adds above mid-glide,
     which moves the scroll position under it, costs nothing: the next frame aims
     at where the line actually is. It stops, where the page is, when the page
     stops following. */
  function glideStep(now) {
    glideFrame = 0;
    if (!glide) return;
    if (!state || !state.follow || browsing) {
      glide = null;
      return;
    }
    var move = moveFor(glide.aimed);
    if (move === null) {
      glide = null;
      return;
    }
    /* The curve is timed in frames that were drawn, not by the clock: each frame
       advances it by the time since the last one, but never by more than two
       frames' worth, and the first frame by one. A glide is asked for in the same
       task that starts a Clip, lays out a section or answers a tap, and the frames
       after that work can be held up for most of a second. Timed by the clock,
       measured on the owner's book, a glide asked for at a tap drew its first
       frame 800 ms late, past the whole curve, and moved 252 px in two frames. A
       stall now pauses a glide instead of spending it. */
    glide.elapsed += glide.last === null ? FRAME_MS : Math.min(now - glide.last, 2 * FRAME_MS);
    glide.last = now;
    var left = glideLeft(glide.from, glide.elapsed);
    var by = move - left;
    if (Math.abs(by) >= 0.5) nudge(by);
    if (left === 0) {
      glide = null;
      /* Continuous: the words went on while it glided, and the drift takes the
         page on from here. */
      kick();
      return;
    }
    glideFrame = window.requestAnimationFrame(glideStep);
  }

  /* ---- Continuous (#71, ADR 0050) ---- */

  /* The page drifting towards what the words say, for the word just drawn or
     the Utterance just cued: a line carried \`lead\` px past the line position.

     A move of more than a line is not a drift. The next paragraph's first line
     past its gap, a heading, a sentence somewhere else: those are moved as every
     other move is, by bring() — a glide within the visible page, a jump beyond
     it — and the drift takes over from where that leaves the page. A move of
     less is the words going on along a line, or onto the next one, which the
     lead has already carried the page nearly all the way to: that is the drift. */
  function steer(aimed) {
    if (!aimed) return false;
    if (!aimed.line) return bring(aimed, false);
    var move = moveFor(aimed);
    if (move === null) return false;
    followed = aimed.line;
    if (drifting) drifting.aimed = aimed;
    else drifting = { aimed: aimed, speed: 0, owed: 0, last: null };
    if (Math.abs(move) > aimed.line.height) {
      rest();
      return bring(aimed, false);
    }
    /* A glide under way hands over to the drift when it ends. */
    if (!glide) kick();
    return true;
  }

  function kick() {
    if (SCROLLING !== 'continuous' || !drifting || driftFrame) return;
    driftFrame = window.requestAnimationFrame(drift);
  }

  /* Where the page is is where it stays: no speed, nothing owed, and the next
     frame's clock starts again. What it drifts towards is kept. */
  function rest() {
    if (!drifting) return;
    drifting.speed = 0;
    drifting.owed = 0;
    drifting.last = null;
  }

  /* One frame of a drift: the critically damped follower of glide.ts's
     driftVelocity, run on the move still to make, measured again every frame
     like a glide's, so that epub.js moving the scroll position under it is
     absorbed rather than chased.

     **Whole pixels.** WebKit keeps an element's scroll position in whole CSS
     pixels (measured, notes/NOTES_2026-09-26.md, 01:33), and a reading moves the
     page some 5 to 10 px a second, a fraction of a pixel a frame. So the drift
     owes the page the fractions and pays them a pixel at a time; and it steers
     by the move less what it owes, or the pixel it has not yet paid would read as
     one still to make, and it would push on past the line and back. Timed in
     drawn frames, at most two frames' worth each, as a glide is, so a stall
     slows it rather than throwing it forward.

     It rests when it is there and has all but stopped, which is soon after the
     last word of a sentence, and a new word sets it going again (kick). */
  function drift(now) {
    driftFrame = 0;
    if (!drifting || glide) return;
    if (!state || !state.follow || browsing || SCROLLING !== 'continuous') {
      rest();
      return;
    }
    var move = moveFor(drifting.aimed);
    if (move === null) {
      rest();
      return;
    }
    var dt = drifting.last === null ? FRAME_MS : Math.min(now - drifting.last, 2 * FRAME_MS);
    drifting.last = now;
    var error = move - drifting.owed;
    drifting.speed = driftVelocity(error, drifting.speed, dt);
    drifting.owed += drifting.speed * dt;
    var whole = drifting.owed > 0 ? Math.floor(drifting.owed) : Math.ceil(drifting.owed);
    if (whole) {
      nudge(whole);
      drifting.owed -= whole;
    }
    if (Math.abs(error) < 0.5 && Math.abs(drifting.speed) < DRIFT_RESTS) {
      rest();
      return;
    }
    driftFrame = window.requestAnimationFrame(drift);
  }

  /* Below this speed, in px per ms — 2 px a second — a drift that has arrived
     has stopped: its last fraction of a pixel is not worth a frame loop. */
  var DRIFT_RESTS = 0.002;

  /* The one way a page that follows is sent after the reading when the reading
     moves: by bring() a line at a time, and in Continuous by steer(), which
     drifts what it can and brings the rest. */
  function approach(aimed) {
    return SCROLLING === 'continuous' ? steer(aimed) : bring(aimed, false);
  }

  /* A word has just been drawn. By line, the page follows only when it has
     moved onto another line: the words of one line are read with the page
     still, and the page moves up a line as the voice moves down one. This runs
     in the WebView, on the word the loop already draws, so nothing is added to
     the bridge (ADR 0005), and the loop scrolls at most once a line, never once
     a frame.

     Continuous, every word moves where the page is going — by how far along its
     line it is (leadOf) — and the drift, not the loop, moves the page there, a
     pixel at a time on its own frames. */
  function followWord(built, ranges) {
    if (!state || !state.follow || browsing || !state.words) return;
    var line = lineOf(built);
    if (!line) return;
    if (SCROLLING === 'continuous') {
      steer({ line: line, lead: leadOf(ranges, line) });
      return;
    }
    if (sameLine(followed, line)) return;
    bring({ line: line }, false);
  }

  /* Whether a sentence that is beginning can be seen: the middle of the line it
     begins on lies within the visible page as it is now — below the top of the
     scroll container and above whatever the player covers at this moment, not
     the open player the line position is measured against, because what counts
     is what the owner can see.

     The other half of Zotero-TTS's rule (ADR 0050): a page the owner took away
     while the reading plays is taken back at a sentence they can see beginning,
     and left alone at one they cannot. Never while the page is still moving —
     a fling coasting on after the finger lifts, which a glide would fight; the
     next sentence asks again. */
  function onVisiblePage(built) {
    if (moving()) return false;
    var view = scroller();
    var line = built ? lineOf(built) : null;
    if (!view || !line) return false;
    var middle = middleOf(line);
    if (middle === null) return false;
    var top = view.getBoundingClientRect().top;
    return middle >= top && middle <= top + visibleOf(view);
  }

  /* At once, for what is being read now: a section that arrived wherever epub.js
     put it, and the text reflowing under an Appearance change. Nothing that was
     gliding should go on by then. */
  function place() {
    return bring(aim(), true);
  }

  /* Once per document per Utterance, and \`centred\` is what makes it once: a
     placing that causes epub.js to render a section would otherwise be answered
     by attach(), which would place again, which would render again. It is a
     WeakSet, so a document epub.js destroys is not held alive by having been
     placed in — the thing the Block records exist not to hold. */
  function placeOnce(built) {
    if (!state || !state.follow || browsing) return;
    var doc = built.window.document;
    if (state.centred.has(doc)) return;
    if (place()) state.centred.add(doc);
  }

  /* The text has reflowed under an Appearance change, so the line being spoken
     is no longer where it was put — a font change moves every line in the book,
     and the one the owner is listening to with it.

     **Not on this frame.** epub.js resizes each section's iframe from the
     section's own ResizeObserver, whose callback is
     \`requestAnimationFrame(this.resizeCheck.bind(this))\` — read out of the
     bundled epub.js — so the geometry this needs is a frame or more away, and
     placing against a box that is about to move aims at where the line was. So
     it is measured every frame until nothing needs moving, and placed each time.

     **And on every frame of the window, not once at the end.** The first version
     waited for two frames with the same geometry and then centred once; it held
     the Utterance to 0.758 px when the text grew and left it **4,285 px** out when
     the text shrank, because a page can look settled for a frame while epub.js is
     still resizing iframes and the continuous manager has yet to re-lay the views
     out. Placing every frame converges on whatever the layout ends up doing
     instead of guessing when to look, and it is nearly free: bring() scrolls only
     when the move is at least a pixel, so a settled page costs one measurement a
     frame and no scroll at all. At once, never a glide: the text has jumped by
     itself, and a glide would chase it.

     \`SETTLE_FRAMES\` is a cap and not a duration: it exists so that a document
     whose layout never settles cannot hold a frame loop open. The loop leaves
     early — three frames in which nothing needed moving — so its value is what
     a pathological document costs and not what an ordinary one does. Nothing is
     placed at all when nothing is being read: there is no line to hold, and
     scrolling a page the owner is reading with their eyes is the thing ADR 0020's
     floating player exists not to do. */
  function settle(left, still) {
    if (!state || !state.follow || browsing) return;
    var aimed = aim();
    var move = aimed ? moveFor(aimed) : null;
    if (move === null) {
      if (left > 0) window.requestAnimationFrame(function () { settle(left - 1, 0); });
      return;
    }
    var steady = Math.abs(move) < 1 ? still + 1 : 0;
    bring(aimed, true);
    if (steady >= 3 || left <= 0) return;
    window.requestAnimationFrame(function () {
      settle(left - 1, steady);
    });
  }

  /* The page following the voice, for the Utterance now starting. \`built\` is
     what showUtterance() just painted, or null.

     Two cases, and only the second moves the reading position: the section is on
     the page, and the page brings the Utterance's first line to the line
     position — a glide when it is within the visible page, which is the next
     line at every sentence that begins on a new one, a tapped sentence and a
     skip; or it is not rendered at all — the reading has run ahead of the
     document — and only a display() can get there. The page is then placed in
     attach(), when the section arrives. Continuous drifts to a sentence that
     goes on from where the last one ended rather than gliding to it (approach). */
  function follow(built) {
    if (!state) return;
    if (built) {
      if (!state.follow || browsing) return;
      if (approach(aim())) state.centred.add(built.window.document);
      return;
    }
    var record = blocks.get(state.utteranceRanges[0].block);
    if (!record || !record.cfi) return;
    /* attach() places this section on the frame after it arrives rather than
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
     The only thing that scrolls while a book is being read aloud is the page
     following the voice, and it stops at the line being spoken. So a section whose text
     ends far above its own bottom runs the reading out of Utterances with the
     rest of the book still unrendered, and nothing is left that would make more:
     measured on the fixture at 05:03, one view, scrollTop 0, clientHeight 758,
     scrollHeight 3,072 — 758 + 500 is 1,258, and 1,258 < 3,072 for ever.

     The trigger is the Clip cue, which already arrives once per Utterance and
     already starts the page following, so **nothing is added to the bridge** —
     the property ADR 0011 states of the following and the reason it is stated.

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
    /* Quietly: the word is painted here and the page is placed below, at once,
       rather than by a glide from a word that has only just been laid out. */
    showAt(state.next - 1, true);
    /* And it arrived wherever epub.js put it, which is not the line position.
       Two ways in: the reading ran ahead of the document and follow() displayed
       the section, or the manager destroyed this section's view and rebuilt it
       while the same Utterance was being spoken. Both want placing now that
       there is something to measure — and the first wants it a frame from now.

       **A section follow() asked for arrives before its display has finished**
       (#50). This runs in epub.js's content hook, and the same display goes on,
       in the same task, to its own moveTo(): a scroll to the top of the Block the
       CFI names, added to whatever this scrolled. Measured on the owner's book at
       19:28 on 2026-09-23, Play with the page scrolled away from Block 6.13: the
       centring scrolled 725 px, the moveTo 958 px more, and the sentence — painted
       — ended 724 px above the top of the screen. So the Utterance is painted now
       and placed on the next frame, after that moveTo and after the views are
       shown, through settle(), which also follows the page while fill() lays the
       neighbouring sections out around it. A section that arrives any other way
       has no scroll of epub.js's behind it, and is placed at once. */
    if (state.awaiting === contents.sectionIndex) {
      state.awaiting = null;
      var mine = state;
      window.requestAnimationFrame(function () {
        if (state === mine) settle(SETTLE_FRAMES, 0);
      });
    } else {
      placeOnce(built);
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

  /* ---- nothing above the page moves while the page does (#58, ADR 0045) ---- */

  /* epub.js keeps the text still, whenever it changes what lies above the
     viewport, by scrolling the page itself: trim() erases the sections that have
     left the top of the screen and scrolls back by their height, and a section
     prepended above scrolls the page on by its own height once it has laid out
     (counter()). iOS drops that scroll while it is moving the page itself —
     under the finger, in a fling's momentum, in the bounce at either end — and
     the text jumps by the whole section. Measured on the owner's book (#58): a
     5,362 px section erased above left the page 5,362 px further on, past the
     laid-out text and empty for six frames; four sections prepended during the
     bounce at the top left it four sections back, empty for half a second. An
     \`Element.scrollBy()\` in place of the assignment was dropped the same way,
     and a scroll set while iOS was not moving the page was kept every time.

     So nothing above the viewport changes while the page moves. A trim, and a
     check() that would prepend, are parked, and run through the manager's own
     queue once the page has come to rest. Below the viewport nothing needs
     adjusting, so appending goes on as before and a fling forward is not held
     up at all: the sections it leaves behind keep their height, empty, until
     the first rest. A fling back stops at the top of the text laid out so far,
     as it does at the top of a document, and the chapter before is laid out
     once the page is still (docs/design/0045).

     **The program's own scroll is not the page moving** (#71, ADR 0050). What
     drops epub.js's correction is iOS moving the page; the page following the
     reading is this program setting the position, synchronously, through the
     same assignment epub.js's correction makes, and a correction between two of
     them is kept — measured, an erase above between per-frame program scrolls
     left the text where it was (notes/NOTES_2026-09-24.md, 02:35;
     notes/NOTES_2026-09-26.md, 01:42). Continuous moves the page all the while a
     sentence is read, and counted as moving it would park every trim until the
     reading paused, and the sections behind it would pile up for as long as the
     owner listened. So a scroll event that finds the page where the program
     last put it (\`ownTop\`, set in nudge()) is not movement, and neither is a
     frame that does. Any other position is, exactly as before: a finger, a
     fling, a bounce, epub.js's own correction. */
  var REST_MS = 200;
  var REST_FRAMES = 4;
  var parked = { trim: false, check: false };
  var scrolledAt = -Infinity;
  var scrolledTop = null;
  var ownTop = null;
  var resting = { top: null, since: 0, frames: 0 };
  var watching = false;

  function noteScroll() {
    var stage = scroller();
    var top = stage ? stage.scrollTop : null;
    if (top !== null && top === ownTop) {
      scrolledTop = top;
      return;
    }
    scrolledAt = performance.now();
    scrolledTop = top;
  }

  /* Whether the page may be moving now: a scroll event within REST_MS, or a
     position that has changed since the last one, which is iOS's newer position
     arrived ahead of its event. Neither a quiet spell nor touches can say the
     opposite. The WebView's scroll events stop for 100 to 280 ms at a time while
     a fling goes on, whenever its main thread is laying a section out, and a
     finger that lands on a moving page reached the page's touch listeners in 1
     to 4 of 10 flicks: iOS takes that touch for itself, to stop the scroll. */
  function moving() {
    var stage = scroller();
    if (!stage) return false;
    return performance.now() - scrolledAt < REST_MS || (scrolledTop !== null && stage.scrollTop !== scrolledTop);
  }

  /* At rest is the position unchanged for REST_MS, over at least REST_FRAMES
     successive animation frames. A frame reads the position iOS last sent even
     straight after a long task, when a timer's reading could still be the one
     from before it. The loop runs only while something is parked. A frame that
     finds the page where the program put it counts as still (see above). */
  function watchForRest(now) {
    var stage = scroller();
    var top = stage ? stage.scrollTop : null;
    if (top !== resting.top && !(resting.top !== null && top !== null && top === ownTop)) {
      resting.top = top;
      resting.since = now;
      resting.frames = 0;
    } else {
      resting.top = top;
      resting.frames += 1;
    }
    if (moving() || now - resting.since < REST_MS || resting.frames < REST_FRAMES) {
      window.requestAnimationFrame(watchForRest);
      return;
    }
    watching = false;
    var manager = rendition.manager;
    /* Through the queue, as epub.js schedules its own trim, and through the
       wrappers below, which look again when the task runs: a fling that starts
       in between parks it again. */
    if (parked.trim) {
      parked.trim = false;
      manager.q.enqueue(manager.trim.bind(manager));
    }
    if (parked.check) {
      parked.check = false;
      manager.q.enqueue(manager.check.bind(manager));
    }
  }

  function watch() {
    if (watching) return;
    watching = true;
    resting.top = null;
    window.requestAnimationFrame(watchForRest);
  }

  function holdStill(manager) {
    if (!manager || !manager.q) return;
    var trim = manager.trim;
    manager.trim = function () {
      if (!moving()) return trim.apply(this, arguments);
      parked.trim = true;
      watch();
      return Promise.resolve();
    };
    var check = manager.check;
    manager.check = function (left, top) {
      /* check() prepends when the scroll it last heard, the manager's own
         \`scrollTop\`, is within its offset of the top of the laid-out text. For
         this one call it hears the offset instead, which prepends nothing:
         everything else check() does, appending below and showing and destroying
         views, goes ahead. */
      var offset = top || this.settings.offset || 0;
      if (this.scrollTop - offset >= 0 || !moving()) return check.apply(this, arguments);
      parked.check = true;
      watch();
      var real = this.scrollTop;
      this.scrollTop = offset;
      try {
        return check.apply(this, arguments);
      } finally {
        this.scrollTop = real;
      }
    };
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
  /* A drag in the margins between the section documents is heard here; see
     dragged. The container is built with the manager and lives as long as it. */
  var stage = scroller();
  if (stage) stage.addEventListener('touchmove', dragged, { passive: true });
  /* The page's own scroll, which is how the program knows it moves; and the
     manager whose trims and prepends wait for it to stop (#58). */
  if (stage) stage.addEventListener('scroll', noteScroll, { passive: true });
  holdStill(rendition.manager);
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

         **Nothing is moved here**, deliberately. The player collapsing changes
         where the line position is, and scrolling to the new one would move the
         text under the reader — which is the one thing ADR 0020's floating player
         exists to prevent. So the new inset applies from the next line the page
         follows, and the line being spoken stays where it is. */
      covered = typeof message.bottomPx === 'number' && isFinite(message.bottomPx) && message.bottomPx > 0 ? message.bottomPx : 0;
      openPlayer = typeof message.openPx === 'number' && isFinite(message.openPx) && message.openPx > 0 ? message.openPx : 0;
      return;
    }
    if (message.kind === 'following') {
      /* The owner's Line Position and way of scrolling (#71). Unlike the inset
         above, this is the owner asking for the line somewhere else, so a page
         that is following the reading goes there now — a glide within the
         visible page, a jump beyond it, as every move of the page is made. A
         page the owner has browsed away stays where they put it.

         Leaving Continuous forgets what it drifted towards, so By line starts
         from the line the words are on and not from one carried past its place. */
      var share = message.linePosition;
      if (typeof share !== 'number' || !isFinite(share) || share < 0 || share > 1) return;
      LINE_POSITION = share;
      if (message.scrolling === 'line' || message.scrolling === 'continuous') SCROLLING = message.scrolling;
      if (SCROLLING !== 'continuous') {
        halt();
        drifting = null;
      }
      if (state && state.follow && !browsing) approach(aim());
      return;
    }
    if (message.kind === 'appearance') {
      /* How the text is set, from the Appearance sheet (ADR 0019). It arrives as
         finished CSS rather than as a font and a size, so that what a rule may
         say is decided once, on the side that can be tested — \`appearanceCss\`
         builds it out of a fixed list and a clamped number, and in particular
         cannot declare \`user-select\`, which would silently stop the highlight
         painting.

         The page is restyled and then placed again, because a change that
         reflows the text moves the line being spoken away from the line
         position. That is
         the opposite of what the 'inset' message does above, and the difference
         is the whole of it: the player collapsing does not move a single
         character, and a font change moves every one of them. */
      APPEARANCE = typeof message.css === 'string' ? message.css : '';
      restyle();
      settle(SETTLE_FRAMES, 0);
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
      halt();
      state = null;
      followed = null;
      clearHighlights();
      return;
    }
    if (message.kind === 'hold') {
      stop();
      if (state) state.held = true;
      return;
    }
    if (message.kind === 'browse') {
      /* A Contents row while the reading is paused (#52). The display that moves
         the page comes right after this, so the sections it renders, the
         reading's own among them, arrive to a page that is not following. */
      setBrowsing(true);
      halt();
      return;
    }
    if (message.kind === 'return') {
      /* M (#71, #53): the page goes back to the reading and follows it again,
         and nothing starts. To the sentence being shown, and within it to the
         line the spoken word is on (aim()), so a reading that is playing keeps
         its words; by a glide, a jump or a display, as follow() decides. With no
         sentence shown there is nowhere to go, and the page only stops browsing:
         the bridge sends a revealed 'speak' instead whenever the reading has a
         sentence this program is not showing. */
      halt();
      setBrowsing(false);
      if (!state) return;
      state.follow = true;
      follow(build(state.utteranceRanges));
      return;
    }
    if (message.kind === 'followOnly') {
      /* The player collapsed, or opened again (#71). Collapsed, the page only
         follows: no finger can move it (lockPage) and none can start Browsing
         (dragged). A page the owner had taken away comes back first, as M
         would bring it — the collapsed player shows no M, so a page left
         browsing would be a page nothing on the screen could bring back.
         Opened, the page can be dragged again, and nothing moves. */
      var only = !!message.on;
      if (only === followOnly) return;
      followOnly = only;
      lockPage(only);
      if (only && browsing) dispatch({ kind: 'return' });
      return;
    }
    if (message.kind === 'speak') {
      stop();
      /* Revealed is the owner asking for the reading — Play, a tapped sentence,
         a skip, a place from another device: the page goes to it and follows it
         again. \`recover\` is the reading moving on while it plays: followed, as
         every sentence is, but a page the owner took away stays away, unless
         this sentence begins where they can see it (below). Neither is a repaint
         where the page is (a cue while paused, a new Voice repainting the
         sentence), which keeps whether the page was following it. */
      if (message.reveal) setBrowsing(false);
      var following = message.reveal || !!message.recover || !!(state && state.follow);
      state = {
        utterance: message.utterance,
        utteranceRanges: message.utteranceRanges,
        words: message.words,
        durationMs: message.durationMs,
        epoch: window.performance.now(),
        next: 0,
        held: false,
        reported: false,
        follow: following,
        /* The documents this Utterance has already been placed in; see placeOnce. */
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
      /* Zotero-TTS's rule, and no setting (ADR 0050): the owner who took the
         page away while listening gets it back by itself at a sentence they can
         see beginning. One they cannot see leaves it where they put it — and in
         particular displays nothing, which is what follow() would do for a
         sentence whose section is not on the page. */
      if (!message.reveal && message.recover && browsing && onVisiblePage(shown)) setBrowsing(false);
      if (message.reveal || (message.recover && !browsing)) follow(shown);
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
