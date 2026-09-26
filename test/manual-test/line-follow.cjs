#!/usr/bin/env node
// Play for a few seconds and report, frame by frame, how the page followed the
// line being spoken (#71, ADR 0050).
//
//   node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG SECONDS [--tap]
//   node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG --skips N
//   node test/manual-test/line-follow.cjs SIMULATOR_UDID METRO_LOG --whole
//
// Needs a reader open and paused, a Voice with Word Timings chosen, the
// simulator silenced (`silence.sh set`), and METRO_LOG, the file this worktree's
// Metro writes its output to, because the harness answers there.
//
// It installs a recorder in the reader's WebView that reads, on every animation
// frame, the scroll container's `scrollTop` and the first line box of the word
// highlight (its top in the section document, which scrolling does not change,
// and its middle in the viewport), plus the number of views epub.js holds. It
// also records every message the highlighter is sent, so the player's inset —
// and with it the line position's target — is known: it collapses and expands
// the player once, before playing, to have the bridge send it again. Then it
// checks the silence, sends `play`, waits SECONDS, sends `pause` at once
// (including after a failure), and analyses the frames inside the WebView,
// because the answer comes back through a note and only a summary fits.
//
// With --skips N it plays nothing: while paused, it skips to the next sentence
// (or SKIP_TARGET, e.g. next-paragraph) N times, a second apart, so the page glides sentence by sentence and walks
// far enough for epub.js to trim what falls out of reach — which is how the
// `views` lines, and whether a trim waited for the page to rest, are measured
// without any audio.
//
// With --whole it plays nothing either: while paused it skips to the next
// sentence (shown, and held by its first line), then hands the highlighter
// that same sentence again as a Clip that came without Word Timings — the
// message the bridge sends for one, with `words: null` and a real duration —
// so the page holds the whole Utterance at the line position instead. No
// Provider without Word Timings is needed; it proves the page's side only.
//
// With --tap it also, after the pause, measures a tapped-sentence move: it
// taps (a synthetic click in the section document) on a word 200–320 px below
// the line position while the reading is paused, and records the page for
// 1.2 s. Nothing plays: the sentence is shown and the page moves to its first
// line.
//
// What it prints, times in ms from `play` reaching the WebView:
//
//   line   one per change of the word's line: when the word reached the new
//          line, when the page began to move (delay), how far and for how long
//          it moved, the per-frame steps, and where the line's middle came to
//          rest against the target (h - inset) / 2
//   other  page movements with no line change before them (a new Utterance
//          starting on a new line counts as a line change; a jump, a display,
//          a tapped sentence while paused, whose Utterance is held whole): where
//          the word's line and the Utterance's middle came to rest
//   views  every change in the number of views, i.e. appends and trims, and
//          whether the page was still or moving when it happened
//
// GREEN is: at least three line changes with a move, every such move beginning
// at most two drawn frames after the word reached its line — frames, not
// milliseconds, because a frame the WebView is slow to draw delays both (or up
// to 300 ms before,
// at the cue of a sentence that begins on it), lasting 150–400 ms, and resting
// within 1.5 px of the target. A line the page cannot bring to the target —
// above it at the very top of the text — has no move and is not counted. Exit 0 GREEN, 1 RED, 2 on a usage or harness failure. It reads
// the program's effect, not its intent: a scroll made by epub.js at the same
// moment is counted with it.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, secondsArg, flag] = process.argv.slice(2);
const skips = secondsArg === '--skips' ? Number(flag) : 0;
const whole = secondsArg === '--whole';
const seconds = skips || whole ? 0 : Number(secondsArg);
if (!device || !metroLog || !(whole || (skips > 0 ? skips <= 60 : seconds > 0 && seconds <= 30))) {
  console.error('Usage: line-follow.cjs SIMULATOR_UDID METRO_LOG SECONDS [--tap]  (SECONDS at most 30)\n       line-follow.cjs SIMULATOR_UDID METRO_LOG --skips N  (N at most 60)');
  process.exit(2);
}
const tapToo = flag === '--tap';

