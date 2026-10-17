import { createRequire } from 'node:module';
import vm from 'node:vm';

import { DOMParser } from '@xmldom/xmldom';

import { highlighterSource } from '../../src/renderer/highlighter';
import { BLOCKS_MESSAGE, type ReportedBlock } from '../../src/renderer/messages';

/**
 * **The real page program, run over a stand-in page.**
 *
 * `highlighterSource()` is evaluated in node:vm as the WebView evaluates it.
 * Around it, doubles: epub.js's rendition and manager, the page's window and
 * timers, and each section document, parsed by xmldom, with its selection and
 * its hit-test. One thing is not a double: the `onclick` epub.js gives a link
 * in a section is epub.js's own function, cut out of the installed bundle and
 * run as it is (`linkHandler`).
 *
 * What it can show is the program's own logic: which messages it posts, what it
 * asks epub.js to display, which way a click or a touch is taken. It cannot show
 * layout, a scroll the platform drops or anything WebKit draws; those are the
 * simulator's (test/README.md, "The WebView").
 */

const require = createRequire(import.meta.url);

/**
 * epub.js's own link handler, the function its Contents' `linksHandler` calls
 * for every section document (`epubjs.js`, `function h(t, e)`): every `a[href]`
 * whose value neither starts with `mailto:` nor holds `://` gets an `onclick`
 * that hands the link on and returns false. Its two free names are stand-ins:
 * `n.qs` finds no `<base>`, and `r.a` is a Url that keeps the path and the hash.
 */
function linkHandler(): (root: any, follow: (href: string) => void) => void {
  const bundle: string = require('@epubjs-react-native/core/lib/commonjs/epubjs.js').default;
  const from = bundle.indexOf('function h(t, e) {\n        var i = t.querySelectorAll("a[href]");');
  const to = bundle.indexOf('function l(t, e, i) {', from);
  if (from < 0 || to < from) throw new Error('the link handler was not found in the bundle');
  class Url {
    Path: { path: string };
    hash: string;
    constructor(href: string) {
      const [path, hash] = href.split('#');
      this.Path = { path: '/OEBPS/' + path };
      this.hash = hash ? '#' + hash : '';
    }
  }
  return new Function('n', 'r', bundle.slice(from, to) + '; return h;')({ qs: () => null }, { a: Url });
}

/** A browser's default `display` for the elements the tests use (HTML Standard, Rendering); anything else is inline. */
const DISPLAY: Record<string, string> = {
  html: 'block', body: 'block', p: 'block', div: 'block', h1: 'block', h2: 'block', h3: 'block', section: 'block', blockquote: 'block',
  ul: 'block', ol: 'block', dl: 'block', dt: 'block', dd: 'block', li: 'list-item',
  table: 'table', tbody: 'table-row-group', tr: 'table-row', td: 'table-cell', th: 'table-cell',
};

/** A property the element's own `style` attribute sets, lower-cased, or null. */
function declared(element: any, property: string): string | null {
  for (const part of String(element.getAttribute?.('style') ?? '').split(';')) {
    const [name, value] = part.split(':');
    if (name && value && name.trim().toLowerCase() === property) return value.trim().toLowerCase();
  }
  return null;
}

/**
 * The computed style the program reads, from the tag and the element's `style`
 * attribute. A floated or absolutely positioned box computes a block `display`
 * whatever it was declared (CSS 2.1 section 9.7), as WebKit was measured to
 * answer for a floated span (#189).
 */
function computedStyle(element: any) {
  let display = declared(element, 'display') ?? DISPLAY[String(element.tagName).toLowerCase()] ?? 'inline';
  const cssFloat = declared(element, 'float') ?? 'none';
  const position = declared(element, 'position') ?? 'static';
  if (display.startsWith('inline') && (cssFloat !== 'none' || position === 'absolute' || position === 'fixed')) display = 'block';
  return { display, cssFloat, position, textAlign: 'start', fontSize: '16px', getPropertyValue: () => '' };
}

interface Listener {
  fn: (event: any) => void;
  capture: boolean;
}

export interface Section {
  index: number;
  document: any;
  /** What the section's selection holds. */
  selected: string;
  listeners: Map<string, Listener[]>;
}

/**
 * @param options.toc The navigation epub.js would hold as `book.navigation.toc`,
 * which the program reads for the Contents' fragments (#212). Absent: no
 * navigation, as before it had loaded.
 */
