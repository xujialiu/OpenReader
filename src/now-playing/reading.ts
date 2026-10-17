/**
 * The two decisions the lock screen makes, in the one file here that runs under
 * Node.
 *
 * The rest of this directory is a sequence of calls into `MediaPlayer` that needs
 * a device to mean anything — the same split `src/playback/` makes between
 * `timeline.ts` and `audio-graph.ts`, and for the same reason: `test/README.md` is
 * explicit that React Native code and native modules are not tested in this suite
 * by design, so every decision is moved somewhere a test can reach it and what is
 * left is orchestration.
 *
 * Neither of these imports the platform.
 */

import { currentRow, type Contents, type ReadingSpineItem } from '../core/document/contents';

/** What a remote button means once it is known whether the reading is running. */
export type RemoteIntent = 'play' | 'pause';

/**
 * What the lock screen's second line says, or the empty string when nothing can
 * honestly say it.
 *
 * The lock screen has room for one more line than the title, and the useful thing
 * to put there is where in the book the reading is. `currentRow` already answers
 * that for the contents sheet, and this is the same answer held to a higher bar,
 * because the two are read differently: a marked row in a list the owner has just
 * opened is read as "about here", while a line on a lock screen is read as a
 * statement.
 *
 * So `'before'` is refused. It means no navigation entry names the section being
 * read and the nearest one *before* it is reported — which is ordinary rather than
 * a malformed book (the owner's novel has 2,077 spine items and 2,076 entries, and
 * reading the one with no entry reports the cover). Marking the cover in an open
 * list is coarse; printing "Cover" on a lock screen while chapter 41 is being read
 * is wrong.
 *
 * `'shared'` is kept only where the first row holds the others: a part's title
 * and its chapters in one file, where the part does contain the reading. Where
 * the rows sharing the file are siblings, as the chapters of the Gutenberg Pride
 * and Prejudice are, the first is one chapter among several and naming it while a
 * later one is read is the confident wrong answer (#212). That answer is
 * `'shared'` only until the page has said where each chapter starts, and from
 * then on it is `'exact'` (`currentRow`).
 *
 * An empty label is refused too. A book may write an entry with no text in it, and
 * a blank second line is indistinguishable from a bug in this function.
 */
export function chapterOf(contents: Contents, reading: ReadingSpineItem | null): string {
  if (reading === null) return '';
  const at = currentRow(contents, reading);
  if (!at || at.precision === 'before') return '';
  if (at.precision === 'shared' && !holdsTheOthers(contents, at.row)) return '';
  return contents.rows[at.row]?.label ?? '';
}

/** Whether every other row naming `row`'s spine item sits under `row`: after it, with nothing at its own depth or above between them. */
function holdsTheOthers(contents: Contents, row: number): boolean {
  const { rows } = contents;
  const own = rows[row];
  if (!own) return false;
  let under = true;
  for (let index = 0; index < rows.length; index++) {
    if (index > row && rows[index].depth <= own.depth) under = false;
    if (index === row || rows[index].target !== own.target) continue;
    if (index < row || !under) return false;
  }
  return true;
}

/**
 * What a remote button is asking for.
 *
 * `toggle` is the command AirPods single-tap and most car head units send, and it
 * carries no direction — so it is resolved here against whether the reading is
 * running. That resolution is the one place the lock screen and the screen could
 * disagree about what a press means, which is why it is a function with a test
 * rather than a conditional inside a subscription.
 *
 * `play` and `pause` are not re-derived from `playing`. A lock screen that shows
 * Play offers `play`, and honouring it when this side believes it is already
 * playing is what recovers from the two having fallen out of step — turning it
 * into a pause because "we think we are playing" would make that disagreement
 * permanent.
 */
export function intentOf(command: 'play' | 'pause' | 'toggle', playing: boolean): RemoteIntent {
  if (command === 'toggle') return playing ? 'pause' : 'play';
  return command;
}
