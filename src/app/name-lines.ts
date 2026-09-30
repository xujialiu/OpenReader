/**
 * Where a long name in the Library is cut: after a whole word (#87).
 *
 * The phone cuts a name that does not fit its lines after whatever letter the
 * `…` still fits behind, so the Library showed `… Volume Three: The Lo…`. The
 * owner asked for `… Volume Three: The…`. The phone has no way to be asked for
 * that, so the row lays the whole name out at its own width with no limit,
 * reads the lines back (`onTextLayout`), and shows the text this returns.
 *
 * The last line gives up its last word, which is at least as wide as the `…`
 * that takes its place, or two words when the last is a single letter, which
 * may not be. A comma, colon or dash left in front of the `…` goes too.
 *
 * `null` means the name is shown as it is, and the phone cuts it if it has to:
 * when it fits, and when the last line has no word to give up — one word longer
 * than the line, or a name in a script written without spaces, where a cut
 * after any character is a cut between words.
 */
export function cutAtWord(lines: readonly string[], max: number): string | null {
  if (lines.length <= max) return null;
  let last = lines[max - 1].trimEnd();
  let dropped = 0;
  while (dropped < 2) {
    const word = /\s+(\S+)$/u.exec(last);
    if (!word) return null;
    dropped += [...word[1]].length;
    last = last.slice(0, word.index);
  }
  last = last.replace(/[\s,;:\-\u2013\u2014]+$/u, '');
  return last ? `${lines.slice(0, max - 1).join('')}${last}…` : null;
}
