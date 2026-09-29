import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Debug Mode on, so that the guard holds what it is given; `install.test.ts` covers a build without it.
vi.mock('../../src/debug/mode', () => ({ DEBUG_MODE: true }));

const { forbidCredential, forgetCredentials } = await import('../../src/debug/credentials');
const {
  BUFFERED_LINES,
  FILE_BYTES,
  FILES,
  FLUSH_MS,
  LINE_CHARS,
  TEXT_CHARS,
  createDebugLog,
  cutAddress,
  cutText,
  debugLog,
  flushDebugLog,
  localStamp,
  shortId,
} = await import('../../src/debug/debug-log');

/**
 * The Debug Log's writer against a folder in memory and a clock that is told
 * the time (ADR 0054): one line per event, batched, rolling over four files of
 * 5 MB, and never a credential.
 */
function folder(sizes: Record<string, number> = {}) {
  const text = new Map<string, string>();
  const size = new Map(Object.entries(sizes));
  const appends: string[] = [];
  const removed: string[] = [];
  return {
    text,
    appends,
    removed,
    files: {
      list: () => [...new Set([...size.keys(), ...text.keys()])],
      size: (name: string) => size.get(name) ?? 0,
      append(name: string, more: string) {
        appends.push(name);
        text.set(name, (text.get(name) ?? '') + more);
        size.set(name, (size.get(name) ?? 0) + Buffer.byteLength(more));
      },
      remove(name: string) {
        removed.push(name);
        text.delete(name);
        size.delete(name);
      },
    },
  };
}

/** 2026-09-29 14:03:12.345 in UTC+8, the owner's zone. */
const AT = Date.UTC(2026, 8, 29, 6, 3, 12, 345);

beforeEach(() => {
  vi.useFakeTimers();
  forgetCredentials();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a Debug Log line', () => {
  it('stamps local time to the millisecond with its UTC offset', () => {
    expect(localStamp(AT, 480)).toBe('2026-09-29 14:03:12.345 +08:00');
    expect(localStamp(AT, -300)).toBe('2026-09-29 01:03:12.345 -05:00');
    expect(localStamp(AT, 330)).toBe('2026-09-29 11:33:12.345 +05:30');
    expect(localStamp(AT, 0)).toBe('2026-09-29 06:03:12.345 +00:00');
  });

  it('is the stamp, the category in brackets and the message, one line, cut to its length', () => {
    const disk = folder();
    const log = createDebugLog({ files: disk.files, now: () => AT });
    log.write('reading', 'play at utterance 12');
    log.write('error', 'TypeError: x\n    at one\r\n    at two');
    log.write('hx', 'y'.repeat(LINE_CHARS + 50));
    log.flush();
    const lines = disk.text.get('debug-log-000001.txt')!.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d \[reading\] play at utterance 12$/);
    expect(lines[1]).toMatch(/\[error\] TypeError: x ⏎ {5}at one ⏎ {5}at two$/);
    const long = lines[2].slice(lines[2].indexOf('[hx] ') + 5);
    expect(long).toHaveLength(LINE_CHARS);
    expect(long.endsWith('…')).toBe(true);
    expect(lines[3]).toBe('');
  });

  it('quotes document text, a title or an address cut to about 80 characters, and never an address\'s credentials', () => {
    const sentence = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness.';
    const cut = JSON.parse(cutText(sentence)) as string;
    expect(cut).toHaveLength(TEXT_CHARS);
    expect(cut.endsWith('…')).toBe(true);
    expect(cutText('Short.')).toBe('"Short."');
    // Never half of a surrogate pair.
    expect(JSON.parse(cutText(`${'a'.repeat(TEXT_CHARS - 2)}😀😀`)) as string).toBe(`${'a'.repeat(TEXT_CHARS - 2)}…`);
    expect(cutAddress('https://owner:hunter22@dav.example.com/remote.php/dav/files/owner/?token=abc#x'))
      .toBe('https://dav.example.com/remote.php/dav/files/owner/');
    expect(cutAddress('not an address')).toBe('(not a URL)');
    expect(shortId('sha256:0123456789abcdef')).toBe('01234567');
  });

  it('goes to the system log at once, without the stamp, one call per line', () => {
    const disk = folder();
    const systemLog = vi.fn();
    const log = createDebugLog({ files: disk.files, now: () => AT, systemLog });
    log.write('app', 'app background');
    expect(systemLog).toHaveBeenCalledWith('[app] app background');
    expect(disk.appends).toEqual([]);
  });
});

