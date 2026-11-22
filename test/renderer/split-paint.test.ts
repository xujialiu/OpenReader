import { expect, it, vi } from 'vitest';
import { standInPage } from './stand-in-page';

it('paints only the direct text beside a block child and clears both levels when the reading moves (#194)', () => {
  const page = standInPage();
  const section = page.addSection(0, '<div>Before.<hr style="display:block"/>After <em>it</em>.</div><p>Next.</p>');
  const doc = section.document;
  const create = doc.createElementNS.bind(doc);
  doc.createElementNS = (ns: string, name: string) => Object.assign(create(ns, name), {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  const createRange = doc.createRange.bind(doc);
  doc.createRange = () => Object.assign(createRange(), {
    getClientRects(this: Range) { return [{ left: this.startOffset, top: 10, width: this.endOffset - this.startOffset, height: 20 }]; },
  });
  doc.defaultView.ResizeObserver = class { observe() {} disconnect() {} };
  doc.fonts = { addEventListener() {}, removeEventListener() {} };
  doc.removeEventListener = vi.fn();
  const readStyle = doc.defaultView.getComputedStyle;
  doc.defaultView.getComputedStyle = (el: Element, pseudo?: string) => pseudo
    ? { backgroundColor: pseudo.includes('utterance') ? 'red' : 'blue' } : readStyle(el);
  page.sweep();
  const [before, after, next] = page.blocks(section);
  expect([before.text, after.text, next.text]).toEqual(['Before.', 'After it.', 'Next.']);
  const cue = (block: typeof after) => ({ block: block.id, start: 0, end: block.text.length, text: block.text });
  const word = { ...cue(after), text: 'After', end: 5 };
  page.send({ kind: 'speak', utterance: 1, utteranceRanges: [cue(after)], words: [{ ranges: [word], startMs: 0 }], durationMs: 1000, rate: 1 });
  page.send({ kind: 'hold', stop: true, word: 0 });
  const layer = doc.getElementsByTagName('svg')[0];
  expect(layer.getAttribute('data-or-reading')).toBe('');
  const sentenceRects = layer.firstChild.getElementsByTagName('rect');
  expect(Array.from(sentenceRects, (r: any) => r.getAttribute('width'))).toEqual(['6', '1']);
  expect(sentenceRects[0].getAttribute('style')).toContain('fill:red');
  expect(doc.getElementsByTagName('em')[0].hasAttribute('data-or-mixed-text')).toBe(false);
  expect(doc.body.getElementsByTagName('svg')).toHaveLength(0);
  page.send({ kind: 'correct', utterance: 1, word: 0, elapsedMs: 0 });
  expect(layer.lastChild.firstChild.getAttribute('style')).toContain('fill:blue');
  page.send({ kind: 'speak', utterance: 2, utteranceRanges: [cue(next)], words: null, durationMs: 1000, rate: 1 });
  expect(doc.getElementsByTagName('svg')).toHaveLength(0);
});
