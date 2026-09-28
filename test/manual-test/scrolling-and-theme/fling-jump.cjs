#!/usr/bin/env node
// A fast scroll that jumps the page by whole chapters and shows it empty (#58):
// fling the open reader with real XCTest flicks, and read on every animation
// frame where the text at the top of the viewport is in the document and how
// much of the viewport displayed sections cover.
//
//   node test/manual-test/scrolling-and-theme/fling-jump.cjs SIMULATOR_UDID METRO_LOG [down|up] [RUNS]
//   node test/manual-test/scrolling-and-theme/fling-jump.cjs --read LOG.json
//
// `down` flicks later text into view, as a finger swiping up does; `up` goes
// back. Each run waits for epub.js's queue to empty, displays section START
// (environment; 20 for down, 60 for up) — FROM_END=PX then puts the top of the
// viewport PX above that section's end — installs the probe, makes FLINGS
// (default 10) real flicks at VELOCITY (default 4000) pt/s, GAP (default 0.1)
// seconds apart, through fling-jump.sh, waits until the page has rested for a
// second and the queue is empty, and reads the probe's log, which the WebView
// posts to a server this script runs on 127.0.0.1. The harness's own `js`
// answer is cut at 500 characters (README Pitfalls), far too little for a log.
//
// A frame is BLANK when displayed sections cover less than half the viewport,
// and a JUMP when the text at the viewport's top moved half a viewport further
// than the page's own speed over the five frames before could carry it, and
// either epub.js scrolled the page in the 150 ms before or the text moved a
// quarter of a viewport more or less than the scroll position did; or when the
// top landed in no section either frame held. A fling reaches the WebView in
// sparse steps, and a step of the text that is the scroll's own step is the
// page moving, not a jump: 17 to 20 ms after an append, two runs on "Cultivation
// Online" read 639 px in one frame, text and scroll alike, while the recording
// was smooth (README Pitfalls). A run is RED on any blank or
// jump frame; GREEN only when the viewport's top crossed a section boundary and
// epub.js changed something above the viewport at least once (a section erased
// above, or a prepended one grown), while the page moved or at rest; otherwise
// INCONCLUSIVE. Each red episode is printed with the epub.js scroll it followed.
// `--read` gives the verdict on a log a run saved, without a simulator.
//
// Needs a reader open on a long real book (README, Real books), the dark theme
// is not needed, and METRO_LOG, the file this worktree's Metro writes to,
// because the harness answers there. OUT_DIR (default
// $TMPDIR/openreader-fling-jump) keeps the XCTest project and each run's log;
// VIDEO=1 also records each run's screen there, for white-flash.py. Never plays.
// Exit 0 when every run is GREEN, 1 when any is RED, 3 when none is RED but
// some were INCONCLUSIVE, 2 on a usage or harness failure.
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const reading = process.argv[2] === '--read' ? process.argv[3] : null;
const [device, metroLog, direction = 'down', runsArg = '1'] = reading ? ['-', '-', 'down', '1'] : process.argv.slice(2);
const runs = Number(runsArg);
if (!device || !metroLog || !['down', 'up'].includes(direction) || !(runs > 0)) {
  console.error('Usage: fling-jump.cjs SIMULATOR_UDID METRO_LOG [down|up] [RUNS]');
  process.exit(2);
}
const start = Number(process.env.START ?? (direction === 'up' ? 60 : 20));
const fromEnd = process.env.FROM_END ? Number(process.env.FROM_END) : null;
const out = process.env.OUT_DIR ?? path.join(os.tmpdir(), 'openreader-fling-jump');
if (!reading) fs.mkdirSync(out, { recursive: true });

const harnessFile = reading ? null : path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents', 'harness.json');
// Every command needs a new seq (README Pitfalls), so carry on from the file's.
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
// A `js` answer arrives as the reader's note in its HX status line, JSON-escaped
// and cut at 500 characters: parse the quoted string after note= (README Pitfalls).
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf(' note="');
  if (!line.includes('HX playing=') || at < 0) return [];
  try { return [JSON.parse(line.slice(at + 6)).replace(/^The highlight could not be drawn: PROBE /, '')]; } catch { return []; }
});
async function ask(code, test = () => true, ms = 5000) {
  const offset = logSize();
  send({ do: 'js', code });
  const end = Date.now() + ms;
  for (;;) {
    const found = answers(logSince(offset)).find(test);
    if (found !== undefined) return found;
    if (Date.now() >= end) return null;
    await sleep(100);
  }
}
async function until(code, want, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await ask(code, (text) => text === want || text === 'busy')) === want) return true;
    await sleep(250);
  }
  return false;
}

