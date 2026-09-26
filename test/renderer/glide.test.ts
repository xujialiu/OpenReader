import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { DRIFT_TAU_MS, GLIDE_MS, GLIDE_SOURCE } from '../../src/renderer/glide';

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
  DRIFT_TAU_MS: number;
  glideLeft(from: number, elapsed: number): number;
  sameLine(a: Line | null, b: Line | null): boolean;
  glides(move: number, visible: number): boolean;
  lineLead(left: number, from: number, to: number, pitch: number): number;
  driftVelocity(error: number, velocity: number, dt: number): number;
}

const glide = vm.runInNewContext(
  GLIDE_SOURCE +
    '({ GLIDE_MS: GLIDE_MS, DRIFT_TAU_MS: DRIFT_TAU_MS, glideLeft: glideLeft, sameLine: sameLine, glides: glides, lineLead: lineLead, driftVelocity: driftVelocity });',
) as Glide;

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

describe('the lead, in Continuous (#71)', () => {
  // A 36 px line, drawn from x 20 to x 380.
  const lead = (left: number): number => glide.lineLead(left, 20, 380, 36);

  it('is nought at the start of a line and nearly a whole line at its end', () => {
    expect(lead(20)).toBe(0);
    expect(lead(200)).toBe(18);
    expect(lead(350)).toBeCloseTo(33, 10);
  });

  it('never carries a line less than nought or more than one line', () => {
    // A word that starts before the text drawn on its line — an indent measured
    // off another run — or past its end.
    expect(lead(0)).toBe(0);
    expect(lead(500)).toBe(36);
  });

  it('is nought when there is no line to measure along, rather than a guess', () => {
    expect(glide.lineLead(100, 380, 380, 36)).toBe(0);
    expect(glide.lineLead(100, Infinity, -Infinity, 36)).toBe(0);
    expect(glide.lineLead(100, 20, 380, 0)).toBe(0);
    expect(glide.lineLead(Number.NaN, 20, 380, 36)).toBe(0);
  });

  it('is measured along the line’s own text, so a short last line is still read to its end', () => {
    // The last line of a paragraph, drawn from 20 to 140: its last word is
    // nearly all of the way along it, not a third.
    expect(glide.lineLead(120, 20, 140, 36)).toBeCloseTo(30, 10);
  });
});

describe('the drift, in Continuous (#71)', () => {
  const FRAME = 1000 / 60;

  /** Follow `target(t)` for `ms`, as drift() does, but in exact pixels; the page's positions and speeds, per frame. */
  const follow = (target: (t: number) => number, ms: number, dt = FRAME) => {
    let x = 0;
    let v = 0;
    const frames: { t: number; x: number; v: number }[] = [];
    for (let t = dt; t <= ms; t += dt) {
      v = glide.driftVelocity(target(t) - x, v, dt);
      x += v * dt;
      frames.push({ t, x, v });
    }
    return frames;
  };

  it('has the time constant glide.ts states', () => {
    expect(glide.DRIFT_TAU_MS).toBe(DRIFT_TAU_MS);
    expect(DRIFT_TAU_MS).toBe(200);
  });

  it('closes on a step without ever passing it, and has all but arrived within a second', () => {
    const frames = follow(() => 20, 2000);
    expect(Math.max(...frames.map((f) => f.x))).toBeLessThanOrEqual(20);
    expect(frames.find((f) => f.t >= 1000)!.x).toBeGreaterThan(19);
    // A stalled frame counts two frames at most (drift()), and still never passes it.
    expect(Math.max(...follow(() => 20, 2000, 2 * FRAME).map((f) => f.x))).toBeLessThanOrEqual(20);
  });

  it('follows a steady reading a steady distance behind: two time constants of it', () => {
    // 9 px a second, the pace measured on Speechify's 36 px line.
    const rate = 9 / 1000;
    const frames = follow((t) => rate * t, 6000);
    const last = frames[frames.length - 1];
    expect(rate * last.t - last.x).toBeCloseTo(2 * DRIFT_TAU_MS * rate, 0);
  });

  it('turns a word at a time into one motion: its speed never stops between words', () => {
    // 3 px a word, a word every 330 ms: the staircase a line of text makes.
    const frames = follow((t) => 3 * Math.floor(t / 330), 6000).filter((f) => f.t > 2000);
    const speeds = frames.map((f) => f.v * 1000);
    expect(Math.min(...speeds)).toBeGreaterThan(5);
    expect(Math.max(...speeds)).toBeLessThan(13);
  });

  it('works upwards as well as down', () => {
    const frames = follow(() => -20, 2000);
    expect(Math.min(...frames.map((f) => f.x))).toBeGreaterThanOrEqual(-20);
    expect(frames[frames.length - 1].x).toBeLessThan(-19.9);
  });
});
