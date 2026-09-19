/**
 * **Speakable**: text containing at least one letter or digit (CONTEXT.md).
 *
 * The word matters more than it looks. Text that is not Speakable is never
 * sent to a Provider — it becomes silence — and the tempting names for the
 * same predicate all say something false: a scene break written `* * *` is
 * valid text, it is not empty, and it is not meaningless to a reader. What it
 * has no of is anything a voice can pronounce. The plugin measured the price
 * of asking anyway: `* * *` cost 60 s and a 502 from Speechify (2026-09-09,
 * the note on `isSpeakable` in its Speechify provider). This is that same
 * predicate, deliberately character for character, so that the two products
 * agree about which utterances are silent.
 *
 * `\p{N}` rather than `\p{Nd}`: a fraction, a superscript or a circled digit
 * is a number a voice reads. Both escapes hold on Hermes 250829098.0.17
 * (notes/NOTES_2026-09-19.md), so the rule needs no language and works for
 * Han, Devanagari and Hebrew exactly as it does for Latin.
 */
export function isSpeakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
