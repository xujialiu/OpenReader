import type { Timestamp } from '../core/providers/types';

/** Exact frame cuts for a Clip or a retained portion of one. No speech is inferred. */
export function bufferParts(length: number, hz: number, words: readonly Timestamp[] | null, from = 0, to = length / hz) {
  const first = Math.max(0, Math.min(length, Math.round(from * hz)));
  const last = Math.max(first, Math.min(length, Math.round(to * hz)));
  const cuts = [...new Set((words ?? []).map((word) => Math.round(word.end * hz)))]
    .filter((frame) => Number.isFinite(frame) && frame > first && frame < last).sort((a, b) => a - b);
  cuts.push(last);
  let start = first;
  return cuts.map((end) => {
    const part = { start, end, final: end === last };
    start = end;
    return part;
  });
}