export function standInPage(options: { toc?: readonly unknown[] } = {}) {
  const posted: any[] = [];
  /** What the program asked epub.js to display, in order. */
  const displays: unknown[] = [];
  /** The links epub.js followed, as its handler hands them on. */
  const followed: string[] = [];
  const timers: (() => void)[] = [];
  const hooks: (() => void)[] = [];
  const contents: any[] = [];
  const queue = () => ({ enqueue: (fn: () => unknown) => Promise.resolve().then(fn), tick() {} });
  function View() {}
  View.prototype.display = () => Promise.resolve();
  View.prototype.offset = () => ({ top: 0, left: 0 });
  const stage = { scrollTop: 9000, clientHeight: 800, addEventListener() {}, getBoundingClientRect: () => ({ top: 0, bottom: 800, left: 0, right: 400 }) };
  const manager: any = {
    container: stage, stage: { settings: { overflow: 'scroll' }, overflow() {} }, views: { last: () => null, destroy() {}, all: () => [] },
    q: queue(), View, settings: { offset: 500, axis: 'vertical' }, scrollTop: 0, trim: () => Promise.resolve(), check: () => Promise.resolve(),
    scrollTo(_x: number, y: number) { stage.scrollTop = y; },
    scrollBy(_x: number, y: number) { stage.scrollTop += y; },
    /* The continuous manager's two corrections that keep the text still, as
       the bundle has them (`epubjs.js`, `erase(t, e)` and `counter(t)`):
       erasing a view above the page scrolls back by its height, and a view
       prepended above scrolls on by what it grew. */
    erase(view: { bounds(): { height: number } }, above?: unknown[]) {
      const top = stage.scrollTop;
      const height = view.bounds().height;
      if (above) this.scrollTo(0, top - height, true);
    },
    counter(bounds: { heightDelta: number }) {
      this.scrollBy(0, bounds.heightDelta, true);
    },
  };
  const rendition = {
    manager, q: queue(), location: { start: { cfi: 'x' } }, on() {},
    display(target: unknown) { displays.push(target); return Promise.resolve(); },
    hooks: { content: { register(fn: () => void) { hooks.push(fn); } } },
    // epub.js lists the sections it has on the page: a destroyed view is not among them.
    getContents: () => contents.filter((one) => one.document.defaultView),
  };
  const book = {
    spine: { length: 10, get: (index: number) => ({ href: 'ch' + index + '.xhtml', index, next: () => null }) }, package: { metadata: { language: 'en' } },
    navigation: options.toc ? { toc: options.toc } : undefined,
  };
  const setTimeout = (fn: () => void) => timers.push(fn);
  const clearTimeout = (id: number) => { if (id && timers[id - 1]) timers[id - 1] = () => {}; };
  const window: any = {
    ReactNativeWebView: { postMessage: (data: string) => posted.push(JSON.parse(data)) },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, performance: { now: () => 0 },
  };
  const top = { getElementById: () => null, createElement: () => ({ style: {}, textContent: '' }), head: { appendChild() {} } };
  vm.runInContext(highlighterSource(), vm.createContext({ window, document: top, rendition, book, performance: window.performance, setTimeout, clearTimeout, console, Promise }));
  const follow = linkHandler();

  /** A section epub.js has rendered: its links given epub.js's `onclick` first, then the content hook, as in epub.js's Contents. */
  function addSection(index: number, body: string): Section {
    const document: any = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>' + body + '</body></html>', 'application/xhtml+xml');
    const section: Section = { index, document, selected: '', listeners: new Map() };
    document.body = document.getElementsByTagName('body')[0];
    document.head = document.getElementsByTagName('head')[0];
    document.defaultView = {
      document, frameElement: { getBoundingClientRect: () => ({ top: 0 }) }, Highlight: class extends Set<unknown> { priority = 0; }, CSS: { highlights: new Map() },
      getComputedStyle: computedStyle,
    };
    document.addEventListener = (type: string, fn: (event: any) => void, options?: boolean | { capture?: boolean }) => {
      const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true);
      section.listeners.set(type, [...(section.listeners.get(type) ?? []), { fn, capture }]);
    };
    // WebKit: a document whose iframe is gone has no browsing context, and its getSelection() answers null.
    document.getSelection = () => (document.defaultView ? {
      get isCollapsed() { return !section.selected; }, toString: () => section.selected, removeAllRanges() { section.selected = ''; },
    } : null);
    document.createRange = () => {
      const range: any = { startContainer: null, endContainer: null, getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0, width: 0 }) };
      range.setStart = (node: any, offset: number) => { range.startContainer = node; range.startOffset = offset; };
      range.setEnd = (node: any, offset: number) => { range.endContainer = node; range.endOffset = offset; };
      range.selectNode = (node: any) => { range.startContainer = node; range.endContainer = node; };
      return range;
    };
    // Every Block's box is the whole page, so a tap on its text is inside it.
    for (const element of Array.from(document.getElementsByTagName('*')) as any[]) {
      element.getBoundingClientRect = () => ({ left: 0, right: 400, top: 0, bottom: 800 });
    }
    document.body.querySelectorAll = () => Array.from(document.body.getElementsByTagName('a')).filter((a: any) => a.hasAttribute('href'));
    follow(document.body, (href) => followed.push(href));
    contents.push({ document, window: document.defaultView, sectionIndex: index, cfiFromNode: () => 'epubcfi(/6/' + index + '!/4)' });
    return section;
  }

  function listeners(section: Section, type: string, capture: boolean) {
    return (section.listeners.get(type) ?? []).filter((one) => one.capture === capture).map((one) => one.fn);
  }

  return {
    posted, displays, followed, manager, stage, addSection,
    send(message: object) { window.__openReaderHighlighter(message); },
    /** A Download's preparation of one section, as the hidden rendition is asked for it (`indexer.tsx`); settles once the program has posted its answer. */
    async prepare(index: number, points: unknown[] = [], token = 1): Promise<any> {
      await window.openreaderOfflineSection(index, points, token);
      return posted.filter((m) => m.type === 'openreader:offline-section' || m.type === 'openreader:offline-error').pop();
    },
    /** The content hook, as epub.js runs it for every section it displays. */
    sweep() { for (const hook of hooks) hook(); },
    /** The Blocks the program reported for a section. */
    blocks(section: Section): ReportedBlock[] {
      return posted.filter((m) => m.type === BLOCKS_MESSAGE && m.sectionIndex === section.index).pop().blocks;
    },
    /**
     * One click on `target`, dispatched as the platform does: the document's
     * capture listeners, then each element's `onclick` from the target up
     * (returning false cancels the default), then the document's own
     * listeners, unless one of them stopped it. The hit-test answers a caret in
     * the target's first text.
     */
    click(section: Section, target: any) {
      let stopped = false;
      const event: any = { type: 'click', target, clientX: 20, clientY: 10, defaultPrevented: false, currentTarget: section.document };
      event.stopPropagation = () => { stopped = true; };
      event.preventDefault = () => { event.defaultPrevented = true; };
      let text = target.firstChild;
      while (text && text.nodeType !== 3) text = text.firstChild;
      section.document.caretPositionFromPoint = () => ({ offsetNode: text, offset: 1 });
      for (const fn of listeners(section, 'click', true)) if (!stopped) fn(event);
      for (let at = target; at && at.nodeType === 1 && !stopped; at = at.parentNode) {
        if (typeof at.onclick === 'function' && at.onclick(event) === false) event.defaultPrevented = true;
      }
      for (const fn of listeners(section, 'click', false)) if (!stopped) fn(event);
      return event;
    },
    /** A touch event on a section document, each finger as `[identifier, clientY]`. */
    touch(section: Section, type: string, ...fingers: [number, number][]) {
      const event = { type, touches: fingers.map(([identifier, clientY]) => ({ identifier, clientY })), currentTarget: section.document };
      for (const fn of [...listeners(section, type, true), ...listeners(section, type, false)]) fn(event);
    },
    /** A long press has selected `text` in `section`, and the finger is up. */
    select(section: Section, text: string) {
      section.selected = text;
      for (const fn of listeners(section, 'selectionchange', false)) fn({ currentTarget: section.document });
      for (const timer of timers.splice(0)) timer();
    },
    /** epub.js's view.destroy(): the iframe is taken out, and the document has no window. */
    destroy(section: Section) { section.document.defaultView = null; },
  };
}

export type StandInPage = ReturnType<typeof standInPage>;
