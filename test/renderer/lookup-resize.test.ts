import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

import { PROBLEM_MESSAGE, SELECTION_MESSAGE } from '../../src/renderer/messages';
import { type Section, standInPage } from './stand-in-page';

/** The complete page program and the installed epub.js CFI codec. DOM Range,
 * Selection, layout and resize's iframe replacement are doubles; this cannot
 * establish WebKit painting or native handle interaction. */
const require = createRequire(import.meta.url);
const module = { exports: {} as { Contents: { prototype: { cfiFromRange(range: any): string; range(cfi: string): any } } } };
const global: Record<string, unknown> = {
  module, exports: module.exports, require: () => function JSZip() {},
  navigator: { userAgent: '' }, document: {}, setTimeout, clearTimeout,
};
global.window = global;
global.self = global;
vm.runInNewContext(require('@epubjs-react-native/core/lib/commonjs/epubjs.js').default, global);
const codec = module.exports.Contents.prototype;

function rangeDocument(doc: any) {
  function offset(node: any, at: number) {
    let total = 0;
    let found = false;
    function walk(one: any) {
      if (found) return;
      if (one === node) {
        total += one.nodeType === 3 ? at : Array.from(one.childNodes).slice(0, at).reduce((n: number, child: any) => n + child.textContent.length, 0);
        found = true;
      } else if (one.nodeType === 3) total += one.textContent.length;
      else for (const child of Array.from(one.childNodes) as any[]) walk(child);
    }
    walk(doc.documentElement);
    return total;
  }
  for (const element of Array.from(doc.getElementsByTagName('*')) as any[]) {
    Object.defineProperty(element, 'children', { get: () => Array.from(element.childNodes).filter((child: any) => child.nodeType === 1) });
  }
  doc.createRange = () => {
    const range: any = {
      startContainer: doc, startOffset: 0, endContainer: doc, endOffset: 0,
      get collapsed() { return this.startContainer === this.endContainer && this.startOffset === this.endOffset; },
      get commonAncestorContainer() {
        const parents = new Set();
        for (let node = this.endContainer; node; node = node.parentNode) parents.add(node);
        for (let node = this.startContainer; node; node = node.parentNode) if (parents.has(node)) return node;
        return null;
      },
      setStart(node: any, at: number) { this.startContainer = node; this.startOffset = at; },
      setEnd(node: any, at: number) { this.endContainer = node; this.endOffset = at; },
      selectNode(node: any) { this.setStart(node, 0); this.setEnd(node, node.childNodes.length); },
      getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 0, width: 0, height: 0 }),
      toString() { return doc.documentElement.textContent.slice(offset(this.startContainer, this.startOffset), offset(this.endContainer, this.endOffset)); },
    };
    return range;
  };
  return offset;
}

const body = '<p>hope then hope <b>again</b> today.</p>';
function fixture(deferred = false) {
  const nativeEvents: (() => void)[] = [];
  let size = [400, 800];
  const page = standInPage({ resize(width, height, target) {
    if (size[0] === width && size[1] === height) return;
    size = [width, height];
    for (const content of page.rendition.getContents()) content.document.defaultView = null;
    page.rendition.emit('resized');
    void page.rendition.display(target);
  } });
  page.manager.scrolledLocation = () => page.rendition.getContents().map((c) => ({ index: c.sectionIndex, mapping: { start: 'viewport-anchor' } }));
  Object.assign(page.rendition, { located: (list: any[]) => list.length ? { start: { index: list[0].index, cfi: list[0].mapping.start } } : null });
  function notify(section: Section) {
    const fire = () => { for (const listener of section.listeners.get('selectionchange') ?? []) listener.fn({ currentTarget: section.document }); };
    if (deferred) nativeEvents.push(fire); else fire();
  }
  function add(index = 6) {
    const section = page.addSection(index, body);
    const doc = section.document;
    const offset = rangeDocument(doc);
    let range: any = null;
    let backward = false;
    const selection = {
      get isCollapsed() { return !range || range.collapsed; },
      get rangeCount() { return range ? 1 : 0; },
      get anchorNode() { return backward ? range?.endContainer : range?.startContainer; },
      get anchorOffset() { return backward ? range?.endOffset : range?.startOffset; },
      get focusNode() { return backward ? range?.startContainer : range?.endContainer; },
      get focusOffset() { return backward ? range?.startOffset : range?.endOffset; },
      getRangeAt(index = 0) {
        if (index !== 0 || !range) throw new RangeError('Selection has no such range');
        return range;
      },
      toString: () => section.selected,
      removeAllRanges() { range = null; section.selected = ''; notify(section); },
      addRange(next: any) { range = next; backward = false; section.selected = range.toString(); notify(section); },
      setBaseAndExtent(anchor: any, a: number, focus: any, f: number) {
        range = doc.createRange();
        backward = offset(anchor, a) > offset(focus, f);
        range.setStart(backward ? focus : anchor, backward ? f : a);
        range.setEnd(backward ? anchor : focus, backward ? a : f);
        section.selected = range.toString();
        notify(section);
      },
    };
    doc.getSelection = () => doc.defaultView ? selection : null;
    Object.assign(page.rendition.getContents().find((c) => c.document === doc), {
      cfiBase: '/6/' + (index + 1) * 2, cfiFromRange: codec.cfiFromRange, range: codec.range,
      locationOf: () => ({ top: 0, left: 0 }),
    });
    page.sweep();
    return { section, doc, selection, text: doc.getElementsByTagName('p')[0].firstChild };
  }
  function flush() {
    for (const event of nativeEvents.splice(0)) event();
    page.flushTimers();
  }
  const first = add();
  page.send({ kind: 'lookup', enabled: true });
  function choose(one = first, start = 10, end = 14, backward = false, settle = true) {
    one.selection.setBaseAndExtent(one.text, backward ? end : start, one.text, backward ? start : end);
    for (const event of nativeEvents.splice(0)) event();
    if (settle) page.flushTimers();
  }
  function complete(index = 6) {
    const next = add(index);
    page.rendition.emit('displayed');
    for (let i = 0; i < 5; i++) page.frame();
    flush();
    return next;
  }
  return {
    page, first, choose, complete, flush,
    resize: (width = 700, height = 500) => page.manager.resize(width, height),
    messages: () => page.posted.filter((m) => m.type === SELECTION_MESSAGE),
    problems: () => page.posted.filter((m) => m.type === PROBLEM_MESSAGE),
  };
}