// Runs in the reader's WebView, once per reader. Samples every animation frame
// and wraps the manager methods that change what lies above the viewport, and
// the scroll epub.js answers each change with. Installed after the program, so
// it wraps whatever the program made of those methods.
const probe = (port) => `
  if (window.__flingJump) { window.__flingJump.port = ${port}; return 'probe installed'; }
  var m = rendition.manager, c = m.container;
  var P = window.__flingJump = { buf: [], on: false, raf: 0, sig: '', scrolled: 0, port: ${port} };
  function now() { return Math.round(performance.now() * 10) / 10; }
  function push(e) { if (P.on) P.buf.push(e); }
  function views() {
    var box = c.getBoundingClientRect();
    return m.views.all().map(function (v) {
      var r = v.element.getBoundingClientRect();
      var shown = v.iframe ? (v.iframe.style.visibility === 'hidden' ? 0 : 1) : -1;
      return [v.section.index, Math.round(r.top - box.top), Math.round(r.height), v.displayed ? 1 : 0, shown];
    });
  }
  function sample() {
    var vs = views(), height = c.clientHeight, top = null, covered = 0;
    for (var k = 0; k < vs.length; k++) {
      var v = vs[k];
      if (v[1] <= 0 && v[1] + v[2] > 0) top = [v[0], -v[1], v[2]];
      if (v[3] === 1 && v[4] === 1) {
        var a = Math.max(0, v[1]), b = Math.min(height, v[1] + v[2]);
        if (b > a) covered += b - a;
      }
    }
    var sig = JSON.stringify(vs.map(function (v) { return [v[0], v[2], v[3], v[4]]; }));
    var e = ['f', now(), Math.round(c.scrollTop), top, Math.round(covered / height * 1000) / 1000, c.scrollHeight];
    if (sig !== P.sig) { P.sig = sig; e.push(vs); }
    push(e);
  }
  function loop() { if (!P.on) return; sample(); P.raf = requestAnimationFrame(loop); }
  c.addEventListener('scroll', function () { P.scrolled = performance.now(); push(['s', now(), Math.round(c.scrollTop)]); }, { passive: true });
  function wrap(obj, name, describe) {
    var original = obj[name];
    obj[name] = function () {
      var before = Math.round(c.scrollTop);
      var result = original.apply(this, arguments);
      try { push([name, now(), before, Math.round(c.scrollTop)].concat(describe ? describe.apply(null, arguments) : [])); } catch (error) {}
      return result;
    };
  }
  wrap(m, 'scrollBy', function (x, y, silent) { return [Math.round(y), silent ? 1 : 0]; });
  wrap(m, 'scrollTo', function (x, y, silent) { return [Math.round(y), silent ? 1 : 0]; });
  wrap(m, 'counter', function (bounds) { return [Math.round(bounds.heightDelta)]; });
  wrap(m, 'erase', function (view, above) { return [view.section.index, above ? 1 : 0, Math.round(view.bounds().height)]; });
  wrap(m, 'prepend', function (section) { return [section.index]; });
  wrap(m, 'append', function (section) { return [section.index]; });
  wrap(m, 'trim');
  function fingers(doc) {
    ['touchstart', 'touchend', 'touchcancel'].forEach(function (type) {
      doc.addEventListener(type, function (e) { push(['touch', now(), Math.round(c.scrollTop), type, e.touches.length]); }, { passive: true });
    });
  }
  fingers(document);
  m.views.all().forEach(function (v) { if (v.contents) fingers(v.contents.document); });
  rendition.hooks.content.register(function (contents) { fingers(contents.document); });
  P.idle = function () { var q = m.q; return !q._q.length && !q.running; };
  P.quiet = function (ms) { return performance.now() - P.scrolled >= ms && P.idle(); };
  P.start = function () {
    P.buf = []; P.sig = ''; P.on = true;
    push(['start', now(), Math.round(c.scrollTop), c.clientHeight]);
    P.raf = requestAnimationFrame(loop);
    return 'started';
  };
  P.stop = function () {
    push(['stop', now(), Math.round(c.scrollTop)]);
    P.on = false; cancelAnimationFrame(P.raf);
    fetch('http://127.0.0.1:' + P.port + '/log', { method: 'POST', body: JSON.stringify(P.buf) });
    return 'stopped';
  };
  return 'probe installed';`;

