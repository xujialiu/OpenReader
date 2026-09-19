/**
 * The one tool every structural assertion in this suite goes through.
 *
 * Half of `src/renderer/` runs inside Safari and the now-playing module is
 * Swift, so several one-line invariants can only be guarded by reading the
 * source text — `test/README.md` says why, and says a mock may not stand in for
 * it. The shape that grew out of that is `expect(code(file)).toContain(marker)`,
 * and it has a defect that has now caught **five** authors, each by accident and
 * each in a different file:
 *
 * **A marker that appears twice in the text makes the assertion vacuous.** The
 * whole-text search still matches the other occurrence after the line it guards
 * is deleted, so the suite stays green over the deletion. The worst one that was
 * actually confirmed: `highlighter.ts` emits both `-webkit-user-select: text
 * !important` and `user-select: text !important`, and deleting the **standard**
 * property — the one between a working highlight and a reader that paints
 * nothing — left all 122 renderer assertions passing.
 *
 * It is a defect in the shape rather than in the five authors, so the shape is
 * replaced. `pin` refuses **both** ways:
 *
 * - **absent** — the line it guards has gone, which is what the assertion was
 *   for in the first place;
 * - **more than once** — the assertion *cannot fail for the right reason*, so it
 *   is not an assertion. This is the one the old shape could not say, and saying
 *   it at the moment the marker is written is the whole point: a future author
 *   who reaches for an ambiguous marker gets a failure naming both lines rather
 *   than a green run over a hole. `plugins/with-ui-scene-lifecycle.ts` throws
 *   rather than warning for the same reason.
 *
 * Both refusals are exercised in `test/structural.test.ts`, because a guard
 * nobody has watched fire is a comment.
 *
 * The caller supplies the text, which is what lets the same tool serve a whole
 * file, one `function` of the WebView program, one `private func` of the Swift
 * and one branch of a `switch` — the scoping each of those needs is different
 * and lives beside the rules that need it.
 */

/** Every start offset of `marker` in `text`, non-overlapping. */
function offsetsOf(text: string, marker: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) found.push(at);
  return found;
}

/** The 1-based line number of an offset, counted in the text that was searched. */
const lineAt = (text: string, offset: number): number => text.slice(0, offset).split('\n').length;

/**
 * `marker` is in `text` exactly once.
 *
 * `where` names what the text is — a file, or a file and the function it was
 * sliced out of — and is only ever read in a failure message, so it is worth
 * spelling it the way the reader would have to grep for it.
 */
export function pin(text: string, marker: string, where: string): void {
  const offsets = offsetsOf(text, marker);
  if (offsets.length === 1) return;

  const quoted = JSON.stringify(marker);
  if (offsets.length === 0) {
    throw new Error(`${where} no longer contains ${quoted}. That line is what this rule guards.`);
  }

  const lines = offsets.map((offset) => lineAt(text, offset));
  throw new Error(
    `${where} contains ${quoted} ${offsets.length} times, at line${lines.length > 1 ? 's' : ''} ${lines.join(', ')} ` +
      `of the text searched. An assertion on it cannot fail: deleting any one occurrence leaves the others matching. ` +
      `Either narrow the marker until one line answers to it, or slice the text down to the function, member or branch that owns it.`,
  );
}

/**
 * `marker` is in `text` exactly `times` times, and the count is the property.
 *
 * Separate from `pin` and deliberately awkward to reach for: a count above one
 * is right when the rule really is "both of these exist" — the two `Highlight`
 * objects, the two `user-select` spellings — and it is what four of the holes
 * this file exists for looked like from the outside. Passing a number says the
 * number was counted rather than tolerated.
 *
 * No caller but `structural.test.ts` today, because every marker the sweep found
 * ambiguous turned out to be narrowable. It exists so that the author of the one
 * that is not has somewhere to go other than back to `toContain`, which is the
 * hole this file closes.
 */
export function pinCount(text: string, marker: string, times: number, where: string): void {
  const offsets = offsetsOf(text, marker);
  if (offsets.length === times) return;
  throw new Error(
    `${where} contains ${JSON.stringify(marker)} ${offsets.length} times, not ${times}` +
      (offsets.length > 0 ? ` (lines ${offsets.map((offset) => lineAt(text, offset)).join(', ')} of the text searched).` : '.'),
  );
}
