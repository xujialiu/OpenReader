import { createRequire } from 'node:module';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { highlighterSource } from '../../src/renderer/highlighter';
import { pin } from '../structural';

/**
 * A Contents row's fragment lands on its element when its file is laid out by
 * the press itself (#307).
 *
 * On the simulator, the Gutenberg Pride and Prejudice's row to CHAPTER XXX., in
 * a file laid out for the first time, left the heading 23,430 px below the top
 * of the page, while a row to a file already on the page landed exactly. epub.js
 * asked for the right place: at its move, `locationOf` of the heading was
 * 97,383 px, the heading's top in its document. But the view's frame was still
 * 74,711 px tall against a document of 119,833, so the scroll stopped at the
 * container's end, 73,953. epub.js fitted the frame 16 ms later and left the
 * scroll there (notes/NOTES_2026-10-20.md).
 *
 * Real: the bundled epub.js's `ContinuousViewManager` with its `display`
 * (DefaultViewManager's, then `fill`), `moveTo` and `scrollBy`, and the page
 * program's `landBelowBar` and `locateInWholeView`. Doubled: the view (a frame that stays as tall
 * as it was laid out until `expand()` fits it to its document, which is what
 * epub.js's IframeView does) and the scroll container, which clamps its
 * `scrollTop` as a browser's does. The numbers are the ones measured.
 */

const require = createRequire(import.meta.url);

/** The bundled epub.js, loaded under Node; the managers it registers need no DOM to be reached. */
function bundledContinuousManager(): { prototype: object } {
  const source = (require('@epubjs-react-native/core/lib/commonjs/epubjs.js') as { default: string }).default;
  const module = { exports: {} as { Rendition?: { prototype: { requireManager(name: string): { prototype: object } } } } };
  const global: Record<string, unknown> = { module, exports: module.exports, require: () => function JSZip() {}, navigator: { userAgent: '' }, document: {}, setTimeout, clearTimeout };
  global.window = global;
  global.self = global;
  vm.runInContext(source, vm.createContext(global));
  return module.exports.Rendition!.prototype.requireManager.call({}, 'continuous');
}

/** A page program function, by name, as it is installed: to its closing brace at the program's own indent. */
function fn(name: string): string {
  const source = highlighterSource();
  const from = source.indexOf(`  function ${name}(`);
  if (from < 0) throw new Error(`No page function ${name}`);
  const end = source.indexOf('\n  }\n', from);
  return source.slice(from, end + '\n  }\n'.length);
}

const BAR = 54;
const CLIENT = 812;
const FRAGMENT = 'pgepubid00246';
const TARGET = `1306980130634175271_1342-h-2.htm.xhtml#${FRAGMENT}`;
/** CHAPTER XXX.'s file as measured: its heading's top in its document, the document, and the frame as first laid out. */
const HEADING_TOP = 97_383;
const DOCUMENT_HEIGHT = 119_833;
const FIRST_FRAME = 74_711;

interface Section { index: number; href: string; properties: string[] }

function page(options: { patched: boolean; onPage: boolean }) {
  const Manager = bundledContinuousManager();
  const section: Section = { index: 3, href: '1306980130634175271_1342-h-2.htm.xhtml', properties: [] };

  const views: View[] = [];
  let top = 0;
  const container = {
    clientHeight: CLIENT,
    scrollLeft: 0,
    get scrollHeight() { return BAR + views.reduce((sum, view) => sum + view.frame, 0); },
    get scrollTop() { return top; },
    set scrollTop(to: number) { top = Math.max(0, Math.min(to, this.scrollHeight - CLIENT)); },
  };

  class View {
    displayed = false;
    frame = FIRST_FRAME;
    constructor(public section: Section) {}
    display() { this.displayed = true; return Promise.resolve(this); }
    /** IframeView's: the element's place in its own document, which does not depend on the frame. */
    locationOf(target: string) { return target.endsWith(`#${FRAGMENT}`) ? { left: 0, top: HEADING_TOP } : { left: 0, top: 0 }; }
    /** IframeView's: the frame fitted to its document's height. */
    expand() { this.frame = DOCUMENT_HEIGHT; }
    /** The view's offsetTop in the container, under the bar's room; `landBelowBar` takes that room off. */
    offset() { return { top: BAR, left: 0 }; }
    width() { return 390; }
  }

  const manager = Object.assign(Object.create(Manager.prototype) as Record<string, unknown>, {
    View,
    container,
    settings: { direction: 'ltr', axis: 'vertical', flow: 'scrolled', fullsize: false },
    layout: { name: 'reflowable', divisor: 1 },
    isPaginated: false,
    views: {
      find: (wanted: Section) => views.find((view) => view.displayed && view.section === wanted),
      show() {},
      all: () => views,
    },
    clear() { views.length = 0; top = 0; },
    add(added: Section) {
      const view = new View(added);
      views.push(view);
      return view.display();
    },
    fill: () => Promise.resolve(),
  });

  if (options.onPage) {
    // The file has been on the page before: its frame already fits its document.
    const view = new View(section);
    view.displayed = true;
    view.expand();
    views.push(view);
  }
  // The program installs both; the first lands a section already on the page below the bar.
  const report = (line: string) => { throw new Error(line); };
  const install = ['landBelowBar', ...(options.patched ? ['locateInWholeView'] : [])];
  vm.runInNewContext(`${install.map(fn).join('\n')}\n${install.map((name) => `${name}(manager);`).join('\n')}`, { manager, report, barReserved: BAR });
  return {
    display: () => (Manager.prototype as { display(this: unknown, s: unknown, t: string): Promise<unknown> }).display.call(manager, section, TARGET),
    /** Where the heading is on the screen: its top in the document, less how far the page is scrolled into the view. */
    headingOnScreen: () => BAR + HEADING_TOP - top,
    get top() { return top; },
  };
}

describe('a Contents row lands on its fragment in a file the press lays out (#307)', () => {
  it('the mechanism, without the page program: the scroll stops at the end of a frame not yet fitted', async () => {
    const book = page({ patched: false, onPage: false });
    await book.display();
    expect(book.top).toBe(BAR + FIRST_FRAME - CLIENT);
    expect(book.top).toBe(73_953);
    expect(book.headingOnScreen()).toBe(BAR + 23_430);
  });

  it('with the page program, the heading lands just below the bar', async () => {
    const book = page({ patched: true, onPage: false });
    await book.display();
    expect(book.top).toBe(HEADING_TOP);
    expect(book.headingOnScreen()).toBe(BAR);
  });

  it('a file already on the page lands as it did', async () => {
    for (const patched of [false, true]) {
      const book = page({ patched, onPage: true });
      await book.display();
      expect(book.headingOnScreen()).toBe(BAR);
    }
  });
});

describe('fitting the view before locating moves nothing else', () => {
  it('is installed with the rest of the program', () => {
    pin(highlighterSource(), 'locateInWholeView(rendition.manager);', 'highlighter.ts, the install');
  });

  it('epub.js asks a view for locationOf() only in display(), once per path', () => {
    // The two calls in DefaultViewManager.display (a section already on the page,
    // and one it lays out), and the view's own call into its Contents. A further
    // caller would be something else this fitting reaches.
    const epubjs = (require('@epubjs-react-native/core/lib/commonjs/epubjs.js') as { default: string }).default;
    expect(epubjs.match(/\.locationOf\(/g)).toHaveLength(3);
    expect(epubjs.match(/this\.contents\.locationOf\(/g)).toHaveLength(1);
  });
});