/** The verdict on one run's log; see the header for what each word means. */
function verdict(log) {
  const height = log.find((e) => e[0] === 'start')[3];
  const frames = [];
  let views = null;
  for (const e of log) {
    if (e[0] !== 'f') continue;
    if (e.length > 6) views = e[6];
    frames.push({ t: e[1], st: e[2], top: e[3], cov: e[4], views });
  }
  // How far down `views`' laid-out text a section and an offset within it is.
  const depth = (vs, [index, offset]) => {
    let y = 0;
    for (const v of vs) {
      if (v[0] === index) return y + offset;
      y += v[2];
    }
    return null;
  };
  // How far the text moved from one frame to the next, measured in the first
  // frame's own sections: where the second frame's top sat in the first. A top
  // in a section appended since is measured in the second frame's sections.
  const moved = (a, b) => {
    if (!a.top || !b.top) return null;
    for (const vs of [a.views, b.views]) {
      if (!vs) continue;
      const from = depth(vs, a.top), to = depth(vs, b.top);
      if (from !== null && to !== null) return to - from;
    }
    return null;
  };
  const scrolls = log.filter((e) => ['scrollTo', 'scrollBy'].includes(e[0]));
  const bad = [];
  const speeds = [];
  for (let k = 1; k < frames.length; k += 1) {
    const a = frames[k - 1], b = frames[k];
    const d = moved(a, b);
    const dt = Math.max(b.t - a.t, 1);
    const fastest = Math.max(0, ...speeds.slice(-5));
    const scripted = scrolls.some((e) => b.t - 150 <= e[1] && e[1] <= b.t);
    const unlike = d !== null && Math.abs(d - (b.st - a.st)) > height / 4;
    const jump = (d === null && a.top !== null && b.top !== null) ||
      (d !== null && Math.abs(d) - dt * fastest > height / 2 && (scripted || unlike));
    if (d !== null && !jump) speeds.push(Math.abs(d) / dt);
    const blank = b.cov < 0.5;
    if (blank || jump) bad.push({ t: b.t, kind: blank ? 'BLANK' : 'JUMP' });
  }
  const episodes = [];
  for (const one of bad) {
    const last = episodes.at(-1);
    if (last && one.t - last.at(-1).t < 300) last.push(one);
    else episodes.push([one]);
  }
  const lines = episodes.map((episode) => {
    const t0 = episode[0].t, t1 = episode.at(-1).t;
    const before = frames.findLast((f) => f.t < t0 && f.top);
    const after = frames.find((f) => f.t > t1 + 50 && f.top && f.cov >= 0.5);
    const cause = log.filter((e) => ['scrollTo', 'scrollBy', 'erase', 'counter', 'prepend', 'append', 'trim'].includes(e[0]) && t0 - 400 <= e[1] && e[1] <= t0).slice(-3);
    const kinds = [...new Set(episode.map((one) => one.kind))].sort().join(' ');
    return `  ${kinds} ${Math.round(t0)}..${Math.round(t1)} ms (${episode.length} frames): top ${JSON.stringify(before?.top?.slice(0, 2) ?? null)} -> ${JSON.stringify(after?.top?.slice(0, 2) ?? null)}; after ${cause.map((e) => e[0] + JSON.stringify(e.slice(4))).join(' ') || 'nothing of epub.js'}`;
  });
  const events = log.filter((e) => e[1] !== undefined && e[0] === 's');
  const movingAt = (t) => new Set(events.filter((e) => t - 100 <= e[1] && e[1] < t).map((e) => e[2])).size >= 2;
  const changes = log.filter((e) => (e[0] === 'erase' && e[5] === 1) || (e[0] === 'counter' && e[4] !== 0));
  const crossed = new Set(frames.filter((f) => f.top).map((f) => f.top[0])).size >= 2;
  const reached = frames.filter((f) => f.top).map((f) => f.top[0]);
  const summary = `frames ${frames.length}, sections ${reached.length ? Math.min(...reached) + '..' + Math.max(...reached) : 'none'}, ` +
    `blank frames ${bad.filter((one) => one.kind === 'BLANK').length}, jumps ${bad.filter((one) => one.kind === 'JUMP').length}, ` +
    `changes above the viewport ${changes.length} (${changes.filter((e) => movingAt(e[1])).length} while it moved)`;
  const word = bad.length ? 'RED' : crossed && changes.length ? 'GREEN' : 'INCONCLUSIVE';
  return { word, summary, lines };
}

