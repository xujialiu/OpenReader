import type { Timestamp } from './providers/types';

/**
 * The text of an utterance is not always the text worth speaking. Interface
 * transcripts and UI captures wrap whole labels in brackets — `<Log in>
 * <Register>` — and a voice that reads the brackets aloud is unlistenable.
 *
 * So one utterance has two forms: the document's text, which the highlight is
 * drawn over, and the speech text, which is what a provider is asked for and
 * what its word timings therefore refer to. `prepareSpeechText` makes the
 * second from the first and reports which character positions it dropped;
 * `restoreSpeechOffsets` turns the provider's offsets back into the document's
 * coordinates. Getting that pair wrong is the drift this project exists to
 * avoid, so both work in UTF-16 code units and neither estimates anything.
 *
 * Which brackets go, and why wherever they stand, is `prepareSpeechText`'s
 * own note below (#25).
 */

export const DEFAULT_BRACKET_PAIRS = '<> []';
export type BracketValidation =
  | { ok: true; pairs: [string, string][] }
  | { ok: false; reason: 'empty' | 'entry' | 'duplicate'; entry: string };

export function validateBracketPairs(value: string): BracketValidation {
  const entries = value.trim().split(/\s+/u);
  if (!value.trim()) return { ok: false, reason: 'empty', entry: '' };
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const entry of entries) {
    const chars = Array.from(entry);
    if (chars.length !== 2 || chars[0] === chars[1] || !chars.every((c) => /^[\p{P}\p{S}]$/u.test(c))) {
      return { ok: false, reason: 'entry', entry };
    }
    if (seen.has(entry)) return { ok: false, reason: 'duplicate', entry };
    seen.add(entry);
    pairs.push([chars[0], chars[1]]);
  }
  return { ok: true, pairs };
}

/**
 * The Speech Text of one utterance: every configured pair taken out wherever it
 * encloses text, the words inside kept, and the positions dropped reported so
 * `restoreSpeechOffsets` can turn a provider's offsets back into the document's.
 *
 * **Wherever it encloses text, not only when the whole utterance is brackets**
 * (#25). The rule used to be the second — "anything less certain is left
 * exactly as it was: reading two extra characters aloud is a nuisance, while
 * deleting a word the [document's] author wrote is a lie about the document" —
 * and it was written for a voice that reads a bracket out loud. Fish Audio does the
 * opposite: it takes `[…]` for an instruction to the voice and says none of
 * it, so `He cast [Fireball] at the wolf.` was heard as "He cast at the wolf",
 * and the lie the old rule guarded against was being told by leaving the
 * brackets in (measured, notes/NOTES_2026-09-22.md, 00:08). So the pair goes and the
 * words stay, whatever surrounds them, and every layer of a nested group goes,
 * because Fish would swallow an inner pair just the same.
 *
 * Each closing bracket pairs with the nearest unpaired opening bracket of its
 * own pair, whatever lies between, so groups that cross (`<[Hello>]`) lose both
 * pairs. A bracket without its partner is left as written, and so is any text
 * containing a character the list makes ambiguous: one that opens or closes
 * two pairs, or opens one and closes another.
 *
 * **One exception, for `<>` only: a pair whose two signs both read as math
 * stays.** The same rule as the desktop plugin's (xujialiu/Zotero-TTS#127),
 * chosen by the owner over literal removal, so the same book reads the same way
 * in both. A `<` or `>` reads as a sign when whitespace stands on both sides of
 * it (`x < 5`), an ASCII letter or digit stands on both sides (`p<0.05`), `=`
 * touches it (`<=`, `>=`, `=>`), or `-` stands before a `>` (`->`). A plain
 * `>` takes the nearest plain `<` and falls back to the nearest sign-like one,
 * which cleans `You gained < 100 exp> today.`; a sign-like `>` takes only a
 * sign-like `<`, and that pair stays (`If x < 5 and y > 3, stop.`). #94's
 * single wrapper around a comparison, `<a < b>`, still reads `a < b`.
 */
