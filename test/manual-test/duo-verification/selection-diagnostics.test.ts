import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./selection-diagnostics.js', import.meta.url), 'utf8');
// HOST ONLY: actual probe, frozen DOM/Selection/style doubles; no WebKit or native paint.
function fixture({ backward = false, hidden = false, pseudo = true, word = 'Even', copies = 1, longStyle = false,
  heading = 'Boundary Examples', available = true } = {}) {
  const forbidden = () => { throw new Error('Forbidden mutation/geometry/input'); };
  const methods = Object.fromEntries(['focus', 'blur', 'scroll', 'scrollTo', 'scrollBy', 'setBaseAndExtent', 'removeAllRanges',
    'addRange', 'collapse', 'extend', 'appendChild', 'setAttribute', 'addEventListener', 'getBoundingClientRect'].map(key => [key, forbidden]));
  const element = (tagName: string, parentElement: any = null): any => ({ tagName, parentElement, style: Object.freeze({}), ...methods });
  const outer: any = { ...methods, activeElement: null, hasFocus: () => true };
  const seen = new Set();
  function freeze(value: any) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value); Object.values(value).forEach(freeze); Object.freeze(value);
  }
  const views = Array.from({ length: copies }, (_, index) => {
    const frame: any = { ...element('IFRAME'), id: `epubjs-view-${index}`, isConnected: !hidden };
    const html = element('HTML'), body = element('BODY', html), p = element('P', body);
    const doc: any = { ...methods, activeElement: body, hasFocus: () => !hidden,
      querySelector: (selector: string) => Object.freeze({ textContent: selector === 'h1' ? heading : 'Even with punctuation, the word "hope," stays a single word here.' }),
      getElementById: () => Object.freeze({}), defaultView: null };
    const start = { parentElement: p, ownerDocument: doc }, end = { parentElement: p, ownerDocument: doc };
    const range = { ...methods, startContainer: start, endContainer: end, startOffset: 1, endOffset: 1, toString: () => word };
    const selection = { ...methods, isCollapsed: false, rangeCount: 1, getRangeAt: () => range,
      anchorNode: backward ? end : start, focusNode: backward ? start : end, anchorOffset: 1, focusOffset: 1 };
    const win = { ...methods, frameElement: frame, getComputedStyle: (_element: unknown, pseudoName?: string) => {
      if (pseudoName && !pseudo) throw new Error('Unsupported');
      return Object.freeze({ ...methods, backgroundColor: longStyle ? 'x'.repeat(64) : 'rgb(135, 206, 250)', color: 'rgb(0, 0, 0)',
        getPropertyValue: () => longStyle ? 'x'.repeat(64) : 'text' });
    } };
    doc.defaultView = available ? win : null; doc.getSelection = () => selection; frame.contentDocument = doc;
    if (!index) outer.activeElement = frame;
    freeze({ range, selection });
    return { id: frame.id, iframe: frame, element: element('DIV'), displayed: !hidden, section: { index: 0 },
      contents: { document: doc, cfiFromRange: () => 'epubcfi(/6/2!/4/4,/1:1,/3:1)' } };
  });
  const window = { ...methods, getComputedStyle: () => Object.freeze({ visibility: hidden ? 'hidden' : 'visible', display: 'block' }) };
  const globals = { document: outer, window, rendition: { manager: { views: { _views: views } } }, Date: { now: () => 1234 } };
  freeze(globals);
  return (marker = 'selection-host') => JSON.parse(vm.runInNewContext(`'use strict'; (function(){${source}\nreturn probe(${JSON.stringify(marker)});})()`, globals));
}

describe('selection-diagnostics HOST read-only receipt', () => {
  it('reads focus, ownership, selectability and pseudo-style without mutations or geometry', () => {
    const receipt = fixture()();
    expect(receipt).toMatchObject({ tag: 'DEBUG-SELECTION', schema: 1, at: 1234, marker: 'selection-host', status: 'OBSERVED',
      outerFocus: true, outerActive: 'IFRAME', instances: [{ view: 'epubjs-view-0', frame: 'epubjs-view-0', displayed: true,
        connected: true, available: true, frameDocument: true, contextFrame: true, focus: true, active: 'BODY', outerActiveIsFrame: true,
        visibility: ['visible', 'visible'], display: ['block', 'block'], highlightStyle: true,
        selected: { text: 'Even', cfi: 'epubcfi(/6/2!/4/4,/1:1,/3:1)', start: 1, end: 1, anchor: 1, focus: 1, backward: false,
          ownerDocument: true, ancestors: [['P', 'text', 'text'], ['BODY', 'text', 'text'], ['HTML', 'text', 'text']],
          selectionStyle: ['rgb(135, 206, 250)', 'rgb(0, 0, 0)'] } }] });
    expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThanOrEqual(1800);
  });
  it('enumerates both matching instances, including hidden/disconnected ones; IDs are observations', () => {
    const receipt = fixture({ copies: 2, hidden: true })();
    expect(receipt.status).toBe('OBSERVED');
    expect(receipt.instances.map((item: any) => [item.view, item.connected, item.displayed, item.focus, item.outerActiveIsFrame]))
      .toEqual([['epubjs-view-0', false, false, false, true], ['epubjs-view-1', false, false, false, false]]);
  });
  it('distinguishes reversed cross-node selections with equal offsets and unavailable pseudo styles', () => {
    expect(fixture({ backward: true, pseudo: false })().instances[0].selected).toMatchObject({ backward: true, selectionStyle: null });
  });
  it.each([
    [{ copies: 3 }, 'selection-host', 'instance-limit'], [{ copies: 17 }, 'selection-host', 'view-limit'],
    [{ word: 'SECRET https://owner.invalid/' }, 'selection-host', 'non-fixture-selection'],
    [{}, 'SECRET https://owner.invalid/', 'invalid-marker'], [{ copies: 2, longStyle: true }, 'selection-host', 'payload-limit'],
    [{ heading: 'SECRET owner passage' }, 'selection-host', 'wrong-fixture'], [{ available: false }, 'selection-host', 'fixture-unavailable'],
  ] as const)('blocks overflow or non-fixture content without leaking it: %j', (options, marker, reason) => {
    const receipt = fixture(options)(marker);
    expect(receipt).toMatchObject({ tag: 'DEBUG-SELECTION', schema: 1, status: 'BLOCKED', reason });
    expect(JSON.stringify(receipt)).not.toMatch(/SECRET|https:|instances/);
    expect(Buffer.byteLength(JSON.stringify(receipt))).toBeLessThan(1800);
  });
});
