import { describe, expect, it } from 'vitest';

import { podfileForVariant } from '../../plugins/with-release-variant';

const template = "target 'OpenReader' do\n  use_expo_modules!\n  use_native_modules!\nend\n";

describe('Store module exclusion is a native build property (#324)', () => {
  it.each(['free', 'debug'] as const)('passes the local package name to Expo autolinking in %s', (variant) => {
    const result = podfileForVariant(template, variant);
    expect(result).toContain('use_expo_modules!({ exclude: ["open-reader-store"] })');
    expect(result).toContain(`openreader-variant:${variant}`);
    expect(podfileForVariant(result, variant)).toBe(result);
    expect(podfileForVariant(result, 'formal')).toContain('use_expo_modules!({ exclude: [] })');
  });

  it('keeps the module in the formal copy', () => {
    const result = podfileForVariant(template, 'formal');
    expect(result).toContain('use_expo_modules!({ exclude: [] })');
    expect(result).not.toContain('open-reader-store');
  });

  it('fails on another writer or a changed template instead of silently leaving Store linked', () => {
    for (const broken of ['', 'use_expo_modules!({ flags: {} })', template + '\nuse_expo_modules!\n']) {
      expect(() => podfileForVariant(broken, 'free')).toThrow(/Podfile|use_expo_modules/);
    }
  });
});
