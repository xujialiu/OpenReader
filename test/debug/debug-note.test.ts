import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/debug/mode', () => ({ DEBUG_MODE: true }));

const { createDebugLog, debugLog, localStamp, setDebugLogWriter } = await import('../../src/debug/debug-log');
const { debugNoteCopy, onDebugNote, writeDebugNote } = await import('../../src/debug/debug-note');

/**
 * A **Debug Note** (CONTEXT.md, #305): what the author wrote about a fault, kept
 * in the Debug Log under the time he tapped Debug, and the text he copies to
 * find it again. The reader answers its announcement with its own state.
 */
function folder() {
  const text = new Map<string, string>();
  return {
    text,
    files: {
      list: () => [...text.keys()],
      size: (name: string) => Buffer.byteLength(text.get(name) ?? ''),
      append(name: string, more: string) { text.set(name, (text.get(name) ?? '') + more); },
      remove(name: string) { text.delete(name); },
    },
  };
}

/** 2026-10-20 14:03:12.345 in UTC+8, the owner's zone; Save is 20 s later. */
const TAPPED = Date.UTC(2026, 9, 20, 6, 3, 12, 345);
const TIME = localStamp(TAPPED, 480);
const DOCUMENT = { id: 'sha256:5f1c9a2b7e0d4c3a', title: 'The Count of Monte Cristo, Volume One, Chapters One to Twenty-Eight, Unabridged Edition' };

let disk: ReturnType<typeof folder>;
beforeEach(() => {
  vi.useFakeTimers();
  disk = folder();
  setDebugLogWriter(createDebugLog({ files: disk.files, now: () => TAPPED + 20_000 }));
});
afterEach(() => {
  setDebugLogWriter(null);
  vi.useRealTimers();
});

const lines = () => (disk.text.get('debug-log-000001.txt') ?? '').trim().split('\n');

describe('a Debug Note in the Debug Log', () => {
  it('is one [debug-note] line: the time Debug was tapped, the cut title, the short id and the whole comment', () => {
    writeDebugNote({ time: TIME, document: DOCUMENT, comment: '  the highlight fell two sentences behind the voice after the lock screen  ' });
    expect(lines()).toHaveLength(1);
    // The line's own time is Save's, in the machine's zone; the note's is the tap's.
    expect(lines()[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:32\.345 [+-]\d\d:\d\d \[debug-note\] /);
    expect(lines()[0].slice(lines()[0].indexOf('[debug-note]'))).toBe(
      '[debug-note] 2026-10-20 14:03:12.345 +08:00 ' +
        '"The Count of Monte Cristo, Volume One, Chapters One to Twenty-Eight, Unabridged…" (5f1c9a2b): ' +
        'the highlight fell two sentences behind the voice after the lock screen',
    );
  });

  it('is written at once, not after the batch interval', () => {
    writeDebugNote({ time: TIME, document: DOCUMENT, comment: 'stuck' });
    expect(disk.text.get('debug-log-000001.txt')).toContain('[debug-note]');
  });

  it('says so when the comment was left blank', () => {
    writeDebugNote({ time: TIME, document: DOCUMENT, comment: '   ' });
    expect(lines()[0]).toMatch(/\[debug-note\] 2026-10-20 14:03:12\.345 \+08:00 ".*" \(5f1c9a2b\): \(no comment\)$/);
  });
});

describe('what Save and Copy copies', () => {
  it('is the time, then the comment', () => {
    expect(debugNoteCopy(TIME, ' highlight fell behind ')).toBe('2026-10-20 14:03:12.345 +08:00 highlight fell behind');
  });

  it('is the time alone for a blank comment', () => {
    expect(debugNoteCopy(TIME, '  ')).toBe('2026-10-20 14:03:12.345 +08:00');
  });
});

describe("the reader's answer", () => {
  it('hears the time after the note is written, so its lines follow the note', () => {
    const heard: string[] = [];
    const stop = onDebugNote((time) => {
      heard.push(time);
      debugLog('hx', 'playing=true app=active utterance=41');
    });
    writeDebugNote({ time: TIME, document: DOCUMENT, comment: 'stuck' });
    stop();
    writeDebugNote({ time: TIME, document: DOCUMENT, comment: 'again' });
    expect(heard).toEqual(['2026-10-20 14:03:12.345 +08:00']);
    vi.advanceTimersByTime(2_000);
    expect(lines().map((line) => /\[([a-z-]+)\]/.exec(line)![1])).toEqual(['debug-note', 'hx', 'debug-note']);
  });
});
