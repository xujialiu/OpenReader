#!/usr/bin/env node
// #71 batch 4 (ADR 0050, "Continuous"): per-frame scrollTop while the page
// drifts continuously, analysed for the shape of the drift rather than for
// discrete line-change episodes (`line-follow.cjs`'s own `analyse` groups
// frames into episodes ended by three still frames, which in Continuous is
// almost never true mid-sentence: the drift itself would be read as one
// giant episode). This script installs its own recorder, independent of
// `line-follow.cjs`'s and `glide-touch.cjs`'s own (`window.__continuousFollow`,
// the same convention), and reports:
//
//   - step sizes: the whole-pixel `scrollTop` deltas between drawn frames
//     while the drift is moving (ADR 0050 batch 4: "one 1 px scroll every
//     100-200ms").
//   - intervals: the gap in ms between one such stepping frame and the next.
//   - glides: a run of frames covering at least GLIDE_PX in under
//     GLIDE_MAX_MS, the paragraph/heading case (ADR: "the same quarter
//     second" as By line) or a jump.
//   - rests: a stretch of at least REST_FRAMES consecutive frames with no
//     movement at all, i.e. the pause between sentences.
//
//   node test/manual-test/continuous-follow.cjs SIMULATOR_UDID METRO_LOG SECONDS [RATE]
//
// Needs a reader open and paused, Continuous already chosen (General, or a
// prior `settings` patch — this script does not choose it, so a run made
// against By line is a run against By line, and its own `other` step sizes
// would look nothing like a drift's), a Voice with Word Timings, and the
// simulator silenced. Sends `play`, waits SECONDS, sends `pause`, sets RATE
// back to 1 afterward only if it changed it. Exit 0 always; this is a
// measurement, not a GREEN/RED gate (`line-follow.cjs`'s own GREEN condition
// does not apply to a drift).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, secondsArg, rateArg] = process.argv.slice(2);
const seconds = Number(secondsArg);
const rate = rateArg ? Number(rateArg) : null;
if (!device || !metroLog || !(seconds > 0 && seconds <= 60)) {
  console.error('Usage: continuous-follow.cjs SIMULATOR_UDID METRO_LOG SECONDS (<=60) [RATE]');
  process.exit(2);
}

const documents = path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents');
const harnessFile = path.join(documents, 'harness.json');
let seq = (() => { try { return Number(JSON.parse(fs.readFileSync(harnessFile, 'utf8')).seq) || 0; } catch { return 0; } })();
const send = (command) => { seq += 1; fs.writeFileSync(harnessFile, JSON.stringify({ seq, ...command })); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logSize = () => fs.statSync(metroLog).size;
const logSince = (offset) => {
  const fd = fs.openSync(metroLog, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const bytes = Buffer.alloc(Math.max(0, size - offset));
    fs.readSync(fd, bytes, 0, bytes.length, offset);
    return bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
};
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf('HX note attention=');
  if (at < 0) return [];
  try {
    const said = JSON.parse(line.slice(line.indexOf('"', at)));
    return said.includes('PROBE ') ? [said.slice(said.indexOf('PROBE ') + 6)] : [];
  } catch { return []; }
});
async function ask(code, ms = 6000) {
  const offset = logSize();
  send({ do: 'js', code });
  await sleep(700);
  const end = Date.now() + ms;
  for (;;) {
    send({ do: 'say' });
    await sleep(400);
    const found = answers(logSince(offset)).at(-1);
    if (found !== undefined) return found;
    if (Date.now() >= end) return null;
  }
}
async function pause() { send({ do: 'pause' }); await sleep(700); }

const arm = `
  var C = window.__continuousFollow;
  if (!C) {
    C = window.__continuousFollow = { t0: performance.now(), frames: [], on: false };
    var m = rendition.manager;
    var sample = function () {
      if (C.on) C.frames.push([performance.now() - C.t0, m.container.scrollTop]);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  C.start = function () { C.t0 = performance.now(); C.frames = []; C.on = true; };
  C.stop = function () { C.on = false; };
  return 'armed';
`;

