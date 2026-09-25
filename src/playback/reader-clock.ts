/**
 * The seam between the clock and everything that follows it.
 *
 * Two messages, and deliberately no third. ADR 0005 measured why: `postMessage`
 * into a WebView is implemented as a script injection and an `eval` per message,
 * so at three to five words a second one message per word is the wrong mechanism.
 * The design that works is to push the whole Word Timing array **once** when a
 * Clip starts, let `requestAnimationFrame` inside the WebView interpolate against
 * it, and send **one position correction about once a second** for drift.
 *
 * So this interface is not a general event bus with these two as its first
 * subscribers. It is the mechanism, stated small enough that adding a per-word
 * message would mean visibly changing it.
 *
 * Both messages carry the same clock, which is the patched source node's output content
 * position (ADR 0012). That is also what ADR 0016 pushes to the lock screen, so
 * the highlight and the elapsed time cannot disagree — there is one clock and
 * two readers of it, not two clocks.
 *
 * Nothing in this file, or anywhere in `playback/`, imports from `renderer/`.
 * The renderer does not exist yet, and when it does the dependency points this
 * way: it implements `ReaderClock` and hands it to the engine.
 */

import type { Timestamp } from '../core/providers/types';

/**
 * A Clip has started. Sent once, at the moment it does.
 *
 * At that moment the Clip's offset is zero, which is why this carries no
 * position: it is sent from the source node's `onBufferEnded`, which fires at the
 * buffer boundary itself rather than on the once-a-second position stream. A cue
 * derived from that stream would be up to a second late, and a second of
 * highlight on the wrong sentence is the defect this whole module is built
 * against.
 *
 * Everything in it is already in the units the receiver works in, because the
 * conversion is this directory's job and doing it on the far side of a bridge is
 * how the two halves start to disagree.
 */
export interface ClipCue {
  /** Which Utterance this Clip speaks: an index into the Utterances the engine was given, which is how the renderer finds the text to highlight. */
  utterance: number;
  /**
   * The whole Word Timing array, **already scaled for the playback rate** —
   * `start` and `end` in heard seconds from the start of the Clip's speech,
   * `charStart` and `charEnd` still UTF-16 offsets into the Utterance's text.
   *
   * `null` means the Provider reported no Word Timings, so the Utterance is
   * highlighted whole (ADR 0005's Highlight Level). It is never a partial array
   * and never an estimate: a timing is reported or it is not (philosophy rule 1).
   *
   * **These are not guaranteed to fit inside `duration`, and a receiver must not
   * assume they do.** Measured against real speech from two Providers
   * (notes/NOTES_2026-09-19.md, 23:24): Kokoro-FastAPI's first word can start
   * **before zero** — −0.0068 s — and its last word ends **0.109 to 0.156 s past
   * the end of the audio it sent**, because the server times a trailing full stop
   * that makes no sound and the aligner folds that into the last real word. Fish
   * Audio was the other way on the same sentences, ending 0.19 to 0.28 s early,
   * and it leaves real silences of up to 0.48 s *between* two timings at a comma.
   *
   * Nothing on this side rewrites them: a Provider's number is the measurement
   * and clamping it here would be the estimate ADR 0005 forbids. So the receiver
   * holds the interpolation inside `[0, duration]` itself, and treats a gap
   * between two timings as "the previous word stays lit" rather than as an error.
   * The discrepancy is bounded and per Clip — one sixth of a second at the end of
   * a sentence, divided by the rate — and is not drift: the next `ClipCue`
   * arrives at the buffer boundary and re-anchors everything.
   */
  words: Timestamp[] | null;
  /** How long the Clip's speech lasts as it will be heard, in seconds. The gap that follows it is not included: the highlight belongs on the words, not on the pause. */
  duration: number;
  /** The playback rate `words` and `duration` were scaled by. Present so a receiver can say what it is showing, and so a stale cue is recognisable after the rate changes. */
  rate: number;
}

/**
 * Where the reading is. Sent about once a second — the cadence ADR 0005 chose,
 * and the one `notes/NOTES.md` records as the reference for the lock screen.
 *
 * The first one after a `ClipCue` can therefore be up to a second away, and that
 * is fine: the cue was sent at the boundary, where the offset was zero, so the
 * receiver is interpolating from a known point rather than from a guess. Where a
 * correction *does* arrive with a cue is when the engine noticed the Clip change
 * from this stream instead — the boundary event having been missed — and there
 * the position is the only thing that says how far in it already is.
 */
export interface PositionCorrection {
  /** The Utterance whose Clip is playing. A correction for an Utterance the receiver is not showing means it missed a cue. */
  utterance: number;
  /** Heard seconds since this Clip's speech began, with the output latency of `rate.ts`'s `atTheEar` already taken off. This is what the highlight is corrected against. */
  clipPosition: number;
  /** The source node's content position, exactly as it reported it: source seconds corresponding to PCM rendered at the output, excluding flush padding. The elapsed time ADR 0016 pushes to the lock screen. */
  contentPosition: number;
  /** True while the position is inside the gap after the speech (gap.ts). The last word stays highlighted; nothing advances. */
  inGap: boolean;
}

/** What the renderer's bridge (ADR 0005) and the lock screen (ADR 0016) implement. Two methods, one clock. */
export interface ReaderClock {
  onClip(cue: ClipCue): void;
  onPosition(correction: PositionCorrection): void;
}

/**
 * How often the source node is asked to report its position, in milliseconds.
 *
 * One second, which is the correction cadence itself: `onPositionChangedInterval`
 * throttles in the native `PositionChangedDispatcher`, counting rendered frames,
 * so setting it here means there is no throttle in JavaScript to get wrong and
 * no event crossing the bridge that is then thrown away.
 *
 * A Clip starting is not detected from this stream — it would be up to a second
 * late. `onBufferEnded` fires at the boundary itself and is what sends the cue.
 */
export const POSITION_INTERVAL_MS = 1000;
