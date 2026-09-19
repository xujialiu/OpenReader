import { describe, expect, it } from 'vitest';

import { BYTES_PER_FRAME, frameCount, pcm16ToFloat32, resampleLinear } from '../../src/playback/pcm';

/**
 * ADR 0013 fixes the layout: `pcm` means 16-bit signed little-endian mono. A
 * sign error or a swapped byte order is not a crash and not a bug report — it is
 * a Clip that sounds like static, which is indistinguishable from a bad Provider
 * on a phone. So it is asserted here, byte by byte.
 */

/** Little-endian 16-bit words as bytes. */
const le = (...words: number[]): Uint8Array => {
  const bytes = new Uint8Array(words.length * 2);
  words.forEach((word, i) => {
    bytes[i * 2] = word & 0xff;
    bytes[i * 2 + 1] = (word >> 8) & 0xff;
  });
  return bytes;
};

describe('frameCount', () => {
  it('is two bytes a frame, because the contract is 16-bit mono', () => {
    expect(BYTES_PER_FRAME).toBe(2);
    expect(frameCount(4800)).toBe(2400);
  });

  it('drops a trailing half sample rather than reading it as a sample', () => {
    // An odd byte count means a truncated reply. Half a sample read as a whole
    // one is a click.
    expect(frameCount(5)).toBe(2);
  });
});

describe('pcm16ToFloat32', () => {
  it('reads little-endian, not the platform’s endianness', () => {
    // 0x0100 little-endian is 256, not 1. Reading it the other way round would
    // agree with the contract by luck on ARM and never be noticed.
    const samples = pcm16ToFloat32(new Uint8Array([0x00, 0x01]));
    expect(samples[0]).toBeCloseTo(256 / 32768, 12);
  });

  it('reads the top of the range as negative', () => {
    // 0x8000 is -32768 in two's complement, and it is the sample a sign error
    // turns into +1 — a full-scale inversion, which is audible as distortion.
    expect(pcm16ToFloat32(le(0x8000))[0]).toBe(-1);
    expect(pcm16ToFloat32(le(0xffff))[0]).toBeCloseTo(-1 / 32768, 12);
  });

  it('divides by 32768 so the most negative sample is exactly -1 and nothing clips', () => {
    expect(pcm16ToFloat32(le(0x7fff))[0]).toBeCloseTo(32767 / 32768, 12);
    expect(pcm16ToFloat32(le(0x0000))[0]).toBe(0);
  });

  it('reads bytes at any offset in the underlying buffer', () => {
    // The provider layer hands over a view; nothing promises it is two-aligned,
    // which is why an Int16Array view is not used.
    const backing = new Uint8Array([0xff, 0x00, 0x80, 0x00, 0x00]);
    const view = backing.subarray(1, 5);
    const samples = pcm16ToFloat32(view);
    expect(Array.from(samples)).toEqual([-1, 0]);
  });

  it('gives back a Float32Array that exactly covers its own ArrayBuffer', () => {
    // Load-bearing: the native `copyToChannel` takes its length from
    // `arrayBuffer.size(runtime) / sizeof(float)` — the buffer, not the view —
    // so a subarray would copy whatever follows it in memory.
    const samples = pcm16ToFloat32(le(1, 2, 3));
    expect(samples.byteOffset).toBe(0);
    expect(samples.buffer.byteLength).toBe(samples.length * 4);
  });

  it('gives back nothing for nothing', () => {
    expect(pcm16ToFloat32(new Uint8Array(0)).length).toBe(0);
  });
});

describe('resampleLinear', () => {
  it('copies when the rates already match', () => {
    const input = new Float32Array([0, 0.5, 1]);
    const output = resampleLinear(input, 24_000, 24_000);
    expect(Array.from(output)).toEqual([0, 0.5, 1]);
    expect(output.buffer).not.toBe(input.buffer);
  });

  it('interpolates on the way up', () => {
    const output = resampleLinear(new Float32Array([0, 1]), 24_000, 48_000);
    expect(output.length).toBe(4);
    expect(output[0]).toBe(0);
    expect(output[1]).toBeCloseTo(0.5, 6);
    expect(output[2]).toBe(1);
  });

  it('drops frames on the way down', () => {
    const output = resampleLinear(new Float32Array([0, 1, 2, 3]), 48_000, 24_000);
    expect(Array.from(output)).toEqual([0, 2]);
  });

  it('never reads past the last sample', () => {
    // The last output frame lands exactly on or past the input's end, and
    // reading one beyond it would be NaN in the buffer — a click at every
    // sentence boundary.
    const output = resampleLinear(new Float32Array([0, 1, 2]), 24_000, 48_000);
    expect(Array.from(output).every(Number.isFinite)).toBe(true);
    expect(output[output.length - 1]).toBe(2);
  });

  it('holds the duration, which is what the timeline believes', () => {
    const frames = 24_000;
    const output = resampleLinear(new Float32Array(frames), 24_000, 16_000);
    expect(output.length / 16_000).toBeCloseTo(frames / 24_000, 6);
  });

  it('gives back an exactly-sized Float32Array here too', () => {
    const output = resampleLinear(new Float32Array([0, 1]), 24_000, 48_000);
    expect(output.byteOffset).toBe(0);
    expect(output.buffer.byteLength).toBe(output.length * 4);
  });

  it('gives back nothing for nothing', () => {
    expect(resampleLinear(new Float32Array(0), 24_000, 48_000).length).toBe(0);
  });
});
