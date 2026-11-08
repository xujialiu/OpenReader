import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { createDrawerTurns } from '../../src/app/drawer-turns';
import { PROBLEM_MESSAGE, SELECTION_MESSAGE } from '../../src/renderer/messages';
import { type Section, standInPage } from './stand-in-page';

/** The complete page program and installed epub.js CFI codec, manager.resize,
 * getContents and Rendition.onResized. DOM Range, Selection, layout, focus and
 * iframe replacement are doubles; this cannot establish WebKit painting,
 * keyboard/first-responder ownership or native handle interaction. */
const require = createRequire(import.meta.url);
const module = { exports: {} as {
  Contents: { prototype: { cfiFromRange(range: any): string; range(cfi: string): any } };
  Rendition: { prototype: { requireManager(name: string): { prototype: any }; onResized: (...args: any[]) => void } };
} };
const global: Record<string, unknown> = {
  module, exports: module.exports, require: () => function JSZip() {},
  navigator: { userAgent: '' }, document: {}, setTimeout, clearTimeout,
};
global.window = global;
global.self = global;
vm.runInNewContext(require('@epubjs-react-native/core/lib/commonjs/epubjs.js').default, global);
const codec = module.exports.Contents.prototype;
const renditionPrototype = module.exports.Rendition.prototype;
const managerPrototype = renditionPrototype.requireManager.call({}, 'continuous').prototype;

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
      getClientRects: () => [doc.selectionRect], getBoundingClientRect: () => doc.selectionRect,
      toString() { return doc.documentElement.textContent.slice(offset(this.startContainer, this.startOffset), offset(this.endContainer, this.endOffset)); },
    };
    return range;
  };
  return offset;
}

