/**
 * The content timeline: what the number from `onPositionChanged` means.
 *
 * This is the file ADR 0012 was written for. The source node reports its
 * **content position** — `AudioBufferQueueSourceNode::getCurrentPosition()` is
 * `sampleFrameToTime(vReadIndex_, contextSampleRate) + playedBuffersDuration_`,
 * which is the ADR's "read index plus the duration of the buffers already
 * consumed", read out of the library's own source. That value advances at the
 * playback rate because the read index does, so there is no rate factor to apply
 * and no wall clock to drift against.
 *
 * What it is *not* is clip-relative. It counts every second of content the queue
 * has ever consumed, so turning it into "0.8 seconds into Utterance 41" needs
 * one thing: the content offset at which each Clip's speech begins. This file
 * keeps that, and keeps it by **summing the durations of the buffers it enqueued
 * itself** — frames divided by the sample rate, the identical arithmetic the
 * native side does — rather than by sampling anything.
 *
 * Nothing here imports the platform. The position arrives as a number.
 *
 * ## The one thing the node adds behind our back
 *
 * With `pitchCorrection: true` the host object builds a tail buffer of
 * `(INPUT_LATENCY_MS + OUTPUT_LATENCY_MS) × sampleRate` frames — 30 ms — on the
 * first `enqueueBuffer`, and `QueueBufferProcessor::handleBoundary` appends it
 * **instead of** ending the last buffer whenever the queue would drain. Its
 * duration goes into `playedBuffersDuration_`; we never enqueued it, so our sum
 * does not know about it. `advanceTo` absorbs the difference the only honest way:
 * by measuring it, when a reported position runs past the end of everything we
 * put in the queue. Thirty milliseconds, once per drain, and a drain is already
 * a stall the reader can hear.
 */

import type { Timestamp } from '../core/providers/types';

/** One buffer on the queue, which is one Utterance's Clip followed by its gap. */
export interface QueuedClip {
  /** What `enqueueBuffer` returned. The queue is FIFO, so this is also the order. */
  bufferId: string;
  /** Index into the Utterances the engine was given. */
  utterance: number;
  /** Content seconds of speech, as `frames / sampleRate` of what was actually written. */
  speech: number;
  /** Content seconds of silence after the speech (gap.ts). */
  gap: number;
  /** Word Timings as the Provider reported them: clip-relative, at 1.0×, or null where it reported none. Scaled on the way out (rate.ts), never here. */
  words: Timestamp[] | null;
}

export interface TimelinePosition {
  clip: QueuedClip;
  /** Content seconds since this Clip's speech began, in [0, speech]. Held at `speech` while the position is inside the gap. */
  inClip: number;
  /** Whether the position is past the speech and inside the gap that follows it. */
  inGap: boolean;
  /** The node's own content position, unchanged — the elapsed time ADR 0016 pushes to the lock screen. */
  position: number;
}

export interface Timeline {
  /** Record a buffer just handed to `enqueueBuffer`, in the order it was handed over. */
  enqueued(clip: QueuedClip): void;
  /**
   * Where the node is. Give it the value from `onPositionChanged` and nothing
   * else; `AudioContext.currentTime` is a wall clock and is not scaled by the
   * playback rate (ADR 0012), so it would be wrong here by a factor of 1.5–3.
   *
   * Null while the queue holds nothing — which is silence, not an error.
   */
  advanceTo(position: number): TimelinePosition | null;
  /** The node has finished this buffer (`onBufferEnded`). Drops it and anything before it. An id the queue does not hold is ignored: a seek clears buffers whose events may still be in flight. */
  ended(bufferId: string): void;
  /** The Clip at the front of the queue, or null when the queue is empty. */
  front(): QueuedClip | null;
  /** Buffers enqueued and not yet ended. */
  pending(): number;
  /** Forget every buffer, for a seek — which calls `clearBuffers()` — while keeping the content offset the node will report next. */
  reset(): void;
  /** The content offset at which the front Clip's speech begins. Exposed because it is the whole of the arithmetic, and a number nothing can see is a number nothing can test. */
  anchor(): number;
}

export function createTimeline(): Timeline {
  /**
   * Buffers in the order they were enqueued. Short — the read-ahead window is
   * three Utterances — so a linear walk in `advanceTo` is cheaper than any index.
   */
  let queue: QueuedClip[] = [];

  /**
   * The content offset where `queue[0]`'s speech begins.
   *
   * It survives `reset()`, and that is the subtle part. `clearBuffers()` hands
   * every buffer to the graph manager for destruction **without** adding any of
   * them to `playedBuffersDuration_`, and sets `vReadIndex_` to 0. So after a
   * clear the node's next reported position is exactly the sum of the buffers it
   * had already finished — which is this number, because everything before
   * `queue[0]` has ended and `queue[0]` itself was cleared uncounted.
   */
  let base = 0;

  /**
   * Set by `reset()` and cleared by the next `enqueued()`.
   *
   * Between those two the queue is empty for a reason that is not a drain, and
   * the difference matters: a position event dispatched before `clearBuffers()`
   * and delivered after it reports a point *inside* the buffer that was thrown
   * away, which is past `base`. Absorbing that as tail slack would move the
   * anchor forward by however far into the Clip the seek happened — a seek that
   * silently mis-anchors the highlight by half a sentence.
   */
  let cleared = false;

  const extentOf = (clip: QueuedClip): number => clip.speech + clip.gap;

  return {
    enqueued(clip) {
      cleared = false;
      queue.push(clip);
    },

    advanceTo(position) {
      if (queue.length === 0) {
        // Nothing to report. But unless the queue was cleared, the node may have
        // rendered its latency tail after the last buffer ended, and this is the
        // only moment that difference is visible: positions stop being reported
        // while the queue is empty (`processNode` zeroes and returns before
        // `positionChanged_.advance`), so the last one seen is the end of the
        // tail to within one interval. Taking the maximum makes a stale event
        // harmless.
        if (!cleared && position > base) base = position;
        return null;
      }

      let offset = position - base;
      // Behind the front buffer: a position event dispatched before a boundary
      // and delivered after it. The front Clip has only just started.
      if (offset < 0) offset = 0;

      // Walk past Clips the node has finished. Their own `onBufferEnded` drops
      // them too; whichever arrives first, the arithmetic below is the same, and
      // the last Clip is never dropped here because nothing has replaced it yet.
      while (queue.length > 1 && offset >= extentOf(queue[0]!)) {
        const extent = extentOf(queue.shift()!);
        offset -= extent;
        base += extent;
      }

      const clip = queue[0]!;
      const extent = extentOf(clip);
      if (offset > extent) {
        // Past everything enqueued. The only content the node can have played
        // that we did not give it is the latency tail, so the excess is measured
        // and folded into `base` once, rather than re-counted on every position
        // from here on.
        base += offset - extent;
        offset = extent;
      }

      const inGap = offset > clip.speech;
      return { clip, inClip: inGap ? clip.speech : offset, inGap, position };
    },

    ended(bufferId) {
      const at = queue.findIndex((clip) => clip.bufferId === bufferId);
      if (at === -1) return;
      for (let i = 0; i <= at; i++) base += extentOf(queue[i]!);
      queue = queue.slice(at + 1);
    },

    front() {
      return queue[0] ?? null;
    },

    pending() {
      return queue.length;
    },

    reset() {
      queue = [];
      cleared = true;
    },

    anchor() {
      return base;
    },
  };
}