const documents = path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents');
const harnessFile = path.join(documents, 'harness.json');
// Every command needs a new seq (README Pitfalls), so carry on from the file's.
let seq = (() => { try { return Number(JSON.parse(fs.readFileSync(harnessFile, 'utf8')).seq) || 0; } catch { return 0; } })();
const send = (command) => { seq += 1; fs.writeFileSync(harnessFile, JSON.stringify({ seq, ...command })); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The harness polls its file every 250 ms and runs only the command it finds
// there, so a command written straight after another replaces it unrun
// (README Pitfalls). A pause is followed by a wait long enough to be read.
async function pause() {
  send({ do: 'pause' });
  await sleep(700);
}
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
// A `js` answer becomes the reader's note, read in full from the `say`
// command's own `note attention=… "…"` line (follow-probe.cjs does the same).
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf('HX note attention=');
  if (at < 0) return [];
  try {
    const said = JSON.parse(line.slice(line.indexOf('"', at)));
    return said.includes('PROBE ') ? [said.slice(said.indexOf('PROBE ') + 6)] : [];
  } catch { return []; }
});
async function ask(code, ms = 4000) {
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

// Runs in the reader's WebView. Installed once per document load.
const arm = `
  var R = window.__lineFollow;
  if (!R) {
    R = window.__lineFollow = { t0: performance.now(), frames: [], msgs: [], inset: null, on: false };
    var entry = window.__openReaderHighlighter;
    window.__openReaderHighlighter = function (m) {
      if (m && m.kind === 'inset') R.inset = m.bottomPx;
      if (m && m.kind === 'speak') R.speak = m;
      if (R.on && m) R.msgs.push([Math.round(performance.now() - R.t0), m.kind, m.kind === 'speak' ? m.utterance + (m.reveal ? 'r' : '') + (m.words ? '' : ' nowords') : '']);
      return entry(m);
    };
    var m = rendition.manager;
    var sample = function () {
      if (R.on) {
        var box = m.container.getBoundingClientRect(), word = null, utt = null;
        rendition.getContents().forEach(function (c) {
          var w = c.window; if (!w || !w.CSS || !w.frameElement) return;
          var f = w.frameElement.getBoundingClientRect();
          var u = w.CSS.highlights.get('openreader-utterance');
          if (u && !utt) u.forEach(function (r) {
            var b = r.getBoundingClientRect(); if (!b.height) return;
            var top = f.top + b.top - box.top, bottom = f.top + b.bottom - box.top;
            utt = utt ? [Math.min(utt[0], top), Math.max(utt[1], bottom)] : [top, bottom];
          });
          var h = w.CSS.highlights.get('openreader-word'); if (word || !h) return;
          h.forEach(function (r) {
            if (word) return;
            var rects = r.getClientRects();
            for (var i = 0; i < rects.length; i++) if (rects[i].height && rects[i].width) {
              word = [c.sectionIndex, rects[i].top, rects[i].height, f.top + (rects[i].top + rects[i].bottom) / 2 - box.top];
              break;
            }
          });
        });
        R.frames.push([performance.now() - R.t0, m.container.scrollTop, word, m.views.length, utt ? (utt[0] + utt[1]) / 2 : null]);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }
  R.start = function () { R.t0 = performance.now(); R.frames = []; R.msgs = []; R.on = true; };
  R.stop = function () { R.on = false; };
  return 'armed inset=' + R.inset;
`;

// Also in the WebView: turn the frames into episodes, small enough for a note.
// An episode is a run of frames in which scrollTop moved, ended by three still
// frames. Each change of the word's line is matched with the episode it falls
// inside (a glide the Clip cue began, when a sentence starts on a new line: a
// negative delay) or the first one to begin within 200 ms after it.
const analyse = `
  var R = window.__lineFollow; R.stop();
  var F = R.frames, h = rendition.manager.container.clientHeight, inset = R.inset || 0, target = (h - inset) / 2;
  var out = { n: F.length, h: h, inset: inset, target: target, lines: [], other: [], views: [], msgs: R.msgs.slice(0, 60) };
  var same = function (a, b) { return a && b && a[0] === b[0] && Math.abs(a[1] - b[1]) < Math.min(a[2], b[2]) / 2; };
  var moving = function (i) { return i > 0 && Math.abs(F[i][1] - F[i - 1][1]) > 0.01; };
  var episodes = [];
  for (var i = 1; i < F.length; i++) {
    if (!moving(i)) continue;
    var steps = [], j = i, still = 0, last = i;
    for (; j < F.length && still < 3; j++) {
      if (moving(j)) { steps.push(Math.round((F[j][1] - F[j - 1][1]) * 10) / 10); last = j; still = 0; } else still++;
    }
    var rest = F[Math.min(last + 1, F.length - 1)], gap = 0;
    for (var g = i; g <= last; g++) gap = Math.max(gap, F[g][0] - F[g - 1][0]);
    episodes.push({ first: i, last: last, at: Math.round(F[i][0]), ms: Math.round(F[last][0] - F[i - 1][0]), px: Math.round((F[last][1] - F[i - 1][1]) * 10) / 10, rest: rest[2] ? Math.round((rest[2][3] - target) * 10) / 10 : null, whole: rest[4] === null ? null : Math.round((rest[4] - target) * 10) / 10, gap: Math.round(gap), steps: steps.join(','), used: false });
    i = last;
  }
  var line = null;
  for (var k = 1; k < F.length; k++) {
    var word = F[k][2];
    if (word && line && !same(line, word)) {
      var match = null;
      for (var e = 0; e < episodes.length && !match; e++) {
        var ep = episodes[e];
        if ((ep.first <= k && k <= ep.last + 1) || (ep.first > k && F[ep.first][0] - F[k][0] <= 200)) match = ep;
      }
      if (match) match.used = true;
      out.lines.push({ at: Math.round(F[k][0]), from: Math.round(line[1]), to: Math.round(word[1]), s: word[0], delay: match ? Math.round(F[match.first][0] - F[k][0]) : null, frames: match ? match.first - k : null, ms: match ? match.ms : null, px: match ? match.px : null, rest: match ? match.rest : null, gap: match ? match.gap : null, steps: match ? match.steps : '' });
    }
    if (word) line = word;
    if (F[k][3] !== F[k - 1][3]) out.views.push([Math.round(F[k][0]), F[k - 1][3] + '->' + F[k][3], moving(k) || moving(k - 1) ? 'moving' : 'still']);
  }
  episodes.forEach(function (ep) { if (!ep.used) out.other.push({ at: ep.at, ms: ep.ms, px: ep.px, rest: ep.rest, whole: ep.whole, gap: ep.gap, steps: ep.steps }); });
  var end = F[F.length - 1];
  out.endWhole = end && end[4] !== null ? Math.round((end[4] - target) * 10) / 10 : null;
  return JSON.stringify(out);
`;

const tap = `
  var m = rendition.manager, box = m.container.getBoundingClientRect(), R = window.__lineFollow;
  var target = (m.container.clientHeight - (R.inset || 0)) / 2, hit = null;
  rendition.getContents().forEach(function (c) {
    if (hit || !c.window || !c.window.frameElement) return;
    var f = c.window.frameElement.getBoundingClientRect(), doc = c.document;
    var walker = doc.createTreeWalker(doc.body, 4), node;
    while (!hit && (node = walker.nextNode())) {
      if (!/[A-Za-z]{4}/.test(node.data)) continue;
      var r = doc.createRange(); r.selectNodeContents(node);
      var rects = r.getClientRects();
      for (var i = 0; i < rects.length; i++) {
        var y = f.top + rects[i].top - box.top;
        if (y > target + 200 && y < target + 320) { hit = [c, rects[i].left + 4, rects[i].top + rects[i].height / 2, Math.round(y)]; break; }
      }
    }
  });
  if (!hit) return 'no text 200-320 px below the target';
  hit[0].document.elementFromPoint(hit[1], hit[2]).dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: hit[1], clientY: hit[2] }));
  return 'tapped at ' + hit[3] + ' px (target ' + Math.round(target) + ')';
`;

function print(page, label) {
  console.log(label + ': ' + page.n + ' frames, h ' + page.h + ', inset ' + page.inset + ', target ' + page.target);
  for (const m of page.msgs) console.log('  msg ' + m.join(' '));
  console.log('  line changes (at ms, word top from->to in its section, delay ms, move px, ms, rest px from target, longest frame ms, steps):');
  for (const l of page.lines) console.log('    ' + [l.at, 's' + l.s + ' ' + l.from + '->' + l.to, 'delay ' + l.delay + ' ms / ' + l.frames + ' frames', l.px + ' px', l.ms + ' ms', 'rest ' + l.rest, 'frame ' + l.gap, '[' + l.steps + ']'].join('  '));
  for (const o of page.other) console.log('  other move at ' + o.at + ': ' + o.px + ' px in ' + o.ms + ' ms, word rest ' + o.rest + ', Utterance middle rest ' + o.whole + ', longest frame ' + o.gap + ' ms [' + o.steps + ']');
  for (const v of page.views) console.log('  views ' + v.join(' '));
}

(async () => {
  const armed = await ask(arm);
  if (!armed || !armed.startsWith('armed')) {
    console.error('The recorder did not install: ' + armed + '. Is a reader open, and is Metro writing to ' + metroLog + '?');
    process.exit(2);
  }
  // Have the bridge send the player's inset again, so the target is known.
  send({ do: 'collapse', on: true });
  await sleep(800);
  send({ do: 'collapse', on: false });
  await sleep(800);
  try {
    execFileSync('bash', [require.resolve('./silence.sh'), 'check', device], { stdio: 'inherit' });
  } catch {
    process.exit(2);
  }
  await ask('window.__lineFollow.start(); return "started inset=" + window.__lineFollow.inset;');
  if (whole) {
    // On to a sentence of three lines or more, whose middle is not its first
    // line's: only there do "held whole" and "held by its first line" differ.
    const tall = `
      var box = rendition.manager.container.getBoundingClientRect(), top = null, bottom = null;
      rendition.getContents().forEach(function (c) {
        var w = c.window; if (!w || !w.CSS || !w.frameElement) return;
        var f = w.frameElement.getBoundingClientRect(), u = w.CSS.highlights.get('openreader-utterance');
        if (u) u.forEach(function (r) { var b = r.getBoundingClientRect(); if (!b.height) return; top = top === null ? f.top + b.top : Math.min(top, f.top + b.top); bottom = bottom === null ? f.top + b.bottom : Math.max(bottom, f.top + b.bottom); });
      });
      return top === null ? '0' : String(Math.round(bottom - top));
    `;
    let height = 0;
    for (let turn = 0; turn < 12 && height < 50; turn += 1) {
      send({ do: 'skip', target: 'next-sentence' });
      await sleep(1100);
      height = Number(await ask(tall));
    }
    console.log('a sentence ' + height + ' px tall');
    const replayed = await ask(`
      var R = window.__lineFollow, m = JSON.parse(JSON.stringify(R.speak));
      m.words = null; m.durationMs = 3000; m.reveal = true;
      R.start();
      window.__openReaderHighlighter(m);
      return 'replayed Utterance ' + m.utterance + ' without Word Timings';
    `);
    console.log(replayed);
    await sleep(800);
    const held = await ask(analyse, 8000);
    // Put the page's own state back: the sentence shown again, as the app has it.
    send({ do: 'skip', target: 'previous-sentence' });
    await sleep(700);
    send({ do: 'skip', target: 'next-sentence' });
    await sleep(700);
    if (held === null) {
      console.error('No answer to the analysis.');
      process.exit(2);
    }
    const page = JSON.parse(held);
    print(page, 'whole');
    console.log('the Utterance\'s middle ends ' + page.endWhole + ' px from the target');
    const green = page.endWhole !== null && Math.abs(page.endWhole) <= 1.5;
    console.log(green ? 'GREEN' : 'RED');
    process.exit(green ? 0 : 1);
  }
  if (skips) {
    for (let turn = 0; turn < skips; turn += 1) {
      send({ do: 'skip', target: process.env.SKIP_TARGET || 'next-sentence' });
      await sleep(1000);
    }
    const walked = await ask(analyse, 8000);
    await pause();
    if (walked === null) {
      console.error('No answer to the analysis.');
      process.exit(2);
    }
    const page = JSON.parse(walked);
    print(page, 'skips');
    const trims = page.views.filter((v) => /(\d+)->(\d+)/.test(v[1]) && Number(v[1].split('->')[1]) < Number(v[1].split('->')[0]));
    console.log(trims.length ? trims.length + ' trim(s), ' + trims.filter((v) => v[2] === 'still').length + ' at rest' : 'no trim happened');
    process.exit(trims.length && trims.every((v) => v[2] === 'still') ? 0 : 1);
  }
  const played = Date.now();
  send({ do: 'play' });
  let result = null;
  let tapped = null;
  try {
    await sleep(seconds * 1000);
    await pause();
    console.log('played ' + ((Date.now() - played) / 1000).toFixed(1) + ' s, then paused');
    result = await ask(analyse, 8000);
    if (tapToo) {
      // While paused: the tapped sentence is shown, with no Clip, and moved to.
      await ask('window.__lineFollow.start(); return "restarted";');
      console.log(await ask(tap));
      await sleep(1200);
      tapped = await ask(analyse, 8000);
    }
  } finally {
    await pause();
  }
  if (result === null) {
    console.error('No answer to the analysis.');
    process.exit(2);
  }
  const page = JSON.parse(result);
  print(page, 'reading');
  if (tapped) print(JSON.parse(tapped), 'tap');
  // A line above the target at the top of the text cannot be moved to it: those
  // changes have no episode, and are not counted against the run.
  const moved = page.lines.filter((l) => l.delay !== null);
  const green = moved.length >= 3 &&
    moved.every((l) => l.frames <= 2 && l.delay >= -300 && l.ms >= 150 && l.ms <= 400 && l.rest !== null && Math.abs(l.rest) <= 1.5);
  console.log(green ? 'GREEN' : 'RED');
  process.exit(green ? 0 : 1);
})().catch((error) => {
  send({ do: 'pause' });
  console.error(error);
  process.exit(2);
});
