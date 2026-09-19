/**
 * The gap timer (ADR 0006), which in an audio graph is not a timer at all.
 *
 * Zotero's engine waits a number of milliseconds between Utterances with a
 * `setTimeout`, and adds a longer wait where a paragraph begins. The plugin
 * shadowed that arithmetic for issue #44 and recorded the defect it was fixing:
 * neither of Zotero's two numbers follows the playback speed, so "at 2× a
 * sentence halves and the gap does not" — the reading speeds up and the pauses
 * stay put, which is audible as hesitancy.
 *
 * Here the gap is **silence appended to the Utterance's own buffer**, and that
 * one choice answers three things at once:
 *
 * - it goes through the same pitch-preserving time-stretch as the speech, so a
 *   gap set at 1.0× shrinks with the rate exactly as the plugin's `computeGap`
 *   had to do by dividing;
 * - it costs no timer, so nothing races the audio thread and nothing has to be
 *   cancelled on a seek;
 * - it is part of the content timeline, so the position the highlight follows
 *   keeps advancing across the pause instead of stalling and jumping.
 *
 * Nothing in this file touches the platform: it is frames and seconds.
 */

import type { Utterance } from '../core/segmenter';

export interface GapSettings {
  /** Silence after every Utterance, in milliseconds at 1.0×. */
  sentenceMs: number;
  /** Extra silence where the next Utterance begins a new Block, in milliseconds at 1.0×. */
  paragraphMs: number;
}

/**
 * Zotero's own numbers, which are the ones a reader is used to: no sentence
 * delay (`sentenceDelay` is 0 for every voice the plugin publishes, and absent
 * on almost all of Zotero's) and 200 ms at a paragraph (`DELAY_PARAGRAPH`).
 * They are a default rather than a constant because the plugin already made
 * both a setting.
 */
export const DEFAULT_GAP: GapSettings = { sentenceMs: 0, paragraphMs: 200 };

/**
 * How long an Utterance that a Provider was never asked to speak lasts.
 *
 * Text that is not Speakable never goes to a Provider — it becomes silence
 * (CONTEXT.md) — but it is still an Utterance the reading passes over, and
 * ADR 0005 says it is highlighted whole while it does. A scene break written
 * `* * *` therefore gets a beat.
 *
 * This is a beat, **not an estimate of how long the text would take to speak**.
 * Philosophy rule 1 forbids estimating a timing, and reading `* * *` aloud is
 * not a thing anyone wants timed: the plugin measured what asking for it costs
 * instead — 60 seconds and a 502 from Speechify — which is why it is silence in
 * the first place.
 */
export const UNSPEAKABLE_MS = 300;

/**
 * Whether the Utterance after `current` begins a new Block — a paragraph, a
 * heading, a list item (CONTEXT.md).
 *
 * Read off the spans rather than asked of the caller, because an Utterance
 * already carries where its characters came from and a second source of the same
 * fact is a second thing to get wrong. The comparison is against `current`'s
 * **last** span and `next`'s **first**: an Utterance the repair layer rejoined
 * across a Block boundary spans more than one Block (see `segmenter/rejoin.ts`),
 * and what matters is whether the reading crosses into a Block it has not been
 * in yet.
 *
 * The end of the document counts as a paragraph boundary: the last Utterance is
 * followed by nothing, and a trailing beat is better than stopping mid-breath.
 */
export function startsNewBlock(current: Utterance, next: Utterance | undefined): boolean {
  const from = current.spans[current.spans.length - 1];
  if (!next) return true;
  const into = next.spans[0];
  if (!from || !into) return false;
  return into.block !== from.block;
}

/** The gap after an Utterance, in **content** seconds — the unit a buffer of silence is measured in, before the time-stretch divides it by the rate. */
export function gapContentSeconds(settings: GapSettings, paragraphAhead: boolean): number {
  const sentence = Math.max(0, finite(settings.sentenceMs));
  const paragraph = paragraphAhead ? Math.max(0, finite(settings.paragraphMs)) : 0;
  return (sentence + paragraph) / 1000;
}

/**
 * Seconds of silence as a whole number of frames.
 *
 * Rounded, and the rounding matters: this is the number of frames actually
 * written into the buffer, so the content duration the timeline records has to
 * be derived from it — `frames / sampleRate` — and not from the seconds that
 * were asked for. A duration the timeline believes and the node does not is
 * drift by another name.
 */
export function framesFor(seconds: number, sampleRate: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * sampleRate);
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
