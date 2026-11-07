import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../manual-test/settings/whitespace-probe.js', import.meta.url), 'utf8');
const left = 43.34375;
const right = 823.65625;
const shortEnd = 713.8203125;

function rect(x: number, top: number, width: number, height = 30) {
  return { left: x, top, width, height, right: x + width, bottom: top + height };
}

function paragraph(inkRight = shortEnd, top = 80, rects = [rect(left, top, inkRight - left)]) {
  return Object.freeze({
    textContent: 'Private document text must not be exported',
    getBoundingClientRect: () => rect(left, top, right - left), rects,
  });
}
type Paragraph = ReturnType<typeof paragraph>;

function view(paragraphs: Paragraph[], width = 867, top = 0, displayed = true) {
  return {
    displayed, section: { index: 0 },
    iframe: { getBoundingClientRect: () => rect(0, top, width, 1000) },
    contents: { document: {
      body: { getBoundingClientRect: () => rect(0, 0, width, 1000) },
      defaultView: { getComputedStyle: () => ({ paddingLeft: `${left}px`, paddingRight: `${left}px`,
        marginLeft: '0px', marginRight: '0px' }) },
      querySelectorAll: () => paragraphs,
      createRange: () => {
        let selected: Paragraph | undefined;
        return {
          selectNodeContents: (p: Paragraph) => { selected = p; },
          getClientRects: () => selected?.rects ?? [],
        };
      },
    } },
  };
}

function read(views = [view([paragraph()])]) {
  const context = vm.createContext({
    window: { innerWidth: 867, innerHeight: 669 },
    rendition: { manager: { views: { _views: views },
      container: { getBoundingClientRect: () => rect(0, 0, 867, 669) } } },
  });
  vm.runInContext(source, context);
  const json = vm.runInContext('probe()', context);
  return { value: JSON.parse(json), json };
}

describe('the read-only whitespace probe distinguishes paragraph boxes from text ends', () => {
  it('records the original short line without treating its end as the column boundary', () => {
    const { value, json } = read();
    expect(value).toMatchObject({ viewport: [867, 669], stageWidth: 867, iframeWidths: [867, 867] });
    expect(value.views[0]).toMatchObject({
      visibleParagraphs: 1, paragraphEdges: [left, right],
      rightmost: { left, width: 780.3125, inkRight: shortEnd, textRects: 1 },
    });
    expect(951 - value.views[0].rightmost.inkRight).toBeCloseTo(237.1796875);
    expect(json).not.toContain('Private document text');
  });

  it('keeps the same paragraph box when longer text reaches its right edge', () => {
    const lines = Array.from({ length: 4 }, (_, i) => rect(left, 80 + i * 30, right - left));
    const { value } = read([view([paragraph(right, 80, lines)])]);
    expect(value.views[0]).toMatchObject({
      paragraphEdges: [left, right], rightmost: { width: 780.3125, inkRight: right, textRects: 4 },
    });
    expect(951 - value.views[0].rightmost.inkRight - left).toBe(84);
  });

  it('filters off-viewport text rectangles and accounts for the iframe vertical offset', () => {
    const rows = [paragraph(right, -70), paragraph(shortEnd, 400), paragraph(right, 600)];
    const { value } = read([view(rows, 867, 100)]);
    expect(value.views[0]).toMatchObject({ visibleParagraphs: 2, rightmost: { inkRight: right, index: 0 } });
    const clipped = paragraph(shortEnd, 500, [rect(left, 500, shortEnd - left), rect(left, 700, right - left)]);
    expect(read([view([clipped])]).value.views[0].rightmost.inkRight).toBe(shortEnd);
  });

  it('does not invent text boundaries for empty, hidden or undisplayed paragraphs', () => {
    const empty = paragraph(shortEnd, 80, []);
    const zero = paragraph(left, 80, [rect(left, 80, 0)]);
    const { value } = read([view([empty, zero]), view([paragraph()], 951, 0, false)]);
    expect(value).toMatchObject({ displayedViews: 1, iframeWidths: [867, 867] });
    expect(value.views[0]).toMatchObject({ visibleParagraphs: 0, paragraphEdges: null, rightmost: null });
    expect(read([]).value).toMatchObject({ displayedViews: 0, iframeWidths: null, views: [] });
  });

  it('bounds detailed output while retaining iframe width extrema from omitted views', () => {
    const many = Array.from({ length: 50 }, () => view(Array.from({ length: 100 }, () => paragraph())));
    many.push(view([paragraph()], 951));
    const { value, json } = read(many);
    expect(value).toMatchObject({ displayedViews: 51, omittedViews: 48, iframeWidths: [867, 951] });
    expect(value.views).toHaveLength(3);
    expect(Buffer.byteLength(json)).toBeLessThan(1900);
  });
});