export function prepareSpeechText(text: string, enabled: boolean, pairs = DEFAULT_BRACKET_PAIRS): { text: string; removed: number[] } {
  const unchanged = { text, removed: [] as number[] };
  if (!enabled) return unchanged;
  const parsed = validateBracketPairs(pairs);
  // An invalid list — restored from a settings backup, or typed and not yet
  // corrected — must never cause guessed deletions.
  if (!parsed.ok) return unchanged;
  /** For each bracket character, the pair it belongs to and which side it is on; null when the list gives it two roles. */
  const roles = new Map<string, { pair: number; opens: boolean } | null>();
  parsed.pairs.forEach(([open, close], pair) => {
    for (const [char, opens] of [[open, true], [close, false]] as const) {
      roles.set(char, roles.has(char) ? null : { pair, opens });
    }
  });
  const angle = parsed.pairs.findIndex(([open, close]) => open === '<' && close === '>');
  type Open = { at: number; width: number };
  const plain = parsed.pairs.map(() => [] as Open[]);
  /** `<` that read as a sign, kept apart so a plain `>` prefers a plain `<` (only the `<>` pair uses it). */
  const signs: Open[] = [];
  const removed: number[] = [];
  const chars = Array.from(text);
  let index = 0;
  for (let c = 0; c < chars.length; c++) {
    const char = chars[c];
    const at = index;
    index += char.length;
    const role = roles.get(char);
    if (role === undefined) continue;
    // Ambiguous text is preserved, as before: guessing which pair a shared
    // character belongs to could delete the wrong one.
    if (role === null) return unchanged;
    const sign = role.pair === angle && readsAsSign(char, chars[c - 1] ?? '', chars[c + 1] ?? '');
    if (role.opens) {
      (sign ? signs : plain[role.pair]).push({ at, width: char.length });
      continue;
    }
    if (sign) {
      // A comparison's two signs pair and stay, so neither is taken by a later
      // plain bracket.
      signs.pop();
      continue;
    }
    const open = plain[role.pair].pop() ?? (role.pair === angle ? signs.pop() : undefined);
    if (!open) continue;
    for (let j = 0; j < open.width; j++) removed.push(open.at + j);
    for (let j = 0; j < char.length; j++) removed.push(at + j);
  }
  if (!removed.length) return unchanged;
  removed.sort((a, b) => a - b);
  const parts: string[] = [];
  let from = 0;
  for (const position of removed) {
    parts.push(text.slice(from, position));
    from = position + 1;
  }
  parts.push(text.slice(from));
  return { text: parts.join(''), removed };
}

const SPACE = /^\s$/u;
const ASCII_ALNUM = /^[A-Za-z0-9]$/;

/** Whether a `<` or `>` reads as a math sign rather than a bracket, by what touches it (xujialiu/Zotero-TTS#127). */
function readsAsSign(char: string, before: string, after: string): boolean {
  if (SPACE.test(before) && SPACE.test(after)) return true;
  if (ASCII_ALNUM.test(before) && ASCII_ALNUM.test(after)) return true;
  if (before === '=' || after === '=') return true;
  return char === '>' && before === '-';
}

/** Cached timestamps belong to the speech text. Return copies in document coordinates. */
export function restoreSpeechOffsets(timestamps: Timestamp[], removed: readonly number[]): Timestamp[] {
  if (!removed.length) return timestamps;
  const originalIndex = (index: number): number => {
    let original = index;
    for (const position of removed) if (position <= original) original++;
    return original;
  };
  const out: Timestamp[] = [];
  // Fresh objects, never a shift applied in place: the timings that came back
  // from the provider are the cache's, they are in speech-text coordinates,
  // and shifting them there would corrupt every later hit on the same clip.
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const start = originalIndex(t.charStart);
    out.push({
      start: t.start,
      end: t.end,
      charStart: start,
      charEnd: t.charEnd > t.charStart ? originalIndex(t.charEnd - 1) + 1 : start,
    });
  }
  return out;
}
