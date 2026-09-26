import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { GLIDE_MS, GLIDE_SOURCE } from '../../src/renderer/glide';

/**
 * How the page moves when it follows the line being spoken (ADR 0050), run as
 * the WebView runs it: the same source text, evaluated.
 *
 * The curve is Speechify's, measured on the owner's iPhone
 * (notes/NOTES_2026-09-25.md, 23:00): about 250 ms whatever the distance, three
 * quarters of the way by half the time, the last frames a pixel or two.
 */

interface Line {
  doc: object;
  top: number;
  height: number;
}

interface Glide {
  GLIDE_MS: number;
  glideLeft(from: number, elapsed: number): number;
  sameLine(a: Line | null, b: Line | null): boolean;
  glides(move: number, visible: number): boolean;
}

const glide = vm.runInNewContext(GLIDE_SOURCE + '({ GLIDE_MS: GLIDE_MS, glideLeft: glideLeft, sameLine: sameLine, glides: glides });') as Glide;

/** The share of a move made by `elapsed` ms. */
const done = (elapsed: number): number => 1 - glide.glideLeft(100, elapsed) / 100;

describe('a glide (ADR 0050)', () => {
  it('lasts GLIDE_MS, 250 ms, the time Speechify takes', () => {
    expect(glide.GLIDE_MS).toBe(GLIDE_MS);
    expect(GLIDE_MS).toBe(250);
    expect(glide.glideLeft(55, 0)).toBe(55);
    expect(glide.glideLeft(55, GLIDE_MS)).toBe(0);
    expect(glide.glideLeft(55, GLIDE_MS + 100)).toBe(0);
  });

  it('eases out: fast at first, three quarters of the way by half the time', () => {
    // One 60 Hz frame in: a first step, not a crawl.
    expect(done(1000 / 60)).toBeCloseTo(0.129, 2);
    // Two frames: a quarter. Speechify's first captured frame showed 18–35 %.
    expect(done(2000 / 60)).toBeCloseTo(0.249, 2);
    expect(done(GLIDE_MS / 2)).toBeCloseTo(0.75, 5);
    // The last frame of a 55 px line is under a pixel, as Speechify's were 1–2 px.
    expect(glide.glideLeft(55, GLIDE_MS - 1000 / 60)).toBeLessThan(1);
  });

  it('only ever closes in, and never overshoots', () => {
    let last = glide.glideLeft(90, 0);
    for (let elapsed = 1; elapsed <= GLIDE_MS; elapsed += 1) {
      const left = glide.glideLeft(90, elapsed);
      expect(left).toBeLessThanOrEqual(last);
      expect(left).toBeGreaterThanOrEqual(0);
      last = left;
    }
  });

  it('takes the same time whatever the distance, and works upwards as well as down', () => {
    // A line (55 px in the Speechify capture) and a line with a paragraph gap
    // (91 px) are the same share of the way at the same moment.
    expect(glide.glideLeft(55, 100) / 55).toBeCloseTo(glide.glideLeft(91, 100) / 91, 10);
    expect(glide.glideLeft(-200, GLIDE_MS / 2)).toBeCloseTo(-50, 10);
  });

  it('has not begun before its start, which a frame stamped a moment earlier can say', () => {
    expect(glide.glideLeft(40, -3)).toBe(40);
  });
});

describe('the same line', () => {
  const doc = {};
  const other = {};
  const line = (top: number, on: object = doc, height = 24): Line => ({ doc: on, top, height });

  it('is the same document and tops within half a line', () => {
    expect(glide.sameLine(line(100), line(100))).toBe(true);
    // A word set in a fallback face sits a few pixels off its neighbours.
    expect(glide.sameLine(line(100), line(104))).toBe(true);
    expect(glide.sameLine(line(100), line(111))).toBe(true);
  });

  it('is not the next line, nor the same top in another section', () => {
    expect(glide.sameLine(line(100), line(136))).toBe(false);
    expect(glide.sameLine(line(100), line(64))).toBe(false);
    expect(glide.sameLine(line(100), line(100, other))).toBe(false);
  });

  it('is never nothing: before any line is followed, every line is new', () => {
    expect(glide.sameLine(null, line(100))).toBe(false);
  });
});

describe('what glides and what jumps', () => {
  it('glides anything within the visible page, and jumps anything further', () => {
    expect(glide.glides(36, 700)).toBe(true);
    expect(glide.glides(-700, 700)).toBe(true);
    expect(glide.glides(701, 700)).toBe(false);
    expect(glide.glides(-5000, 700)).toBe(false);
  });
});
