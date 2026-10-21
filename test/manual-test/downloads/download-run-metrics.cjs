#!/usr/bin/env node
// Per-run metrics for one timed download of chapters nav.102+nav.103:
// enqueue->first clip, enqueue->last clip, first->last, count, bytes, save-gap
// median/p90/max, and the boundary gap (last clip of Chapter 101 -> first clip
// of Chapter 102), attributed through the sampler's JSONL (writing on the
// change, current on the baseline).
//
//   node download-run-metrics.cjs ENQUEUE_ISO CLIP_DIR SAMPLES.jsonl [CHAPTER_A=nav.102] [CHAPTER_B=nav.103]
const { readdirSync, statSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const [enqueueIso, clipDir, samplesPath, a = 'nav.102', b = 'nav.103'] = process.argv.slice(2);
if (!enqueueIso || !clipDir || !samplesPath) {
  console.error('Usage: download-run-metrics.cjs ENQUEUE_ISO CLIP_DIR SAMPLES.jsonl [CHAPTER_A] [CHAPTER_B]');
  process.exit(2);
}
const ms = (iso) => Date.parse(iso);
const enqueue = ms(enqueueIso);

const clips = readdirSync(clipDir)
  .filter((f) => f.endsWith('.audio') || f.endsWith('.m4a'))
  .map((f) => ({ f, born: statSync(join(clipDir, f)).birthtimeMs, bytes: statSync(join(clipDir, f)).size }))
  .sort((x, y) => x.born - y.born);
if (clips.length === 0) { console.error('no clips in', clipDir); process.exit(1); }

const samples = readSamples(samplesPath).filter((s) => s.t && !s.error);
function readSamples(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
}

/** The sample at or before each clip's birth: which chapters were in the window then. */
const windowAt = (t) => {
  let last = null;
  for (const s of samples) { if (s.t <= t) last = s; else break; }
  return last;
};
const chaptersAt = (t) => {
  const s = windowAt(t);
  if (!s) return null;
  if (Array.isArray(s.writing)) return s.writing;
  if (s.current) return [s.current];
  return null;
};
const inWindow = (t, id) => (chaptersAt(t) ?? []).includes(id);
const lastA = [...clips].reverse().find((c) => inWindow(c.born, a));
const firstB = clips.find((c) => inWindow(c.born, b));
// A clip saved while both chapters are in the window belongs to the boundary.
const overlapped = clips.filter((c) => { const w = chaptersAt(c.born); return w && w.includes(a) && w.includes(b); });

const gaps = [];
for (let i = 1; i < clips.length; i++) gaps.push((clips[i].born - clips[i - 1].born) / 1000);
const sorted = [...gaps].sort((x, y) => x - y);
const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const first = clips[0], last = clips[clips.length - 1];
const bytes = clips.reduce((n, c) => n + c.bytes, 0);
const row = {
  enqueue: enqueueIso,
  firstClipS: +( (first.born - enqueue) / 1000 ).toFixed(2),
  lastClipS: +( (last.born - enqueue) / 1000 ).toFixed(2),
  firstToLastS: +( (last.born - first.born) / 1000 ).toFixed(2),
  clips: clips.length,
  bytes,
  gapMedianS: +at(0.5).toFixed(3),
  gapP90S: +at(0.9).toFixed(3),
  gapMaxS: +Math.max(...gaps).toFixed(3),
  gapsOver3s: gaps.filter((g) => g > 3).map((g) => +g.toFixed(2)),
  lastOfA: lastA ? { f: lastA.f, afterEnqueueS: +((lastA.born - enqueue) / 1000).toFixed(2) } : null,
  firstOfB: firstB ? { f: firstB.f, afterEnqueueS: +((firstB.born - enqueue) / 1000).toFixed(2) } : null,
  boundaryGapS: lastA && firstB ? +((firstB.born - lastA.born) / 1000).toFixed(2) : null,
  overlappedClips: overlapped.length,
};
// Samples naming both chapters at once: the overlap, directly.
const both = samples.filter((s) => Array.isArray(s.writing) && s.writing.includes(a) && s.writing.includes(b));
row.overlapSamples = both.length;
if (both.length) row.overlapMs = [both[0].t - enqueue, both[both.length - 1].t - enqueue];
console.log(JSON.stringify(row, null, 1));
