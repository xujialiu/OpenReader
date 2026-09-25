/**
 * The content timeline of the active output source (ADR 0012, #63).
 * Positions are source coordinates carried through native time-stretching and
 * reported when that PCM leaves the output queue. Buffer durations name their
 * coordinates; padding used only to flush the stretcher never adds content time.
 * A seek replaces the source, so its timeline begins at zero too. The graph
 * rejects callbacks from retired sources before they can enter this timeline.
 */

import type { Timestamp } from '../core/providers/types';

/** One buffer on the queue: a portion of a Clip, with the gap on its final piece. */
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
  /** A word-sized queue buffer still belongs to one full Clip. */
  offset?: number;
  duration?: number;
  voiceGeneration?: number;
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
  /** A seek creates a new native source: forget buffers and reset its content origin. */
  reset(): void;
  /** The content offset at which the front Clip's speech begins. Exposed because it is the whole of the arithmetic, and a number nothing can see is a number nothing can test. */
  anchor(): number;
  clips(): readonly QueuedClip[];
  truncateAfter(bufferId: string | null): QueuedClip[];
}

export function createTimeline(): Timeline {
  /**
   * Buffers in the order they were enqueued. Short — the read-ahead window is
   * three Utterances — so a linear walk in `advanceTo` is cheaper than any index.
   */
  let queue: QueuedClip[] = [];

  /** Source coordinate of the first retained buffer. Padding is never counted. */
  let base = 0;

  const extentOf = (clip: QueuedClip): number => clip.speech + clip.gap;

  return {
    enqueued(clip) {
      queue.push(clip);
    },

    advanceTo(position) {
      if (queue.length === 0) return null;

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
      // A cursor cannot invent extra content after the last queued frame.
      offset = Math.min(offset, extent);

      const inGap = offset > clip.speech;
      return { clip, inClip: (clip.offset ?? 0) + (inGap ? clip.speech : offset), inGap, position };
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
      base = 0;
      queue = [];
    },

    anchor() {
      return base;
    },
    clips() { return queue; },
    truncateAfter(bufferId) {
      const index = bufferId === null ? -1 : queue.findIndex((clip) => clip.bufferId === bufferId);
      return queue.splice(index + 1);
    },
  };
}
