#!/usr/bin/env node
// The #71 review fixes, measured frame by frame in the reader's WebView:
//
//   node test/manual-test/place-and-following/follow-fixes.cjs SIMULATOR_UDID METRO_LOG pause SECONDS
//   node test/manual-test/place-and-following/follow-fixes.cjs SIMULATOR_UDID METRO_LOG recue
//   node test/manual-test/place-and-following/follow-fixes.cjs SIMULATOR_UDID METRO_LOG paragraph SECONDS
//
// Needs a reader open and paused, a Voice with Word Timings, and the simulator
// silenced (`silence.sh set`). It chooses nothing in Settings: run it with the
// Scrolling the case needs (pause and paragraph are Continuous's; recue is
// either).
//
// It installs a recorder of its own (`window.__followFixesV2`): every drawn
// frame's `scrollTop`, every message the highlighter is sent (with a speak's
// Utterance and its `reveal` / `recover`), and every A/M the program posts to
// the app (`openreader:following`), all on one clock.
//
// pause      plays SECONDS, pauses, and keeps recording 1.5 s: GREEN when no
//            frame after the pause's `hold` moved the page. (Before the fix the
//            drift eased on for up to a second.)
// recue      plays until a sentence has begun, puts the page in M where it is
//            (the program's own 'browse' message: Browsing, nothing moved), then
//            changes the speed, which cues the same Utterance again with
//            `recover`, and keeps playing until the next Utterance begins.
//            GREEN when the re-cue left the page in M and unmoved. It also
//            prints what the next new sentence did: back to A with a move when
//            its first line was on the screen, as the rule says.
// paragraph  plays SECONDS and lists every run of moving frames: the glides a
//            paragraph break or a heading takes stand out as ~250 ms runs on
//            every frame, where the drift steps a pixel every few frames.
//
// Play only for the SECONDS the case needs; it pauses at once afterwards, also
// after a failure, and puts the speed back to what it was for recue.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, mode, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg || 0);
if (!device || !metroLog || !['pause', 'recue', 'paragraph'].includes(mode) || (mode !== 'recue' && !(seconds > 0 && seconds <= 40))) {
  console.error('Usage: follow-fixes.cjs SIMULATOR_UDID METRO_LOG pause|paragraph SECONDS (<=40) | recue');
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
// One harness command per poll window (README Pitfalls): 600 ms between them.
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
const volume = () => execFileSync('bash', [require.resolve('../kit/silence.sh'), 'check', device]).toString();

const arm = `
  var R = window.__followFixesV2;
  if (!R) {
    R = window.__followFixesV2 = { t0: performance.now(), frames: [], msgs: [], posts: [], on: false };
    // The program's entry and the bridge's post as they were before any run, so
    // that arming again re-wraps them with this run's code, not a wrapper.
    R.entry = window.__openReaderHighlighter;
    var bridge = window.ReactNativeWebView;
    R.post = bridge && bridge.postMessage ? bridge.postMessage.bind(bridge) : null;
    var m = rendition.manager;
    var sample = function () {
      if (R.on) R.frames.push([Math.round((performance.now() - R.t0) * 10) / 10, m.container.scrollTop]);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  window.__openReaderHighlighter = function (m) {
    if (R.on && m) R.msgs.push([Math.round(performance.now() - R.t0), m.kind, m.kind === 'speak' ? m.utterance + (m.reveal ? ' reveal' : '') + (m.recover ? ' recover' : '') + (m.utteranceRanges && m.utteranceRanges[0] ? ' block ' + m.utteranceRanges[0].block : '') : m.kind === 'hold' ? (m.stop ? 'stop' : '') : m.kind === 'following' ? m.scrolling + ' ' + m.linePosition : '']);
    return R.entry(m);
  };
  if (R.post) window.ReactNativeWebView.postMessage = function (text) {
    try { var p = JSON.parse(text); if (R.on && p && p.type === 'openreader:following') R.posts.push([Math.round(performance.now() - R.t0), p.following ? 'A' : 'M']); } catch (e) {}
    return R.post(text);
  };
  R.start = function () { R.t0 = performance.now(); R.frames = []; R.msgs = []; R.posts = []; R.on = true; };
  return 'armed';
`;

// Runs of frames that moved, split by three still frames.
const analyse = `
  var R = window.__followFixesV2; R.on = false;
  var F = R.frames, runs = [], run = null, still = 0;
  for (var i = 1; i < F.length; i++) {
    var d = F[i][1] - F[i - 1][1];
    if (d) {
      if (!run) run = { at: F[i - 1][0], steps: [] };
      run.steps.push(d); run.end = F[i][0]; still = 0;
    } else if (run && ++still >= 3) { runs.push(run); run = null; still = 0; }
  }
  if (run) runs.push(run);
  return JSON.stringify({ n: F.length, msgs: R.msgs, posts: R.posts, runs: runs.map(function (r) {
    var sum = 0; r.steps.forEach(function (s) { sum += s; });
    return [Math.round(r.at), Math.round(r.end - r.at), sum, r.steps.length, r.steps.slice(0, 16).join(',')];
  }) });
`;

(async () => {
  if (!/sim_volume=0\b/.test(volume())) { console.error('the simulator is not silent: run silence.sh set first'); process.exit(1); }
  if ((await ask(arm)) !== 'armed') { console.error('could not install the recorder'); process.exit(1); }
  await sleep(600);
  await ask('window.__followFixesV2.start(); return "started";');
  await sleep(600);
  let rateBack = null;
  try {
    send({ do: 'play' });
    if (mode === 'recue') {
      // Until a second sentence has just begun, so that the page goes to M, and
      // the speed changes, early in a sentence rather than at its end.
      const speaks = 'return String(window.__followFixesV2.msgs.filter(function (m) { return m[1] === "speak"; }).length);';
      const end = Date.now() + 30000;
      for (;;) {
        await sleep(300);
        const n = await ask(speaks, 3000);
        if (Number(n) >= 2) break;
        if (Date.now() > end) throw new Error('no second sentence began within 30 s');
      }
      await ask('window.__openReaderHighlighter({ kind: "browse" }); window.__followFixesV2.browsedAt = Math.round(performance.now() - window.__followFixesV2.t0); return "browsed";');
      await sleep(600);
      send({ do: 'settings', patch: { rate: 1.1 } });
      rateBack = 1;
      await sleep(600);
      await ask('window.__followFixesV2.ratedAt = Math.round(performance.now() - window.__followFixesV2.t0); return "rated";');
      // Until a sentence other than the one the page went to M in begins, and a
      // moment after it.
      const newer = 'var R = window.__followFixesV2; var s = R.msgs.filter(function (m) { return m[1] === "speak"; }); var at = s.filter(function (m) { return m[0] < R.browsedAt; }).pop(); var u = at ? String(at[2]).split(" ")[0] : null; return String(s.some(function (m) { return m[0] > R.browsedAt && String(m[2]).split(" ")[0] !== u; }));';
      const end2 = Date.now() + 25000;
      for (;;) {
        await sleep(300);
        if ((await ask(newer, 3000)) === 'true') break;
        if (Date.now() > end2) break;
      }
      await sleep(1200);
    } else {
      await sleep(seconds * 1000);
    }
  } finally {
    send({ do: 'pause' });
    await sleep(mode === 'pause' ? 1500 : 700);
    if (rateBack !== null) { send({ do: 'settings', patch: { rate: rateBack } }); await sleep(600); }
  }
  const extra = mode === 'recue' ? 'var R = window.__followFixesV2; var marks = { browsedAt: R.browsedAt, ratedAt: R.ratedAt };' : 'var marks = {};';
  const raw = await ask(extra + analyse.replace('return JSON.stringify({', 'return JSON.stringify({ marks: marks,'), 8000);
  if (!raw) { console.error('no analysis came back'); process.exit(1); }
  const out = JSON.parse(raw);
  console.log(`frames ${out.n}`);
  for (const m of out.msgs) console.log('  msg ' + m.join(' '));
  for (const p of out.posts) console.log('  post ' + p.join(' '));
  for (const r of out.runs) console.log(`  run at ${r[0]} for ${r[1]} ms: ${r[2]} px in ${r[3]} steps [${r[4]}]`);
  if (mode === 'pause') {
    const hold = out.msgs.find((m) => m[1] === 'hold');
    if (!hold) { console.log('RED: no hold arrived'); return; }
    const after = out.runs.filter((r) => r[0] + r[1] > hold[0]);
    console.log(`hold at ${hold[0]} (${hold[2] || 'no stop'}); runs ending after it: ${after.length}`);
    console.log(after.length === 0 ? 'GREEN' : 'RED');
  } else if (mode === 'recue') {
    const { browsedAt, ratedAt } = out.marks;
    const speaks = out.msgs.filter((m) => m[1] === 'speak');
    const utterance = (m) => String(m[2]).split(' ')[0];
    const current = speaks.filter((m) => m[0] < browsedAt).pop();
    const recue = current && speaks.find((m) => m[0] > browsedAt && utterance(m) === utterance(current));
    const next = current && speaks.find((m) => m[0] > browsedAt && utterance(m) !== utterance(current));
    const until = next ? next[0] : Infinity;
    const movedBetween = out.runs.filter((r) => r[0] >= browsedAt && r[0] < until);
    const aBetween = out.posts.filter((p) => p[0] > browsedAt && p[0] < until && p[1] === 'A');
    console.log(`M at ${browsedAt} in ${current ? current.join(' ') : 'nothing'}; speed sent by ${ratedAt}; re-cue ${recue ? recue.join(' ') : 'none'}; next sentence ${next ? next.join(' ') : 'none'}`);
    console.log(`from M to the next sentence (${next ? next[0] - browsedAt : 'open'} ms, ${recue && next ? next[0] - recue[0] : '?'} ms of them after the re-cue): ${movedBetween.length} runs, ${aBetween.length} A posts`);
    if (next) {
      const afterNext = out.posts.filter((p) => p[0] >= next[0]);
      const movedAfter = out.runs.filter((r) => r[0] >= next[0] && r[0] < next[0] + 400);
      console.log(`at the next sentence: posts ${afterNext.map((p) => p.join(' ')).join(', ') || 'none'}; runs within 400 ms ${movedAfter.map((r) => r[2] + ' px/' + r[1] + ' ms').join(', ') || 'none'}`);
    }
    console.log(recue && movedBetween.length === 0 && aBetween.length === 0 ? 'GREEN' : 'RED');
  }
})().catch(async (error) => {
  send({ do: 'pause' });
  console.error(String(error));
  process.exit(1);
});
