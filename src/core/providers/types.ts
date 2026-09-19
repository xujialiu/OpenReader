/**
 * The one piece of the provider contract the rest of `core/` needs today.
 *
 * The provider layer itself comes across from the Zotero-TTS plugin as a copy
 * (ADR 0013) and brings the rest of this file with it — the providers, their
 * options, the voice types, and a synthesis result that is PCM plus a sample
 * rate rather than a blob. Until then this holds only what `align.ts` and
 * `speech-text.ts` refer to, so that neither has to invent its own copy of it.
 */

/**
 * One Word Timing: where a spoken word falls inside a clip. `start` and `end`
 * are seconds from the start of the clip; `charStart` and `charEnd` are UTF-16
 * code-unit offsets into the utterance's text.
 *
 * The name is the plugin's and stays, because the aligner and the ~3,200 lines
 * of provider tests that arrive with ADR 0013 spell it this way and the point
 * of copying is that they arrive unchanged. CONTEXT.md's word for what it
 * holds is a **Word Timing**; prefer that in prose.
 *
 * A provider either reports these or it does not. They are never estimated or
 * interpolated: a clip without them is highlighted at utterance level
 * (ADR 0005, philosophy rule 1).
 */
export type Timestamp = {
  start: number;
  end: number;
  charStart: number;
  charEnd: number;
};
