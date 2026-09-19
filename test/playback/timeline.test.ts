import { describe, expect, it } from 'vitest';

import { createTimeline, type QueuedClip } from '../../src/playback/timeline';

/**
 * ADR 0012's whole argument, in arithmetic.
 *
 * The source node reports its content position — read index plus the duration of
 * the buffers already consumed — and this turns that one growing number into "so
 * far into Utterance 41". It does so by summing the durations of the buffers it
 * enqueued itself, the identical arithmetic the native side does, and never by
 * sampling a wall clock.
 *
 * The author abandoned a competitor over highlight drift. Every case below is a
 * way the mapping could be off by a fraction of a sentence.
 */

let nextId = 0;
const clip = (utterance: number, speech: number, gap = 0): QueuedClip => ({
  bufferId: String(nextId++),
  utterance,
  speech,
  gap,
  words: null,
});

describe('createTimeline', () => {
  it('starts at zero and reports nothing while the queue is empty', () => {
    const timeline = createTimeline();
    expect(timeline.anchor()).toBe(0);
    expect(timeline.front()).toBeNull();
    expect(timeline.pending()).toBe(0);
    // An empty queue renders silence; it is not an error (notes/NOTES.md footgun 3).
    expect(timeline.advanceTo(0)).toBeNull();
  });

  it('maps a position inside the first Clip to an offset inside it', () => {
    const timeline = createTimeline();
    const a = clip(0, 1);
    timeline.enqueued(a);
    const at = timeline.advanceTo(0.4)!;
    expect(at.clip).toBe(a);
    expect(at.inClip).toBeCloseTo(0.4, 12);
    expect(at.inGap).toBe(false);
    // The node's own number goes through untouched: it is what ADR 0016 pushes
    // to the lock screen.
    expect(at.position).toBe(0.4);
  });

  it('holds the offset at the end of the speech while the position is inside the gap', () => {
    const timeline = createTimeline();
    timeline.enqueued(clip(0, 1, 0.2));
    const at = timeline.advanceTo(1.1)!;
    expect(at.inGap).toBe(true);
    // The last word stays highlighted rather than the cursor running off the end
    // of the sentence during the pause.
    expect(at.inClip).toBe(1);
  });

  it('crosses into the next Clip at the end of the previous one’s gap', () => {
    const timeline = createTimeline();
    timeline.enqueued(clip(0, 1, 0.2));
    const b = clip(1, 2);
    timeline.enqueued(b);
    const at = timeline.advanceTo(1.3)!;
    expect(at.clip).toBe(b);
    expect(at.inClip).toBeCloseTo(0.1, 12);
    // The anchor has moved with it: Utterance 1 begins 1.2 s into the content.
    expect(timeline.anchor()).toBeCloseTo(1.2, 12);
  });

  it('keeps the mapping exact across many Clips, which is where drift would show', () => {
    const timeline = createTimeline();
    for (let i = 0; i < 200; i++) timeline.enqueued(clip(i, 3, 0.2));
    // 0.8 s into Utterance 150, which begins at 150 * 3.2.
    const at = timeline.advanceTo(150 * 3.2 + 0.8)!;
    expect(at.clip.utterance).toBe(150);
    expect(at.inClip).toBeCloseTo(0.8, 9);
  });

  it('drops a Clip the node says it has finished, and everything before it', () => {
    const timeline = createTimeline();
    const a = clip(0, 1);
    const b = clip(1, 2);
    const c = clip(2, 3);
    timeline.enqueued(a);
    timeline.enqueued(b);
    timeline.enqueued(c);
    timeline.ended(b.bufferId);
    expect(timeline.front()).toBe(c);
    expect(timeline.pending()).toBe(1);
    expect(timeline.anchor()).toBeCloseTo(3, 12);
  });

  it('ignores an onBufferEnded for a buffer it no longer holds', () => {
    // A seek calls clearBuffers(), and events for the buffers it threw away may
    // still be in flight. Counting one twice would move the anchor past the
    // Utterance being read.
    const timeline = createTimeline();
    const a = clip(0, 1);
    timeline.enqueued(a);
    timeline.ended(a.bufferId);
    expect(timeline.anchor()).toBeCloseTo(1, 12);
    timeline.ended(a.bufferId);
    timeline.ended('nothing like an id');
    expect(timeline.anchor()).toBeCloseTo(1, 12);
  });

  it('does not count a Clip twice when the position passed it before its event arrived', () => {
    const timeline = createTimeline();
    const a = clip(0, 1);
    const b = clip(1, 2);
    timeline.enqueued(a);
    timeline.enqueued(b);
    // The position stream got there first.
    expect(timeline.advanceTo(1.5)!.clip).toBe(b);
    expect(timeline.anchor()).toBeCloseTo(1, 12);
    // And now the boundary event, late.
    timeline.ended(a.bufferId);
    expect(timeline.anchor()).toBeCloseTo(1, 12);
    expect(timeline.advanceTo(1.5)!.inClip).toBeCloseTo(0.5, 12);
  });

  it('reads a position behind the front buffer as the start of it', () => {
    // A position event dispatched before a boundary and delivered after it.
    const timeline = createTimeline();
    const a = clip(0, 1);
    timeline.enqueued(a);
    timeline.ended(a.bufferId);
    const b = clip(1, 2);
    timeline.enqueued(b);
    const at = timeline.advanceTo(0.9)!;
    expect(at.clip).toBe(b);
    expect(at.inClip).toBe(0);
  });

  it('absorbs the latency tail the node appends when the queue drains', () => {
    // With pitchCorrection the host object builds a 30 ms tail buffer on the
    // first enqueue, and QueueBufferProcessor::handleBoundary appends it instead
    // of ending the last buffer whenever the queue would drain. Its duration
    // goes into playedBuffersDuration_ and we never enqueued it, so without this
    // the anchor would be 30 ms behind for the rest of the session — and 60 ms
    // after the next drain, and so on.
    const timeline = createTimeline();
    const a = clip(0, 1);
    timeline.enqueued(a);
    timeline.advanceTo(1.03);
    timeline.ended(a.bufferId);
    const b = clip(1, 2);
    timeline.enqueued(b);
    const at = timeline.advanceTo(1.06)!;
    expect(at.clip).toBe(b);
    expect(at.inClip).toBeCloseTo(0.03, 9);
  });

  it('absorbs it after the last buffer has ended too, and only once', () => {
    const timeline = createTimeline();
    const a = clip(0, 1);
    timeline.enqueued(a);
    timeline.ended(a.bufferId);
    expect(timeline.anchor()).toBeCloseTo(1, 12);
    // The tail plays on with an empty queue.
    expect(timeline.advanceTo(1.03)).toBeNull();
    expect(timeline.anchor()).toBeCloseTo(1.03, 9);
    // A stale event reporting an earlier position must not move it back.
    expect(timeline.advanceTo(1.01)).toBeNull();
    expect(timeline.anchor()).toBeCloseTo(1.03, 9);
  });

  it('keeps the anchor across a seek, because a cleared buffer was never counted', () => {
    // clearBuffers() destroys every buffer without adding any of them to
    // playedBuffersDuration_ and sets vReadIndex_ to 0, so the node's next
    // position is exactly where the cleared buffer began.
    const timeline = createTimeline();
    const a = clip(0, 1);
    const b = clip(1, 2);
    timeline.enqueued(a);
    timeline.enqueued(b);
    timeline.ended(a.bufferId);
    expect(timeline.anchor()).toBeCloseTo(1, 12);
    timeline.reset();
    expect(timeline.front()).toBeNull();
    expect(timeline.anchor()).toBeCloseTo(1, 12);
    const c = clip(41, 3);
    timeline.enqueued(c);
    const at = timeline.advanceTo(1.25)!;
    expect(at.clip).toBe(c);
    expect(at.inClip).toBeCloseTo(0.25, 12);
  });

  it('does not mistake a stale position for a latency tail after a seek', () => {
    // This is the case the `cleared` flag exists for. A position event dispatched
    // before clearBuffers() reports a point inside the buffer that was thrown
    // away — past the anchor — and absorbing it would move the anchor forward by
    // however far into the Utterance the seek happened, which mis-anchors the
    // highlight by half a sentence with nothing to show it.
    const timeline = createTimeline();
    timeline.enqueued(clip(0, 4));
    timeline.advanceTo(2);
    timeline.reset();
    expect(timeline.advanceTo(2.5)).toBeNull();
    expect(timeline.anchor()).toBe(0);
    const next = clip(80, 1);
    timeline.enqueued(next);
    expect(timeline.advanceTo(0.2)!.inClip).toBeCloseTo(0.2, 12);
  });

  it('counts a silent Clip like any other, because the reading passes over it', () => {
    // Text that is not Speakable becomes silence (CONTEXT.md) and is still an
    // Utterance the highlight visits.
    const timeline = createTimeline();
    const scene = clip(7, 0.3);
    const after = clip(8, 1);
    timeline.enqueued(scene);
    timeline.enqueued(after);
    expect(timeline.advanceTo(0.15)!.clip).toBe(scene);
    expect(timeline.advanceTo(0.35)!.clip).toBe(after);
  });
});
