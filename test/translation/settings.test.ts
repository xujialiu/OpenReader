import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOKUP, parseLookupSettings } from '../../src/translation/settings';

describe('device-local lookup preferences (#323)', () => {
  it('starts enabled with pause, an English dictionary and an English translation target', () => {
    expect(DEFAULT_LOOKUP).toMatchObject({ enabled: true, pauseReading: true, direction: 'en-en', target: 'en', preferredMode: 'dictionary' });
    expect(parseLookupSettings(undefined)).toEqual(DEFAULT_LOOKUP);
    expect(parseLookupSettings({})).toEqual(DEFAULT_LOOKUP);
  });

  it('preserves old saved values, including switches explicitly off and the previous language defaults', () => {
    const old = { enabled: false, pauseReading: false, direction: 'en-zh', target: 'zh-CN', service: 'google', microsoftRegion: 'eastasia' };
    expect(parseLookupSettings(old)).toEqual({ ...old, preferredMode: 'dictionary' });
    expect(parseLookupSettings({ ...old, direction: 'zh-en', service: 'microsoft' })).toMatchObject({ direction: 'zh-en', service: 'microsoft' });
  });

  it.each(['dictionary', 'translation'])('round-trips the explicit %s preference without including credentials', (preferredMode) => {
    const saved = parseLookupSettings({ ...DEFAULT_LOOKUP, preferredMode, microsoftKey: 'test-only' });
    expect(saved).toMatchObject({ preferredMode });
    expect(parseLookupSettings(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(JSON.stringify(saved)).not.toContain('test-only');
  });

  it('repairs invalid fields to the same defaults as a fresh installation', () => {
    expect(parseLookupSettings({ enabled: 'yes', pauseReading: 0, direction: 'unknown', target: 'unknown', preferredMode: 'unknown' })).toEqual(DEFAULT_LOOKUP);
  });
});
