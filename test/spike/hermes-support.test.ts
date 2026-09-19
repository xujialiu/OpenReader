import { describe, expect, it } from 'vitest';

import {
  engineName,
  engineReport,
  intlSegmenterProbe,
  nfcProbe,
  nfkcProbe,
  textDecoderProbe,
  unicodePropertyEscapeProbe,
} from '../../src/spike/hermes-support';

/**
 * These tests do **not** answer notes/NOTES.md items 1 and 2. They run under
 * Node, on V8, and the questions are about Hermes. What they check is that the
 * probes are worth running: that the cases they assert are the right cases
 * (V8 is known-correct here, so a probe that fails under Node is a bug in the
 * probe), and that a probe reports a failure instead of throwing one — a
 * diagnostic that crashes the app it is diagnosing tells you nothing.
 *
 * The answer arrives by launching the app and reading the first screen.
 */
describe('the engine probes', () => {
  it('is not measuring Hermes here, and says so', () => {
    const report = engineReport();
    expect(report.isHermes).toBe(false);
    expect(engineName()).toBe('V8 (not Hermes)');
  });

  it('asserts cases that a correct engine passes', () => {
    // If any of these fail the probe is wrong, not the engine: V8 implements
    // all five, so this pins the expected values rather than the platform.
    for (const probe of engineReport().probes) {
      expect(probe.detail, `${probe.id} (${probe.source})`).toBe('yes');
      expect(probe.ok).toBe(true);
    }
  });

  it('names every probe and where its answer is owed', () => {
    const report = engineReport();
    expect(report.probes.map((p) => p.id)).toEqual([
      'nfkc',
      'text-decoder',
      'nfc',
      'property-escapes',
      'intl-segmenter',
    ]);
    // The two the notes actually block on cite the note item, so a result read
    // off the screen can be traced back to what it settles.
    expect(nfkcProbe().source).toContain('notes/NOTES.md item 1');
    expect(textDecoderProbe().source).toContain('notes/NOTES.md item 2');
  });

  it('reports a throw as a failed probe rather than propagating it', () => {
    // Hermes's documented failure mode for item 1 is a crash, not a wrong
    // answer, so this is the case that matters most on the device.
    const normalize = String.prototype.normalize;
    /* eslint-disable no-extend-native -- The failure being reproduced is a
       crash inside normalize itself, which cannot be faked from outside it.
       Restored in the finally below. */
    String.prototype.normalize = function () {
      throw new RangeError('simulating the Hermes crash in notes/NOTES.md item 1');
    };
    try {
      const probe = nfkcProbe();
      expect(probe.ok).toBe(false);
      expect(probe.detail).toBe('threw RangeError: simulating the Hermes crash in notes/NOTES.md item 1');
    } finally {
      String.prototype.normalize = normalize;
      /* eslint-enable no-extend-native */
    }
  });

  it('reports a missing global as a failed probe', () => {
    const scope = globalThis as { TextDecoder?: unknown };
    const real = scope.TextDecoder;
    delete scope.TextDecoder;
    try {
      const probe = textDecoderProbe();
      expect(probe.ok).toBe(false);
      expect(probe.detail).toBe('TextDecoder is not defined');
    } finally {
      scope.TextDecoder = real;
    }
  });

  it('reports a wrong answer, not just a missing one', () => {
    // The quiet failure: TextDecoder exists and mangles multi-byte UTF-8.
    const real = globalThis.TextDecoder;
    class Mangling {
      encoding = 'utf-8';
      decode() {
        return '???';
      }
    }
    globalThis.TextDecoder = Mangling as unknown as typeof TextDecoder;
    try {
      const probe = textDecoderProbe();
      expect(probe.ok).toBe(false);
      expect(probe.detail).toContain('three-byte UTF-8');
    } finally {
      globalThis.TextDecoder = real;
    }
  });
});

describe('the cases the probes pin', () => {
  // Spelled out so the expected values are reviewable without running anything.
  it('folds compatibility characters under NFKC (aligner, bracket stripping)', () => {
    expect('ｅｎ'.normalize('NFKC')).toBe('en');
    expect('ﬁ'.normalize('NFKC')).toBe('fi');
    expect(nfkcProbe().ok).toBe(true);
  });

  it('round-trips NFC and NFD, which ADR 0008 text anchors depend on', () => {
    expect('é'.normalize('NFD')).toBe('é');
    expect('é'.normalize('NFC')).toBe('é');
    expect(nfcProbe().ok).toBe(true);
  });

  it('decodes UTF-8 across a chunk boundary', () => {
    const decoder = new TextDecoder('utf-8');
    const bytes = new Uint8Array([0xe4, 0xbd, 0xa0]);
    expect(decoder.decode(bytes.slice(0, 2), { stream: true }) + decoder.decode(bytes.slice(2), { stream: true })).toBe(
      '你',
    );
  });

  it('matches Unicode property escapes that align.ts requires', () => {
    expect(/\p{Script=Han}/u.test('好')).toBe(true);
    expect(unicodePropertyEscapeProbe().ok).toBe(true);
  });

  it('segments words when Intl.Segmenter is present', () => {
    expect(intlSegmenterProbe().ok).toBe(true);
  });
});
