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

import { currentRow, type Contents } from '../core/document/contents';

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
 * is wrong. `'shared'` is kept: several rows name that section and the first of
 * them is reported, so the row does contain the reading.
 *
 * An empty label is refused too. A book may write an entry with no text in it, and
 * a blank second line is indistinguishable from a bug in this function.
 */
export function chapterOf(contents: Contents, section: number | null): string {
  if (section === null) return '';
  const at = currentRow(contents, { sectionIndex: section });
  if (!at || at.precision === 'before') return '';
  return contents.rows[at.row]?.label ?? '';
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
