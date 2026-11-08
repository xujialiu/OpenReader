import { describe, expect, it } from 'vitest';

import {
  copyFailures, durationS, makeRedactor, negativeControls, onsetFailures, peakSample,
  sanitizeUrl, sha256Hex, timingProblems,
} from './audio-reference';
import type { Pcm } from '../kit/node-kit';
import type { Timestamp } from '../../../src/core/providers/types';

/** A clip of tone bursts: sound exactly where the Timings say words are. */
function burstPcm(rate: number, seconds: number, words: { start: number; end: number }[]): Pcm {
  const samples = new Int16Array(rate * seconds);
  for (const word of words) {
    const from = Math.floor(word.start * rate);
    const to = Math.min(samples.length, Math.floor(word.end * rate));
    for (let i = from; i < to; i++) samples[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate));
  }
  return { samples, rate };
}

const TEXT = 'fox jumps';

describe('sanitizeUrl', () => {
  it('keeps host and path, drops query, userinfo and anything after them', () => {
    expect(sanitizeUrl('https://user:secret@api.example.com/v1/tts/stream?key=abc&x=1')).toBe('https://api.example.com/v1/tts/stream');
    expect(sanitizeUrl('https://api.fish.audio/v1/tts/stream/with-timestamp')).toBe('https://api.fish.audio/v1/tts/stream/with-timestamp');
  });
});

describe('makeRedactor', () => {
  it('replaces loaded secret values and leaves everything else', () => {
    const redact = makeRedactor(['sk-very-secret-key-value', 'short']);
    expect(redact('Authorization: Bearer sk-very-secret-key-value end')).toBe('Authorization: Bearer <redacted> end');
    expect(redact('short values pass through')).toBe('short values pass through');
    expect(redact('no secrets here')).toBe('no secrets here');
  });
});

describe('timingProblems', () => {
  const good: Timestamp[] = [
    { start: 0.1, end: 0.3, charStart: 0, charEnd: 3 },
    { start: 0.5, end: 0.8, charStart: 4, charEnd: 9 },
  ];

  it('accepts real timings in the utterance\'s own coordinates', () => {
    expect(timingProblems(good, TEXT)).toEqual([]);
    expect(timingProblems([], TEXT)).toEqual(['no word timings']);
  });

  it('refuses inverted spans, out-of-range offsets, non-words and disorder', () => {
    expect(timingProblems([{ ...good[0]!, end: 0.05 }], TEXT).join(' ')).toMatch(/bad span/);
    expect(timingProblems([{ ...good[0]!, charEnd: 99 }], TEXT).join(' ')).toMatch(/bad character range/);
    expect(timingProblems([{ ...good[0]!, charStart: 3, charEnd: 4 }], TEXT).join(' ')).toMatch(/is not a word/);
    expect(timingProblems([good[1]!, good[0]!], TEXT).join(' ')).toMatch(/not after the previous word/);
    expect(timingProblems([{ ...good[0]!, charStart: 1 }], TEXT).join(' ')).toMatch(/not 0/);
  });
});

describe('onsetFailures', () => {
  const words = [{ start: 0.1, end: 0.3 }, { start: 0.5, end: 0.8 }, { start: 1.0, end: 1.4 }];
  const pcm = burstPcm(8000, 2, words);
  const timings: Timestamp[] = [
    { start: 0.1, end: 0.3, charStart: 0, charEnd: 3 },
    { start: 0.5, end: 0.8, charStart: 4, charEnd: 9 },
  ];

  it('finds sound under every span that has it and none where it does not', () => {
    expect(onsetFailures(pcm, [...timings, { start: 1.0, end: 1.4, charStart: 10, charEnd: 11 }])).toEqual([]);
    expect(onsetFailures(pcm, [{ start: 1.5, end: 1.9, charStart: 0, charEnd: 3 }])).toEqual([0]);
  });

  it('is quiet about silence at the very edges', () => {
    // A tone at the start only: timings inside silence must fail, the tone's own must pass.
    const tone = burstPcm(8000, 1, [{ start: 0, end: 0.2 }]);
    expect(onsetFailures(tone, [{ start: 0, end: 0.2, charStart: 0, charEnd: 3 }])).toEqual([]);
    expect(onsetFailures(tone, [{ start: 0.4, end: 0.6, charStart: 0, charEnd: 3 }])).toEqual([0]);
  });
});

describe('peakSample and durationS', () => {
  it('measure the clip itself', () => {
    const pcm = burstPcm(8000, 2, [{ start: 0, end: 0.1 }]);
    expect(peakSample(pcm)).toBeGreaterThan(7000);
    expect(durationS(pcm)).toBe(2);
  });
});

describe('copyFailures and negativeControls', () => {
  // Single-letter words over a letter-only text: every Timing slice is a word.
  const referenceText = 'abcdefghijkl';
  // A 3.3 s clip whose last word ends 0.05 s before the clip does: a gapped Timing has nowhere to hide.
  const words = Array.from({ length: 12 }, (_, i) => ({ start: i * 0.27, end: i * 0.27 + 0.22 }));
  const pcm = burstPcm(8000, 3.3, words);
  const timings: Timestamp[] = words.map((w, i) => ({ start: w.start, end: w.end, charStart: i, charEnd: i + 1 }));
  const reference = { pcmHash: sha256Hex(new Uint8Array(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.byteLength)), durationS: durationS(pcm), timingsHash: sha256Hex(new TextEncoder().encode(JSON.stringify(timings))) };
  const copyOf = (p: Pcm, ts: Timestamp[]) => ({
    pcmHash: sha256Hex(new Uint8Array(p.samples.buffer, p.samples.byteOffset, p.samples.byteLength)),
    durationS: durationS(p),
    timingsHash: sha256Hex(new TextEncoder().encode(JSON.stringify(ts))),
    timings: ts,
    text: referenceText,
  });

  it('accepts an honest copy', () => {
    expect(copyFailures(copyOf(pcm, timings), reference)).toEqual([]);
  });

  it('refuses every negative control', () => {
    for (const control of negativeControls(pcm)) {
      const ts = control.timings ? control.timings(timings) : timings;
      const failures = copyFailures(copyOf(control.pcm, ts), reference);
      expect(failures.length, `control ${control.name} must be refused`).toBeGreaterThan(0);
    }
  });

  it('catches an equal-frame-count replacement by hash — the strongest detector this analyser has; duration and Timings are unchanged. A waveform-alignment analyser could also catch it by content, and is out of scope here', () => {
    const control = negativeControls(pcm).find((c) => c.name === 'equal-frame-count-replace')!;
    const ts = timings;
    const failures = copyFailures(copyOf(control.pcm, ts), reference);
    expect(failures).toEqual(['pcm hash differs from the reference']);
  });

  it('catches gapped Timings even when the audio is untouched', () => {
    const control = negativeControls(pcm).find((c) => c.name === 'timestamp-gap')!;
    const ts = control.timings!(timings);
    const failures = copyFailures(copyOf(control.pcm, ts), reference);
    expect(failures.join(' ')).toMatch(/timings hash differs/);
    expect(failures.join(' ')).toMatch(/past the clip's/);
    // and the audio itself still matches, which is the point of the control
    expect(copyFailures(copyOf(control.pcm, timings), reference)).toEqual([]);
  });
});
