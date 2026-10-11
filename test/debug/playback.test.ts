import { afterEach, expect, it } from 'vitest';
import { setDebugLogWriter } from '../../src/debug/debug-log';
import { recordNativePlayback } from '../../src/debug/playback';

afterEach(() => setDebugLogWriter(null));

it('bounds native delivery and accepts only fixed event names and finite scalar fields', () => {
  const lines: string[] = [];
  setDebugLogWriter({ write: (_category, line) => lines.push(line), flush() {} });
  recordNativePlayback({ dropped: 5, events: [
    { event: 'private book title', nativeMs: 1 },
    { event: 'session.route', nativeMs: 2, reason: 2, sequence: 1, privateText: 'private words', state: Infinity },
    ...Array.from({ length: 200 }, () => ({ event: 'engine.pause.done', running: 0 })),
  ] }, 100);
  expect(lines).toHaveLength(128); // drop count + 127 valid records in the first 128
  expect(lines[0]).toBe('native dropped=5');
  expect(lines[1]).toBe('native session.route receivedMs=100 sequence=1 nativeMs=2 reason=2');
  expect(lines.join('\n')).not.toMatch(/private|Infinity/);
});

it('does not write a playback record without an installed Debug Log writer', () => {
  expect(() => recordNativePlayback({ events: [{ event: 'session.route', reason: 2 }] }, 100)).not.toThrow();
});