const body = '<p>hope then hope <b>again</b> today.</p>';
function fixture(deferred = false) {
  const nativeEvents: (() => void)[] = [];
  const trace: string[] = [];
  const page = standInPage({ resize(width, height, target) {
    managerPrototype.resize.call(page.manager, width, height, target);
  } });
  const liveContents = page.rendition.getContents;
  Object.assign(page.manager, {
    _stageSize: { width: 400, height: 800 }, viewSettings: {},
    bounds: () => ({}), updateLayout() {},
    clear() {
      trace.push('clear');
      for (const content of liveContents()) {
        const frame = content.document.defaultView.frameElement;
        if (page.document.activeElement === frame) page.document.activeElement = page.document.body;
        frame.isConnected = false;
        content.document.defaultView = null;
      }
    },
    emit(event: string, size: object, target?: string) {
      if (event === 'resized') renditionPrototype.onResized.call(page.rendition, size, target);
    },
  });
  page.manager.stage.size = (width: number, height: number) => ({ width, height });
  page.manager.views.forEach = (fn: (view: object) => void) => liveContents().forEach((contents) => fn({ contents }));
  page.rendition.getContents = () => managerPrototype.getContents.call(page.manager);
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
    doc.activeElement = doc.body;
    doc.visibilityState = 'visible';
    doc.selectionRect = { top: 100, bottom: 118, left: 20, right: 60, width: 40, height: 18 };
    const frame = Object.assign(doc.defaultView.frameElement, {
      tagName: 'IFRAME', ownerDocument: page.document, contentDocument: doc, isConnected: true,
      getBoundingClientRect: () => ({ top: 0, bottom: 800, left: 0, right: 400, width: 400, height: 800 }),
      getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; },
      focus: vi.fn((options: FocusOptions) => {
        trace.push('focus');
        page.document.activeElement = frame;
        // A missing preventScroll would have moved the fake Browsing page.
        if (!options?.preventScroll) page.stage.scrollTop = 0;
        page.document.dispatchEvent({ type: 'focusin', target: frame });
      }),
    });
    doc.hasFocus = () => !!doc.defaultView && page.document.activeElement === frame;
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
        trace.push('range');
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
    return { section, doc, frame, selection, text: doc.getElementsByTagName('p')[0].firstChild };
  }
  function flush() {
    for (const event of nativeEvents.splice(0)) event();
    page.flushTimers();
  }
  const first = add();
  page.send({ kind: 'lookup', enabled: true });
  function choose(one = first, start = 10, end = 14, backward = false, settle = true) {
    page.document.activeElement = one.frame;
    one.selection.setBaseAndExtent(one.text, backward ? end : start, one.text, backward ? start : end);
    for (const event of nativeEvents.splice(0)) event();
    if (settle) page.flushTimers();
  }
  function complete(index = 6, beforeFrame: (next: ReturnType<typeof add>) => void = () => {}) {
    const next = add(index);
    page.rendition.emit('displayed');
    beforeFrame(next);
    for (let i = 0; i < 5; i++) page.frame();
    flush();
    return next;
  }
  return {
    page, first, choose, complete, flush, add, trace,
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

describe('lookup resize restores only originally owned iframe focus (#350, #355)', () => {
  it('restores focus after the exact range, with preventScroll and no extra lookup/Following message or redisplay', () => {
    const f = fixture();
    f.choose();
    const before = f.page.posted.filter((m) => m.type !== 'openreader:blocks');
    const top = f.page.stage.scrollTop;
    f.trace.length = 0;
    f.resize();
    const next = f.complete();
    expect(f.trace).toEqual(['clear', 'range', 'focus']);
    expect(next.frame.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(next.doc.hasFocus()).toBe(true);
    expect(next.selection.toString()).toBe('hope');
    expect(codec.cfiFromRange.call(f.page.rendition.getContents()[0], next.selection.getRangeAt(0)))
      .toBe('epubcfi(/6/14!/4/2,/1:10,/1:14)');
    expect(f.page.stage.scrollTop).toBe(top);
    expect(f.page.displays).toEqual(['viewport-anchor']);
    expect(f.page.posted.filter((m) => m.type !== 'openreader:blocks')).toEqual(before);
  });

  it('transfers only that ownership through a subsequent resize and keeps a backward range', () => {
    const f = fixture();
    f.choose(f.first, 10, 14, true);
    f.resize();
    const next = f.complete();
    expect(next.frame.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    f.resize(400, 800);
    const current = f.complete();
    expect(current.frame.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(current.selection.anchorOffset).toBe(14);
    expect(current.selection.focusOffset).toBe(10);
    expect(f.messages()).toHaveLength(2);
  });

  it('captures selection-owned focus before the OS resize blur, not only inside manager.resize', () => {
    const f = fixture();
    f.choose();
    f.page.document.activeElement = f.page.document.body; // OS resize blur; no new input/focus owner
    expect(f.first.doc.hasFocus()).toBe(false);
    f.resize();
    expect(f.complete().frame.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('retains the original ownership across two resizes before replacement, but runs only the current callback', () => {
    const f = fixture();
    f.choose();
    f.resize();
    const stale = f.add();
    f.page.rendition.emit('displayed');
    f.resize(750, 600);
    const current = f.complete();
    expect(stale.frame.focus).not.toHaveBeenCalled();
    expect(current.frame.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(f.messages()).toHaveLength(2);
  });

  it('does not acquire focus from a selection that never owned the iframe focus', () => {
    const f = fixture();
    f.page.document.activeElement = f.page.document.body;
    f.first.selection.setBaseAndExtent(f.first.text, 10, f.first.text, 14);
    f.flush();
    f.resize();
    expect(f.complete().frame.focus).not.toHaveBeenCalled();
  });

  it.each(['close', 'disable', 'hide', 'pagehide'])('%s cancels a queued focus repair permanently', (kind) => {
    const f = fixture();
    f.choose();
    f.resize();
    const next = f.complete(6, () => {
      if (kind === 'close') f.page.send({ kind: 'lookup', close: true });
      if (kind === 'disable') f.page.send({ kind: 'lookup', enabled: false });
      if (kind === 'hide') {
        f.page.document.visibilityState = 'hidden';
        f.page.document.dispatchEvent({ type: 'visibilitychange' });
        f.page.document.visibilityState = 'visible';
      }
      if (kind === 'pagehide') f.page.window.dispatchEvent({ type: 'pagehide' });
    });
    expect(next.frame.focus).not.toHaveBeenCalled();
    f.resize(400, 800);
    expect(f.complete().frame.focus).not.toHaveBeenCalled();
    expect(f.problems()).toEqual([]);
  });

  it.each(['input', 'other-frame', 'button'])('does not take focus back after an intervening %s, even if it blurs again', (kind) => {
    const f = fixture();
    f.choose();
    const target = { tagName: kind === 'input' ? 'INPUT' : kind === 'other-frame' ? 'IFRAME' : 'BUTTON' };
    f.page.document.activeElement = target;
    f.page.document.dispatchEvent({ type: 'focusin', target });
    f.page.document.activeElement = f.page.document.body;
    f.resize();
    expect(f.complete().frame.focus).not.toHaveBeenCalled();
    expect(f.messages()).toHaveLength(2);
  });

  it.each(['pointerdown', 'touchstart', 'wheel', 'keydown', 'beforeinput'])('an intervening %s cancels a pending focus repair', (type) => {
    const f = fixture();
    f.choose();
    f.resize();
    const next = f.complete(6, () => f.page.document.dispatchEvent({ type, target: f.page.document.body }));
    expect(next.frame.focus).not.toHaveBeenCalled();
    expect(next.selection.rangeCount).toBe(0);
  });

  it.each(['INPUT', 'TEXTAREA', 'SELECT', 'contenteditable'])('never captures focus from the original %s editor', (tag) => {
    const f = fixture();
    f.first.doc.activeElement = { tagName: tag, isContentEditable: tag === 'contenteditable' };
    f.choose();
    f.first.doc.activeElement = f.first.doc.body;
    f.resize();
    expect(f.complete().frame.focus).not.toHaveBeenCalled();
  });

  it.each(['focusin', 'pointerdown', 'touchstart', 'wheel', 'keydown', 'beforeinput'])('the section document also cancels focus on %s', (type) => {
    const f = fixture();
    f.choose();
    const target = { tagName: 'INPUT', ownerDocument: f.first.doc };
    for (const listener of f.first.section.listeners.get(type) ?? []) {
      listener.fn({ type, target, currentTarget: f.first.doc });
    }
    f.first.doc.activeElement = f.first.doc.body;
    f.resize();
    expect(f.complete().frame.focus).not.toHaveBeenCalled();
  });

  it('does not steal an editable field in the replacement document', () => {
    const f = fixture();
    f.choose();
    f.resize();
    const next = f.complete(6, (one) => {
      one.doc.activeElement = { tagName: 'DIV', isContentEditable: true };
      f.page.document.activeElement = one.frame;
    });
    expect(next.frame.focus).not.toHaveBeenCalled();
    expect(f.page.document.activeElement).toBe(next.frame);
    expect(next.doc.activeElement.isContentEditable).toBe(true);
    expect(next.selection.rangeCount).toBe(0);
  });

  it('does not focus when another DOM control remains active after redisplay', () => {
    const f = fixture();
    f.choose();
    f.resize();
    const target = { tagName: 'INPUT' };
    const next = f.complete(6, () => { f.page.document.activeElement = target; });
    expect(next.frame.focus).not.toHaveBeenCalled();
    expect(f.page.document.activeElement).toBe(target);
    expect(next.selection.rangeCount).toBe(0);
  });

  it.each(['detached', 'hidden', 'offscreen', 'offscreen-range', 'different-document'])('does not focus a %s target or display another section', (kind) => {
    const f = fixture();
    f.choose();
    f.resize();
    const next = f.complete(6, (one) => {
      if (kind === 'detached') one.frame.isConnected = false;
      if (kind === 'hidden') one.frame.getAttribute = (name: string) => name === 'style' ? 'visibility: hidden' : null;
      if (kind === 'offscreen') one.frame.getBoundingClientRect = () => ({ top: 900, bottom: 1700, left: 0, right: 400, width: 400, height: 800 });
      if (kind === 'offscreen-range') one.doc.selectionRect = { top: 1000, bottom: 1018, left: 20, right: 60, width: 40, height: 18 };
      if (kind === 'different-document') one.frame.contentDocument = {};
    });
    expect(next.frame.focus).not.toHaveBeenCalled();
    expect(f.page.displays).toEqual(['viewport-anchor']);
    expect(f.problems()).toEqual([]);
  });

  it.each(['actions/rename', 'actions/debug-note', 'actions/move/create-folder'])('the existing drawer queue closes lookup before %s can own native input', (task) => {
    const f = fixture();
    const turns = createDrawerTurns();
    turns.ask('lookup', () => {
      // LookupDrawer.onClose -> useLookup.close -> ReaderBridge.closeLookup.
      f.page.send({ kind: 'lookup', close: true });
      turns.leave('lookup');
    });
    f.choose();
    f.resize();
    const next = f.complete(6, () => {
      turns.ask(task, () => turns.leave(task));
      expect(turns.isUp(task)).toBe(false);
      turns.gone('lookup');
      expect(turns.isUp(task)).toBe(true);
    });
    expect(next.frame.focus).not.toHaveBeenCalled();
    expect(next.selection.rangeCount).toBe(0);
    expect(f.problems()).toEqual([]);
  });

  it('does not focus another section when the selected one has been trimmed', () => {
    const f = fixture();
    f.choose();
    f.resize();
    expect(f.complete(8).frame.focus).not.toHaveBeenCalled();
    expect(f.page.displays).toEqual(['viewport-anchor']);
  });

  it('preserves a new selection and its backward direction instead of applying an old callback', () => {
    const f = fixture();
    f.choose();
    f.resize();
    const next = f.complete(6, (one) => f.choose(one, 0, 4, true));
    expect(next.frame.focus).not.toHaveBeenCalled();
    expect(next.selection.anchorOffset).toBe(4);
    expect(next.selection.focusOffset).toBe(0);
    expect(f.messages().map((m) => m.selecting)).toEqual([true, false, true, false]);
    f.resize(400, 800);
    const current = f.complete();
    expect(current.frame.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(current.selection.anchorOffset).toBe(4);
    expect(current.selection.focusOffset).toBe(0);
    expect(f.messages()).toHaveLength(4);
  });
});
