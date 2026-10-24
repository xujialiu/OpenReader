import { describe, expect, it } from 'vitest';

import { buildIdentity, resolveBuildVariant, type BuildVariant } from '../../build-variant';

describe('one identity for each release copy (#324)', () => {
  it('defaults to the formal copy and accepts only named roles', () => {
    expect(resolveBuildVariant({})).toBe('formal');
    for (const variant of ['formal', 'free', 'debug'] as const) {
      expect(resolveBuildVariant({ variant })).toBe(variant);
    }
    for (const variant of ['', 'release', 'Debug', ' free']) {
      expect(() => resolveBuildVariant({ variant })).toThrow(/variant/i);
    }
  });

  it('keeps source-build flags compatible without allowing conflicting identities', () => {
    expect(resolveBuildVariant({ debugMode: '1' })).toBe('debug');
    expect(resolveBuildVariant({ unlocked: '1' })).toBe('free');
    expect(resolveBuildVariant({ debugMode: '1', unlocked: '1' })).toBe('debug');
    for (const value of ['0', 'true', '', ' 1']) {
      expect(resolveBuildVariant({ debugMode: value, unlocked: value })).toBe('formal');
    }
    expect(() => resolveBuildVariant({ variant: 'formal', unlocked: '1' })).toThrow(/conflict/i);
    expect(() => resolveBuildVariant({ variant: 'free', debugMode: '1' })).toThrow(/conflict/i);
    expect(() => resolveBuildVariant({ variant: 'formal', debugMode: '1' })).toThrow(/conflict/i);
    expect(resolveBuildVariant({ variant: 'debug', debugMode: '1', unlocked: '1' })).toBe('debug');
  });

  it.each([
    ['formal', '13', '1.0.2 (13)', false, true],
    ['free', '14', '1.0.2 (14)-free', false, false],
    ['debug', '15', '1.0.2 (15)-debug', true, false],
  ] as const)('derives %s from the formal base', (variant, buildNumber, shownVersion, debugMode, purchases) => {
    expect(buildIdentity('1.0.2 (13)', variant)).toEqual({
      variant, version: '1.0.2', buildNumber, versionLine: `1.0.2 (${buildNumber})`, shownVersion, debugMode, purchases,
    });
  });

  it('accepts the next even base and preserves Version/Beta while deriving each number', () => {
    for (const [variant, number, suffix] of [['formal', 16, ''], ['free', 17, '-free'], ['debug', 18, '-debug']] as const) {
      const result = buildIdentity('1.0.2 (16)-beta7', variant);
      expect(result.buildNumber).toBe(String(number));
      expect(result.version).toBe('1.0.2');
      expect(result.versionLine).toBe(`1.0.2 (${number})-beta7`);
      expect(result.shownVersion).toBe(`1.0.2 (${number})-beta7${suffix}`);
    }
  });

  it.each(['1.0.2', 'v1.0.2 (13)', '1.0.2(13)', '1.0.2 (0)', '1.0.2 (13)-beta0', '1.0.2 (13)-free', '1.0.2 (9007199254740991)'])('rejects an ambiguous or unsafe base %s', (line) => {
    expect(() => buildIdentity(line, 'formal' satisfies BuildVariant)).toThrow(/APP_VERSION|Build Number/);
  });
});
