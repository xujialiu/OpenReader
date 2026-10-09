/**
 * The **Debug Log** (CONTEXT.md, ADR 0054): what a build with Debug Mode keeps
 * on the device of what the app did, read back from the Mac after the owner
 * reports a fault.
 *
 * Platform-free, so that any module may write a line and still be imported by
 * the suite: the file layer, the clock and the system log are handed in by
 * `install.ts`, and until it has run (and it runs only in Debug Mode)
 * `debugLog` does nothing at all.
 *
 * - **One line per event**: local time to the millisecond with its UTC offset,
 *   the category in brackets, the message, never more than `LINE_CHARS`
 *   characters and never a line break.
 * - **Batched**: a line waits in memory and the batch is appended at most
 *   `FLUSH_MS` after its first line, and at once when the app leaves the
 *   foreground or meets a fatal error. Never one file write per line.
 * - **Rolling**: `debug-log-000001.txt`, `…000002.txt`, … of at most
 *   `FILE_BYTES` each; a batch that would take a file past it starts the next,
 *   and the oldest is deleted so that no more than `FILES` remain: 20 MB in all.
 * - **Never a credential**: every line passes `withoutCredentials` first
 *   (`credentials.ts`).
 * - **Also the system log**, at once, one line each, so that it lines up with
 *   WebKit's and UIKit's lines in a collected archive.
 */
import { withoutCredentials } from './credentials';

/**
 * What a line is about. `hx` is the walkthrough harness's own lines, `probe` its
 * `js` answers, and `renderer` epub.js as the reader's page sees it (#113).
 */
export type DebugCategory =
  | 'launch'
  | 'app'
  | 'hx'
  | 'warn'
  | 'error'
  | 'document'
  | 'reading'
  | 'provider'
  | 'download'
  | 'sync'
  | 'lookup'
  | 'purchase'
  | 'renderer'
  | 'probe';

export const FILE_BYTES = 5 * 1024 * 1024;
export const FILES = 4;
export const FLUSH_MS = 2_000;
/** A stack trace is the longest thing written; this keeps its first dozen frames. */
export const LINE_CHARS = 2_000;
/** Document text, a title, an address: cut to about this many characters wherever a line quotes one. */
export const TEXT_CHARS = 80;
/** Lines held between flushes before new ones are counted and dropped rather than kept: a runaway loop must not fill memory. */
export const BUFFERED_LINES = 2_000;

/** The Debug Log's folder, as the writer needs it. */
export interface DebugLogFiles {
  /** The names of the files in the folder. */
  list(): string[];
  /** A file's size in bytes. */
  size(name: string): number;
  /** Append to a file, creating it first when there is none. */
  append(name: string, text: string): void;
  remove(name: string): void;
}

export interface DebugLogDeps {
  files: DebugLogFiles;
  /** Milliseconds since the epoch. */
  now(): number;
  /** The same line, less its time, to the system log. Absent where the native module is. */
  systemLog?(line: string): void;
}

export interface DebugLogWriter {
  write(category: DebugCategory, message: string): void;
  /** Append what is waiting now. */
  flush(): void;
}

const NAME = /^debug-log-(\d{6})\.txt$/;
const nameOf = (serial: number) => `debug-log-${String(serial).padStart(6, '0')}.txt`;

/** `2026-09-29 14:03:12.345 +08:00`: the phone's wall clock, and how far it is from UTC. */
export function localStamp(ms: number, offsetMinutes: number = -new Date(ms).getTimezoneOffset()): string {
  const wall = new Date(ms + offsetMinutes * 60_000);
  const two = (n: number) => String(n).padStart(2, '0');
  const sign = offsetMinutes < 0 ? '-' : '+';
  const away = Math.abs(offsetMinutes);
  return (
    `${wall.getUTCFullYear()}-${two(wall.getUTCMonth() + 1)}-${two(wall.getUTCDate())} ` +
    `${two(wall.getUTCHours())}:${two(wall.getUTCMinutes())}:${two(wall.getUTCSeconds())}.` +
    `${String(wall.getUTCMilliseconds()).padStart(3, '0')} ${sign}${two(Math.floor(away / 60))}:${two(away % 60)}`
  );
}

/** At most `limit` characters, ending in `…` when cut, and never half of a surrogate pair. */
function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let end = limit - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** Document text, a title, a lookup's selection: quoted, and cut to about 80 characters (design 0054). */
export function cutText(text: string): string {
  return JSON.stringify(shorten(text, TEXT_CHARS));
}

/**
 * A URL as a line may quote it: scheme, host and path, and nothing that can carry
 * a credential — no `user:password@`, no query, no fragment — cut to about 80
 * characters.
 */
