import { LANGUAGE_NAMES } from './language-names';

/**
 * The **Language Hint** (CONTEXT.md) for a Fish Audio request, or the empty
 * string: `[Speak in American English] ` in front of a Speech Text of one to
 * three words, named from the voice's own locale (#23).
 *
 * Fish decides which language to speak from the text it is given, and a short
 * stat gives it too little to go on: `100 exp` read by an English voice came
 * out as something like "cn xp". The desktop plugin fixed that on 2026-09-13
 * (xujialiu/Zotero-TTS#98) and the owner heard the difference: both stats wrong
 * without the hint, both right with it. This is the plugin's rule, kept to the
 * letter where the owner asked for it to be — one to three words, numbers
 * counting and punctuation not, none at exactly four, the name the plugin
 * would give — and its function signature, at the plugin's path.
 *
 * **What could not come across is how it counts.** The plugin asks
 * `Intl.Segmenter`, which Hermes does not have (notes/NOTES_2026-09-19.md); a
 * straight port would return the empty string on every call on the device
 * while passing every test under Node, which is the one shape of failure worse
 * than a crash. So `countWords` below counts by hand, and a test holds it to
 * Node's `Intl.Segmenter` for text written with spaces. Where it differs is on
 * purpose: see its own note.
 *
 * Fish does not speak the hint. The objection that kept it out of the first
 * port was that it might, and would then push every word timing late; measured
 * since, the hinted clips are no longer than the plain ones beyond run-to-run
 * variation, the first word still starts at 0.00 s, and neither the reply's
 * text nor its timings contain a word of the hint (notes/NOTES_2026-09-21.md,
 * 23:45).
 */
export function fishLanguageHint(text: string, locale?: string): string {
  if (typeof locale !== 'string' || !locale) return '';
  const name = LANGUAGE_NAMES[locale];
  if (!name) return '';
  const words = countWords(text, HINT_WORDS);
  if (words === 0 || words >= HINT_WORDS) return '';
  return `[Speak in ${name}]${/^\s/u.test(text) ? '' : ' '}`;
}

/** Fewer words than this get a hint. The plugin's number: shown to matter on #98's two stats, never validated beyond them. */
export const HINT_WORDS = 4;

/** Scripts written without spaces, counted one letter per word: the owner's choice for Chinese, Japanese and Korean (#23). */
const PER_LETTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const DIGIT = /\p{Nd}/u;
const WORD = /[\p{L}\p{M}\p{N}_\u203F\u2040\u2054\uFE33\uFE34\uFE4D-\uFE4F\uFF3F]/u;
/** UAX #29's MidLetter, MidNumLet and Single_Quote: what keeps `don't`, `e.g`, `a:b` and `hello·world` one word. */
const BETWEEN_LETTERS = new Set([':', '\u00B7', '\u0387', '\u05F4', '\u2027', '\uFE13', '\uFE55', '\uFF1A', '.', '\u2018', '\u2019', '\u2024', '\uFE52', '\uFF07', '\uFF0E', "'"]);
/** UAX #29's MidNum, MidNumLet and Single_Quote: what keeps `3.14`, `1,000` and `1'000` one number. */
const BETWEEN_DIGITS = new Set([',', ';', '\u037E', '\u0589', '\u060C', '\u060D', '\u066C', '\u07F8', '\u2044', '\uFE10', '\uFE14', '\uFE50', '\uFE54', '\uFF0C', '\uFF1B', '.', '\u2018', '\u2019', '\u2024', '\uFE52', '\uFF07', '\uFF0E', "'"]);

const isLetter = (ch: string | undefined): boolean => !!ch && LETTER.test(ch) && !PER_LETTER.test(ch);

/**
 * How many words a text has, counting no further than `limit`.
 *
 * For text written with spaces this is UAX #29's count, the one
 * `Intl.Segmenter` gives the plugin: a run of letters, digits and marks is one
 * word, and so is a run joined inside by an apostrophe, a full stop or a colon
 * between two letters (`don't`, `e.g`, `a:b`) or by a full stop, comma or
 * apostrophe between two digits (`3.14`, `1,000`); letters and digits side by
 * side are one word (`v1.2`), a hyphen or a slash separates (`e-mail`, `2/50`),
 * and punctuation and symbols are no word at all.
 *
 * Where it is not that count is deliberate. `Intl.Segmenter` finds words in
 * Chinese, Japanese, Thai and the rest by dictionary, and there is no
 * dictionary here, so each of their letters counts as a word — the owner's
 * choice for #23. It is the conservative side of the plugin's count: `第一章`
 * is three here and one to the plugin, so both hint it, while `第十一章` is
 * four here and gets no hint. A Thai sentence therefore counts its letters
 * rather than being taken for one long word, which would have hinted it.
 */
export function countWords(text: string, limit = Number.POSITIVE_INFINITY): number {
  const chars = Array.from(text);
  let words = 0;
  let inWord = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (PER_LETTER.test(ch)) {
      inWord = false;
      if (LETTER.test(ch) && ++words >= limit) return words;
      continue;
    }
    if (WORD.test(ch)) {
      // A mark or a modifier letter after a per-letter script belongs to that
      // letter, not to a word of its own.
      if (!inWord && (MARK.test(ch) || /\p{Lm}/u.test(ch)) && i > 0 && PER_LETTER.test(chars[i - 1])) continue;
      if (!inWord) {
        inWord = true;
        if (++words >= limit) return words;
      }
      continue;
    }
    if (inWord) {
      const before = chars[i - 1];
      const after = chars[i + 1];
      if (isLetter(before) || (before !== undefined && MARK.test(before))) {
        if (isLetter(after) && BETWEEN_LETTERS.has(ch)) continue;
      }
      if (DIGIT.test(before ?? '') && DIGIT.test(after ?? '') && BETWEEN_DIGITS.has(ch)) continue;
    }
    inWord = false;
  }
  return words;
}