describe('lookup selection survives the iframe replacement on resize (#346)', () => {
  it.each([false, true])('restores the exact repeated word without another selection message (deferred=%s)', (deferred) => {
    const f = fixture(deferred);
    f.choose();
    const before = f.messages();
    expect(before.map((m) => m.selecting)).toEqual([true, false]);
    f.resize();
    expect(f.first.doc.getSelection()).toBeNull();
    const next = f.complete();
    expect(next.selection.toString()).toBe('hope');
    expect(next.selection.getRangeAt(0).startOffset).toBe(10);
    expect(f.messages()).toEqual(before);
    expect(f.problems()).toEqual([]);
    f.page.send({ kind: 'lookup', close: true });
    expect(next.selection.rangeCount).toBe(0);
  });

  it('keeps the range direction and spans inline markup', () => {
    const f = fixture();
    const bold = f.first.doc.getElementsByTagName('b')[0].firstChild;
    f.first.selection.setBaseAndExtent(bold, 5, f.first.text, 10);
    f.flush();
    const before = f.messages();
    f.resize();
    const next = f.complete();
    expect(next.selection.toString()).toBe('hope again');
    expect(next.selection.anchorNode.parentNode.tagName).toBe('b');
    expect(next.selection.focusOffset).toBe(10);
    expect(f.messages()).toEqual(before);
    expect(f.problems()).toEqual([]);
  });

  it('also keeps the last reported range if WebKit clears selection before manager.resize', () => {
    const f = fixture();
    f.choose();
    f.first.selection.removeAllRanges();
    f.resize();
    expect(f.complete().selection.toString()).toBe('hope');
    expect(f.messages()).toHaveLength(2);
  });

  it('finishes the original release debounce while its old document is gone, only once', () => {
    const f = fixture(true);
    f.choose(f.first, 10, 14, false, false);
    expect(f.messages().map((m) => m.selecting)).toEqual([true]);
    f.resize();
    f.flush();
    expect(f.messages().map((m) => m.selecting)).toEqual([true, false]);
    expect(f.complete().selection.toString()).toBe('hope');
    expect(f.messages().map((m) => m.selecting)).toEqual([true, false]);
  });

  it('survives a second resize before any document has returned', () => {
    const f = fixture();
    f.choose();
    f.resize();
    f.resize(750, 600);
    expect(f.complete().selection.toString()).toBe('hope');
    expect(f.messages()).toHaveLength(2);
  });

  it('does not suppress a real new selection of the same word at a different offset', () => {
    const f = fixture();
    f.choose();
    f.resize();
    const next = f.complete();
    f.choose(next, 0, 4);
    expect(f.messages().map((m) => m.selecting)).toEqual([true, false, true, false]);
    f.resize(400, 800);
    expect(f.complete().selection.getRangeAt(0).startOffset).toBe(0);
  });

  it('a close during redisplay prevents resurrection', () => {
    const f = fixture();
    f.choose();
    f.resize();
    f.page.send({ kind: 'lookup', close: true });
    expect(f.complete().selection.rangeCount).toBe(0);
    expect(f.problems()).toEqual([]);
    expect(f.messages()).toHaveLength(2);
  });

  it('does not display an absent selection section instead of the Browsing passage', () => {
    const f = fixture();
    f.choose();
    f.resize();
    expect(f.complete(8).selection.rangeCount).toBe(0);
    expect(f.page.displays).toEqual(['viewport-anchor']);
    expect(f.messages()).toHaveLength(2);
    expect(f.problems()).toEqual([]);
  });
});
