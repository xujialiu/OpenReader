/**
 * Where a long name may be cut: after a whole word (#87, design 0060).
 *
 * The phone cuts a name that does not fit its lines after whatever letter the
 * `…` still fits behind, so the Library showed `… Volume Three: The Lo…`. The
 * owner asked for `… Volume Three: The…`. The phone has no way to be asked for
 * that, so `NameText` lays the whole name out with no line limit, reads the
 * lines back (`onTextLayout`) and asks this for the cuts to try.
 *
 * They come longest first: every line before the last kept whole, then the last
 * line with all its words, then with one fewer, down to its first. A comma,
 * colon or dash left in front of the `…` goes. Whether the `…` has room after a
 * given word only the layout knows, so `NameText` lays each cut out in turn and
 * shows the first that fits. None fitting leaves the phone's own cut, which is
 * what a name gets whose last line is one word, too long for the line, or is in
 * a script written without spaces, where a cut after any character is already
 * a cut between words.
 */
export function wordCuts(lines: readonly string[], max: number): string[] {
  if (lines.length <= max) return [];
  const before = lines.slice(0, max - 1).join('');
  let last = lines[max - 1].trimEnd();
  const cuts: string[] = [];
  for (;;) {
    const kept = last.replace(/[\s,;:\-\u2013\u2014]+$/u, '');
    if (kept && !cuts.includes(`${before}${kept}…`)) cuts.push(`${before}${kept}…`);
    const word = /\s+\S+$/u.exec(last);
    if (!word) return cuts;
    last = last.slice(0, word.index);
  }
}