describe('batching: never one file write per line', () => {
  it('appends what arrived within the interval as one write, at its end', () => {
    const disk = folder();
    const log = createDebugLog({ files: disk.files, now: () => Date.now() });
    for (let i = 0; i < 50; i++) log.write('hx', `line ${i}`);
    vi.advanceTimersByTime(FLUSH_MS - 1);
    expect(disk.appends).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(disk.appends).toEqual(['debug-log-000001.txt']);
    expect(disk.text.get('debug-log-000001.txt')!.trim().split('\n')).toHaveLength(50);
    // Nothing waiting, nothing written.
    vi.advanceTimersByTime(FLUSH_MS * 3);
    expect(disk.appends).toHaveLength(1);
  });

  it('appends at once when asked, as on leaving the foreground, and the timer then has nothing to do', () => {
    const disk = folder();
    const log = createDebugLog({ files: disk.files, now: () => AT });
    log.write('app', 'app background');
    log.flush();
    expect(disk.appends).toHaveLength(1);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(disk.appends).toHaveLength(1);
  });

  it('counts and drops lines past the batch limit rather than holding them, and says so', () => {
    const disk = folder();
    const log = createDebugLog({ files: disk.files, now: () => AT });
    for (let i = 0; i < BUFFERED_LINES + 7; i++) log.write('hx', `line ${i}`);
    log.flush();
    const lines = disk.text.get('debug-log-000001.txt')!.trim().split('\n');
    expect(lines).toHaveLength(BUFFERED_LINES + 1);
    expect(lines.at(-1)).toContain('[app] 7 lines were dropped');
  });

  it('says in the system log when a batch could not be written, and writes the next', () => {
    const disk = folder();
    const systemLog = vi.fn();
    let refuse = true;
    const log = createDebugLog({
      files: { ...disk.files, append: (name, text) => { if (refuse) throw new Error('disk full'); disk.files.append(name, text); } },
      now: () => AT,
      systemLog,
    });
    log.write('hx', 'lost');
    log.flush();
    expect(systemLog).toHaveBeenLastCalledWith('[app] the Debug Log could not be written: Error: disk full');
    refuse = false;
    log.write('hx', 'kept');
    log.flush();
    expect(disk.text.get('debug-log-000001.txt')).toContain('[hx] kept');
  });
});

describe('rolling: four files of 5 MB, the oldest dropped first', () => {
  it('goes on appending to the newest file the folder holds', () => {
    const disk = folder({ 'debug-log-000003.txt': 100, 'debug-log-000004.txt': 200, 'notes.txt': 5 });
    const log = createDebugLog({ files: disk.files, now: () => AT });
    log.write('launch', 'again');
    log.flush();
    expect(disk.appends).toEqual(['debug-log-000004.txt']);
    expect(disk.removed).toEqual([]);
  });

  it('starts the next file when a batch would take the newest past 5 MB, and drops the oldest so four remain', () => {
    const disk = folder({
      'debug-log-000001.txt': FILE_BYTES,
      'debug-log-000002.txt': FILE_BYTES,
      'debug-log-000003.txt': FILE_BYTES,
      'debug-log-000004.txt': FILE_BYTES - 20,
    });
    const log = createDebugLog({ files: disk.files, now: () => AT });
    log.write('hx', 'this batch does not fit in the twenty bytes left');
    log.flush();
    expect(disk.appends).toEqual(['debug-log-000005.txt']);
    expect(disk.removed).toEqual(['debug-log-000001.txt']);
    expect(disk.files.list().filter((name) => name.startsWith('debug-log-')).sort()).toEqual([
      'debug-log-000002.txt',
      'debug-log-000003.txt',
      'debug-log-000004.txt',
      'debug-log-000005.txt',
    ]);
  });

  it('never lets a file pass 5 MB, and never holds more than four, however long it runs', () => {
    const disk = folder();
    const log = createDebugLog({ files: disk.files, now: () => AT });
    const line = 'x'.repeat(1_000);
    // About 22 MB of lines in batches of 500: past four files' worth.
    for (let batch = 0; batch < 44; batch++) {
      for (let i = 0; i < 500; i++) log.write('hx', line);
      log.flush();
      const names = disk.files.list();
      expect(names.length).toBeLessThanOrEqual(FILES);
      for (const name of names) expect(disk.files.size(name)).toBeLessThanOrEqual(FILE_BYTES);
    }
    const names = disk.files.list().sort();
    expect(names).toHaveLength(FILES);
    // The survivors are the newest four, in order.
    const serials = names.map((name) => Number(/(\d{6})/.exec(name)![1]));
    expect(serials).toEqual([serials[0], serials[0] + 1, serials[0] + 2, serials[0] + 3]);
    expect(disk.removed[0]).toBe('debug-log-000001.txt');
  });

  it('trims a folder holding more than four to the newest four', () => {
    const disk = folder(Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`debug-log-00000${n}.txt`, 10])));
    const log = createDebugLog({ files: disk.files, now: () => AT });
    log.write('launch', 'again');
    log.flush();
    expect(disk.removed).toEqual(['debug-log-000001.txt', 'debug-log-000002.txt']);
    expect(disk.appends).toEqual(['debug-log-000006.txt']);
  });
});

describe('never a credential', () => {
  it('writes a secret the app has held as [credential], in the file and in the system log', () => {
    forbidCredential('sk-proj-TESTKEY-0123456789');
    const disk = folder();
    const systemLog = vi.fn();
    const log = createDebugLog({ files: disk.files, now: () => AT, systemLog });
    log.write('warn', 'Provider refused sk-proj-TESTKEY-0123456789 with 401');
    log.flush();
    const written = disk.text.get('debug-log-000001.txt')!;
    expect(written).not.toContain('TESTKEY');
    expect(written).toContain('Provider refused [credential] with 401');
    expect(systemLog.mock.calls.flat().join('\n')).not.toContain('TESTKEY');
  });
});

describe('debugLog before anything installed a writer', () => {
  it('does nothing, which is a build without Debug Mode', () => {
    expect(() => {
      debugLog('reading', 'play');
      flushDebugLog();
    }).not.toThrow();
  });
});
