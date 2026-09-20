import { describe, expect, it } from 'vitest';
import { bufferParts } from '../../src/playback/buffer-parts';
import { createTimeline, type QueuedClip } from '../../src/playback/timeline';

describe('queue pieces retain one Clip clock', () => {
  it('covers every sample once, keeps the trailing silence, and ignores unusable cuts', () => {
    const words = [-1, 0.3, 0.3, NaN, 0.6, 2].map(end => ({ start: 0, end, charStart: 0, charEnd: 1 }));
    expect(bufferParts(1000, 1000, words)).toEqual([
      { start: 0, end: 300, final: false }, { start: 300, end: 600, final: false }, { start: 600, end: 1000, final: true },
    ]);
    expect(bufferParts(1000, 1000, words, 0.3, 0.6)).toEqual([{ start: 300, end: 600, final: true }]);
    expect(bufferParts(1000, 1000, null)).toEqual([{ start: 0, end: 1000, final: true }]);
  });

  it('maps a new voice offset without replaying the already spoken words or counting discarded audio', () => {
    const timeline = createTimeline();
    const part = (id: string, offset: number, speech: number, voiceGeneration = 0): QueuedClip =>
      ({ bufferId: id, utterance: 7, offset, speech, duration: 5, gap: 0, words: null, voiceGeneration });
    timeline.enqueued(part('old-1', 0, 0.3));
    timeline.enqueued(part('old-2', 0.3, 0.3));
    timeline.enqueued(part('old-3', 0.6, 0.3));
    expect(timeline.truncateAfter('old-2').map(c => c.bufferId)).toEqual(['old-3']);
    timeline.enqueued(part('new-1', 1.4, 0.5, 1));
    timeline.ended('old-1'); timeline.ended('old-2');
    expect(timeline.anchor()).toBeCloseTo(0.6);
    expect(timeline.advanceTo(0.8)?.inClip).toBeCloseTo(1.6);
    expect(timeline.advanceTo(0.8)?.clip.voiceGeneration).toBe(1);
    timeline.ended('old-3'); // A late event from a removed buffer cannot move the clock.
    expect(timeline.anchor()).toBeCloseTo(0.6);
  });

  it('can disarm a queued replacement and restore the old tail without moving its prefix', () => {
    const timeline = createTimeline();
    const old: QueuedClip = { bufferId: 'old', utterance: 0, speech: 1, gap: 0, words: null };
    const tail: QueuedClip = { ...old, bufferId: 'tail', offset: 1, speech: 2 };
    timeline.enqueued(old); timeline.enqueued(tail);
    const removed = timeline.truncateAfter('old');
    timeline.enqueued({ ...tail, bufferId: 'replacement', voiceGeneration: 1 });
    expect(timeline.truncateAfter('old')[0]?.bufferId).toBe('replacement');
    timeline.enqueued({ ...removed[0]!, bufferId: 'restored' });
    expect(timeline.advanceTo(0.7)?.inClip).toBeCloseTo(0.7);
    timeline.ended('old');
    expect(timeline.advanceTo(1.5)?.inClip).toBeCloseTo(1.5);
  });
});