// Runs in the WebView: turns the raw scrollTop series into the summary
// described at the top of this file, small enough for the note channel.
const analyse = `
  var C = window.__continuousFollow; C.stop();
  var F = C.frames;
  var steps = [], intervals = [], rests = [];
  var lastStepAt = null, still = 0, restStart = null;
  var REST_FRAMES = 12;
  // A glide (By line's own quarter second, or Continuous's paragraph/heading
  // case, ADR 0050) moves on every consecutive drawn frame for its whole
  // ~200-250 ms, the way the measured steps \`[2,3,2,2,2,2,1,2,1,1,1,1]\` do.
  // The drift instead steps once roughly every 100 ms (median, measured
  // here) with several still frames between each step. So a glide is found
  // by consecutive FRAME INDEX, not by a time gap: bridging even a 150 ms
  // gap once merged several sentences' worth of drift into one false
  // multi-second "glide" (measured 2026-09-26, an earlier version of this
  // script: 70 px over 3408 ms, rate 0.02 px/ms — nothing like a 250 ms/
  // 20 px glide's ~0.08-0.1 px/ms).
  var GLIDE_MIN_FRAMES = 8, GLIDE_MIN_PX = 10;
  var runFrames = 0, runPx = 0, runStartAt = null;
  var glides = [];
  function closeRun(endAt) {
    if (runFrames >= GLIDE_MIN_FRAMES && Math.abs(runPx) >= GLIDE_MIN_PX) {
      var ms = endAt - runStartAt;
      glides.push({ at: Math.round(runStartAt), px: Math.round(runPx * 10) / 10, ms: Math.round(ms), frames: runFrames, rate: Math.round((Math.abs(runPx) / ms) * 1000) / 1000 });
    }
    runFrames = 0; runPx = 0; runStartAt = null;
  }
  for (var i = 1; i < F.length; i++) {
    var d = F[i][1] - F[i - 1][1];
    if (Math.abs(d) < 0.01) {
      still++;
      if (still === REST_FRAMES) restStart = F[i - REST_FRAMES + 1][0];
      closeRun(F[i - 1][0]);
      continue;
    }
    if (restStart !== null) { rests.push({ at: Math.round(restStart), ms: Math.round(F[i - 1][0] - restStart) }); restStart = null; }
    still = 0;
    if (runStartAt === null) runStartAt = F[i - 1][0];
    runFrames++; runPx += d;
    if (lastStepAt !== null) intervals.push(Math.round(F[i][0] - lastStepAt));
    lastStepAt = F[i][0];
    steps.push(Math.round(d * 10) / 10);
  }
  if (restStart !== null) rests.push({ at: Math.round(restStart), ms: Math.round(F[F.length - 1][0] - restStart) });
  closeRun(F[F.length - 1][0]);
  // A drift step is a small one; separate the (rare) larger single-frame
  // corrections so they do not skew the 1 px story the steps are meant to
  // show. This still counts a glide's own small per-frame steps among the
  // "drift" ones (a glide's steps are usually 2-4 px too); \`glides\` above is
  // what actually tells a glide's few consecutive-frame runs apart from the
  // drift's sparser, single-frame ones.
  var drift = steps.filter(function (s) { return Math.abs(s) <= 4; });
  var big = steps.filter(function (s) { return Math.abs(s) > 4; });
  function stats(xs) {
    if (!xs.length) return null;
    var sorted = xs.slice().sort(function (a, b) { return a - b; });
    return { n: xs.length, min: sorted[0], max: sorted[sorted.length - 1], median: sorted[Math.floor(sorted.length / 2)] };
  }
  return JSON.stringify({
    n: F.length, span: Math.round(F[F.length - 1][0] - F[0][0]),
    driftSteps: stats(drift), driftStepsAbs: stats(drift.map(Math.abs)),
    intervals: stats(intervals), bigSteps: big, glides: glides, rests: rests,
  });
`;

(async () => {
  const armed = await ask(arm);
  if (armed !== 'armed') { console.error('The recorder did not install: ' + armed); process.exit(2); }
  try {
    execFileSync('bash', [require.resolve('./silence.sh'), 'check', device], { stdio: 'inherit' });
  } catch { process.exit(2); }
  let changedRate = false;
  if (rate !== null) { send({ do: 'settings', patch: { rate } }); await sleep(500); changedRate = true; }
  await ask('window.__continuousFollow.start(); return "started";');
  send({ do: 'play' });
  await sleep(seconds * 1000);
  await pause();
  const result = await ask(analyse, 8000);
  if (changedRate) { send({ do: 'settings', patch: { rate: 1 } }); await sleep(300); }
  if (result === null) { console.error('No answer to the analysis.'); process.exit(2); }
  const out = JSON.parse(result);
  console.log(`CONTINUOUS ${seconds}s at ${rate ?? 1}x: ${out.n} frames over ${out.span} ms`);
  console.log('  drift steps (<=4px): ' + JSON.stringify(out.driftSteps));
  console.log('  drift |steps|: ' + JSON.stringify(out.driftStepsAbs));
  console.log('  intervals (ms between stepping frames): ' + JSON.stringify(out.intervals));
  console.log('  bigger single-frame steps (>4px): ' + JSON.stringify(out.bigSteps));
  console.log('  glides (paragraph/heading/jump, >=15px within 320ms of each other): ' + JSON.stringify(out.glides));
  console.log('  rests (>=12 still frames, ~200ms): ' + JSON.stringify(out.rests));
  process.exit(0);
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 2; });