function report({ word, summary, lines }) {
  console.log(`  ${summary}`);
  for (const line of lines) console.log(line);
  return word;
}

if (reading) {
  const word = verdict(JSON.parse(fs.readFileSync(reading, 'utf8').trim().split('\n').at(-1)));
  console.log(word.word);
  report(word);
  process.exit(word.word === 'RED' ? 1 : word.word === 'GREEN' ? 0 : 3);
}

(async () => {
  let resolveLog = null;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
      response.end();
      if (request.method === 'POST' && resolveLog) resolveLog(Buffer.concat(chunks).toString('utf8'));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  if ((await ask(probe(port), (text) => text === 'probe installed')) === null) throw new Error('The WebView probe was not installed (is a reader open?)');
  const idle = "return window.__flingJump.idle() ? 'idle' : 'busy';";
  const counts = { RED: 0, GREEN: 0, INCONCLUSIVE: 0 };
  for (let run = 1; run <= runs; run += 1) {
    if (!(await until(idle, 'idle', 10000))) throw new Error("epub.js's queue did not empty before the reset (README Pitfalls: a stuck queue)");
    await ask(`rendition.display(${start}); return 'displaying';`, (text) => text === 'displaying');
    await sleep(1000);
    if (!(await until(idle, 'idle', 10000))) throw new Error("epub.js's queue did not empty after the reset");
    if (fromEnd !== null) {
      await ask(`var v = rendition.manager.views.all().filter(function (v) { return v.section.index === ${start}; })[0]; rendition.manager.container.scrollTop = v.element.offsetTop + v.element.offsetHeight - ${fromEnd}; return 'placed';`, (text) => text === 'placed');
      await sleep(1000);
      await until(idle, 'idle', 10000);
    }
    await sleep(1000);
    await ask('return window.__flingJump.start();', (text) => text === 'started');
    let recorder = null;
    const video = path.join(out, `run-${Date.now()}-${direction}.mp4`);
    if (process.env.VIDEO) {
      recorder = spawn('xcrun', ['simctl', 'io', device, 'recordVideo', '--codec', 'h264', '--force', video], { stdio: 'ignore' });
      await sleep(1200);
    }
    const flicks = spawnSync('bash', [path.join(path.dirname(process.argv[1]), 'fling-jump.sh'), device, out], {
      env: { ...process.env, DIRECTION: direction },
      encoding: 'utf8',
    });
    // Stop only once the page has rested for a second and epub.js's queue is
    // idle: ten flicks can coast for longer than the probe's own settling, and
    // work parked until the page rests (#58) has to have had its chance.
    await until("return window.__flingJump.quiet(1000) ? 'quiet' : 'busy';", 'quiet', 15000);
    if (recorder) { recorder.kill('SIGINT'); await new Promise((resolve) => recorder.on('exit', resolve)); }
    const received = new Promise((resolve) => { resolveLog = resolve; });
    await ask('return window.__flingJump.stop();', (text) => text === 'stopped');
    const body = await Promise.race([received, sleep(10000).then(() => null)]);
    if (flicks.status !== 0) {
      console.log(`run ${run}: XCTest failed, log not read`);
      console.log(flicks.stdout + flicks.stderr);
      process.exitCode = 2;
      continue;
    }
    if (body === null) throw new Error('The WebView never posted its log (is 127.0.0.1 reachable from the simulator?)');
    const file = path.join(out, `run-${Date.now()}-${direction}.json`);
    fs.writeFileSync(file, body);
    const found = verdict(JSON.parse(body));
    counts[found.word] += 1;
    console.log(`run ${run} ${direction} from section ${start}${fromEnd !== null ? ` (${fromEnd} px before its end)` : ''}: ${found.word}`);
    report(found);
    console.log(`  log: ${file}${recorder ? `\n  video: ${video}` : ''}`);
  }
  server.close();
  console.log(`${counts.RED} red, ${counts.GREEN} green, ${counts.INCONCLUSIVE} inconclusive of ${runs}`);
  if (process.exitCode !== 2) process.exitCode = counts.RED ? 1 : counts.INCONCLUSIVE ? 3 : 0;
})().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