export function cutAddress(url: string): string {
  const found = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^@/?#]*@)?([^/?#]*)([^?#]*)/i.exec(url.trim());
  return shorten(found ? `${found[1]}${found[2]}${found[3]}` : '(not a URL)', TEXT_CHARS);
}

/** A Document Id's first eight hex digits, enough to tell the owner's documents apart in a line. */
export function shortId(id: string): string {
  return id.replace(/^[a-z0-9]+:/i, '').slice(0, 8);
}

/** What a thrown value says, with its name and a SynthesisError's kind. */
export function describeProblem(problem: unknown): string {
  if (problem instanceof Error) {
    const kind = (problem as { kind?: unknown }).kind;
    return `${problem.name}${typeof kind === 'string' ? `(${kind})` : ''}: ${problem.message}`;
  }
  return describeValue(problem);
}

/** One argument of `console.warn`/`console.error`, or a rejection, as text: an Error with its stack, anything else as JSON where it can be. */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ? `${value.name}: ${value.message} ${value.stack}` : `${value.name}: ${value.message}`;
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return String(value);
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, inner: unknown) => {
      if (typeof inner === 'object' && inner !== null) {
        if (seen.has(inner)) return '[circular]';
        seen.add(inner);
      }
      return inner;
    });
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

export function createDebugLog(deps: DebugLogDeps): DebugLogWriter {
  let waiting: string[] = [];
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The file being appended to, and its size as this writer knows it. Read from the folder at the first flush. */
  let current: { serial: number; bytes: number } | null = null;

  const serials = () =>
    deps.files
      .list()
      .map((name) => NAME.exec(name))
      .filter((found): found is RegExpExecArray => found !== null)
      .map((found) => Number(found[1]))
      .sort((a, b) => a - b);

  /** Delete the oldest until `keep` files are left. */
  function dropOldest(keep: number) {
    const all = serials();
    for (const serial of all.slice(0, Math.max(0, all.length - keep))) deps.files.remove(nameOf(serial));
  }

  /** The file a batch of `bytes` goes into: the newest, unless it would pass `FILE_BYTES`. */
  function target(bytes: number): { serial: number; bytes: number } {
    if (!current) {
      const all = serials();
      const newest = all[all.length - 1];
      current = newest === undefined ? { serial: 1, bytes: 0 } : { serial: newest, bytes: deps.files.size(nameOf(newest)) };
      dropOldest(FILES);
    }
    if (current.bytes > 0 && current.bytes + bytes > FILE_BYTES) {
      current = { serial: current.serial + 1, bytes: 0 };
      dropOldest(FILES - 1);
    }
    return current;
  }

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (dropped) waiting.push(`${localStamp(deps.now())} [app] ${dropped} lines were dropped: more than ${BUFFERED_LINES} arrived between two writes`);
    dropped = 0;
    if (!waiting.length) return;
    const text = `${waiting.join('\n')}\n`;
    waiting = [];
    const bytes = utf8Bytes(text);
    try {
      const file = target(bytes);
      deps.files.append(nameOf(file.serial), text);
      file.bytes += bytes;
    } catch (problem) {
      // Never `console`, which is itself written here. The batch is lost; the next one tries again from the folder.
      current = null;
      deps.systemLog?.(`[app] the Debug Log could not be written: ${describeProblem(problem)}`);
    }
  }

  function write(category: DebugCategory, message: string) {
    const text = shorten(withoutCredentials(message).replace(/\r\n|\r|\n/g, ' ⏎ '), LINE_CHARS);
    deps.systemLog?.(`[${category}] ${text}`);
    if (waiting.length >= BUFFERED_LINES) {
      dropped += 1;
      return;
    }
    waiting.push(`${localStamp(deps.now())} [${category}] ${text}`);
    if (timer === null) timer = setTimeout(flush, FLUSH_MS);
  }

  return { write, flush };
}

/** The size of `text` in UTF-8, which is what the file grows by. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

let writer: DebugLogWriter | null = null;
/** Set once, by `install.ts`, in Debug Mode only. */
export function setDebugLogWriter(next: DebugLogWriter | null): void {
  writer = next;
}

/**
 * One Debug Log line. Does nothing in a build without Debug Mode.
 *
 * `message` is built at the call site from named facts; quote document text,
 * a title or an address only through `cutText` and `cutAddress`, and never
 * pass a request's headers, a settings object, or anything read from the
 * Keychain (test/debug/credential-rule.test.ts reads every call for that).
 */
export function debugLog(category: DebugCategory, message: string): void {
  writer?.write(category, message);
}

/** Append what is waiting now: on leaving the foreground, and before a fatal error takes the app. */
export function flushDebugLog(): void {
  writer?.flush();
}
