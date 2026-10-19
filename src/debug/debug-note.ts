/**
 * A **Debug Note** (CONTEXT.md, #305, ADR 0082): a few words the author writes
 * about a fault at the moment he meets it, kept in the Debug Log under that
 * moment's time.
 *
 * The time is the tap on the reader's `Debug` row, formatted as the Debug Log
 * formats a line's own time (`localStamp`), so the text the author copies
 * finds its line by a plain search. The line is written at Save, which may be
 * half a minute later; Cancel writes nothing.
 *
 * Platform-free, like the rest of `src/debug/` but `install.ts` and `launch.ts`:
 * the alert and the clipboard are the app's (`debug-note-alert.tsx`).
 */
import { cutText, debugLog, flushDebugLog, shortId } from './debug-log';

export interface DebugNote {
  /** The Debug Note's time: `localStamp` of the tap on Debug. */
  time: string;
  /** The Document being read: its Document Id and the title the Library shows. */
  document: { id: string; title: string };
  /** What the author typed; may be blank. */
  comment: string;
}

/**
 * What `Save and Copy` puts on the clipboard: the time, then the comment, or
 * the time alone. The author keeps it in his own notes and hands it to an
 * agent later, which searches the Debug Log for the time.
 */
export function debugNoteCopy(time: string, comment: string): string {
  const said = comment.trim();
  return said ? `${time} ${said}` : time;
}

type Listener = (time: string) => void;
const listeners = new Set<Listener>();

/**
 * Hear each Debug Note as it is written. The reader answers with its status
 * line and a renderer snapshot, so a search for the time finds them beside the
 * note. Answers the function that stops listening.
 */
export function onDebugNote(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Write one `[debug-note]` line and append it at once, then tell the reader.
 *
 * The comment is the author's own and goes in whole, up to the line's 2,000
 * characters; like every line it passes the credential guard. The title is cut
 * as every title is.
 */
export function writeDebugNote(note: DebugNote): void {
  const said = note.comment.trim() || '(no comment)';
  debugLog('debug-note', `${note.time} ${cutText(note.document.title)} (${shortId(note.document.id)}): ${said}`);
  flushDebugLog();
  for (const listener of [...listeners]) listener(note.time);
}
