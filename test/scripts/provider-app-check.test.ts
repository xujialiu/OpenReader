import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { assertPreflight, assertControl, assertRetries, countSaved } = require('../manual-test/voices-and-providers/provider-app-check.cjs');
it('counts the repository inventory by its hashed string Voice key, including a positive saved control', () => {
  expect(countSaved([{ voice: 'hashed-voice', count: 5, bytes: 84780 }], 'hashed-voice')).toBe(5);
  expect(countSaved([{ voice: 'other-voice', count: 3, bytes: 900 }], 'hashed-voice')).toBe(0);
  expect(() => countSaved([{ voice: { voice: 'raw-id' }, count: 5 }], 'raw-id')).toThrow();
});
const ready = { document: 'reading', provider: 'compatible', voice: 'fixture-willow', endpoint: true, consent: true, access: 'unlocked', playing: false, enabled: true, busyDownloads: false };
it('refuses the missing Voice and Consent that invalidated the previous phase', () => {
  expect(() => assertPreflight(ready, 'reading')).not.toThrow();
  for (const patch of [{ voice: '' }, { consent: false }, { endpoint: false }, { access: 'ended' }, { document: 'another' }, { busyDownloads: true }]) {
    expect(() => assertPreflight({ ...ready, ...patch }, 'reading')).toThrow(/BLOCKED/);
  }
});
it('requires a new server request and unbuffered playback before fault cases', () => {
  expect(() => assertControl(3, 3, { playing: true, buffering: false })).toThrow();
  expect(() => assertControl(3, 4, { playing: false, buffering: false })).toThrow();
  expect(() => assertControl(3, 4, { playing: true, buffering: true })).toThrow();
  expect(() => assertControl(3, 4, { playing: true, buffering: false })).not.toThrow();
});
it('proves retries by the same speech text, never by a total of unrelated requests', () => {
  expect(() => assertRetries([])).toThrow();
  expect(() => assertRetries([{ text: 'a' }, { text: 'b' }, { text: 'c' }])).toThrow();
  expect(() => assertRetries([{ text: 'a' }, { text: 'a' }, { text: 'a' }])).not.toThrow();
  expect(() => assertRetries(Array.from({ length: 4 }, () => ({ text: 'a' })))).toThrow();
});
