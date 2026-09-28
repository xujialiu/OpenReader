#!/usr/bin/env node
// A per-frame scrollTop recorder that also timestamps real touch events, for a
// real XCTest drag against a live glide (#71, ADR 0050). `line-follow.cjs`
// proves the program's own side with synthetic clicks and the harness's
// `play`/`pause`; this script proves the other half, that a **real** finger's
// `touchmove` halts a glide and puts the page in Browsing — which needs a
// genuine XCUITest gesture, not a JS-dispatched event.
//
//   node test/manual-test/place-and-following/glide-touch.cjs SIMULATOR_UDID METRO_LOG arm
//   node test/manual-test/place-and-following/glide-touch.cjs SIMULATOR_UDID METRO_LOG analyse
//
// `arm` installs a recorder independent of (and safe alongside) the one
// `line-follow.cjs` installs — its own global, `window.__glideTouch` — so it
// can be armed in the same session even after `line-follow.cjs` has already
// run. It records the same per-frame scrollTop/word-line/Utterance-middle
// series, plus a capture-phase `touchmove`/`touchend` listener added to every
// section document `rendition.getContents()` turns up (lazily, as sections
// render, the same way the app's own `dragged` listener is added per section
// in `highlighter.ts`) — additive only, nothing existing is removed or
// replaced, so the app's own touch handling runs exactly as it would without
// this probe. `arm` collapses and expands the player once, exactly as
// `line-follow.cjs` does, so `R.inset` — and with it the line position's
// target — is known, then starts recording. Run the real XCTest touches (see
// `glide-touch.sh`, `GlideTouchProbe.swift`) after `arm` and before
// `analyse`; nothing here presses Play or performs a touch itself.
//
// `analyse` stops the recording and prints, in the same shape as
// `line-follow.cjs`, every line change (matched with the scrollTop episode
// that followed it, if any) and every real touch event's own timestamp on the
// same `performance.now()` clock the frames use — so a touch can be lined up
// against whichever episode it interrupted, and a line change **after** the
// touch can be checked for having no matching episode at all, which is what
// Browsing suppressing the follow looks like from the outside.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, mode] = process.argv.slice(2);
if (!device || !metroLog || !['arm', 'analyse'].includes(mode)) {
  console.error('Usage: glide-touch.cjs SIMULATOR_UDID METRO_LOG arm|analyse');
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

// Its own global, deliberately not `window.__lineFollow`: armable in the same
// session after (or before) `line-follow.cjs`, without fighting over which
// script's `sample` loop is the one still running.
const arm = `
  var R = window.__glideTouch;
  if (!R) {
    R = window.__glideTouch = { t0: performance.now(), frames: [], touches: [], inset: null, on: false };
    var entry = window.__openReaderHighlighter;
    window.__openReaderHighlighter = function (m) {
      if (m && m.kind === 'inset') R.inset = m.bottomPx;
      return entry(m);
    };
    var m = rendition.manager;
    var sample = function () {
      if (R.on) {
        var box = m.container.getBoundingClientRect(), word = null, utt = null;
        rendition.getContents().forEach(function (c) {
          var w = c.window; if (!w || !w.CSS || !w.frameElement) return;
          if (!c.document.__glideTouchHooked) {
            c.document.__glideTouchHooked = true;
            c.document.addEventListener('touchmove', function (e) {
              var t = e.touches && e.touches.length ? e.touches[0] : null;
              R.touches.push([Math.round(performance.now() - R.t0), 'move', t ? Math.round(t.clientY) : null]);
            }, { passive: true, capture: true });
            c.document.addEventListener('touchend', function () {
              R.touches.push([Math.round(performance.now() - R.t0), 'end', null]);
            }, { passive: true, capture: true });
          }
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
  R.start = function () { R.t0 = performance.now(); R.frames = []; R.touches = []; R.on = true; };
  R.stop = function () { R.on = false; };
  return 'armed inset=' + R.inset;
`;

// Same episode/line-change shape as line-follow.cjs's analyse, plus the real
// touch timestamps on the same clock.
const analyse = `
  var R = window.__glideTouch; R.stop();
  var F = R.frames, h = rendition.manager.container.clientHeight, inset = R.inset || 0, target = (h - inset) / 2;
  var out = { n: F.length, h: h, inset: inset, target: target, lines: [], other: [], touches: R.touches };
  var same = function (a, b) { return a && b && a[0] === b[0] && Math.abs(a[1] - b[1]) < Math.min(a[2], b[2]) / 2; };
  var moving = function (i) { return i > 0 && Math.abs(F[i][1] - F[i - 1][1]) > 0.01; };
  var episodes = [];
  for (var i = 1; i < F.length; i++) {
    if (!moving(i)) continue;
    var steps = [], j = i, still = 0, last = i;
    for (; j < F.length && still < 3; j++) {
      if (moving(j)) { steps.push(Math.round((F[j][1] - F[j - 1][1]) * 10) / 10); last = j; still = 0; } else still++;
    }
    var rest = F[Math.min(last + 1, F.length - 1)];
    episodes.push({ first: i, last: last, at: Math.round(F[i][0]), endAt: Math.round(F[last][0]), ms: Math.round(F[last][0] - F[i - 1][0]), px: Math.round((F[last][1] - F[i - 1][1]) * 10) / 10, rest: rest[2] ? Math.round((rest[2][3] - target) * 10) / 10 : null, steps: steps.join(','), used: false });
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
      out.lines.push({ at: Math.round(F[k][0]), s: word[0], matchedEpisode: match ? [match.at, match.endAt] : null, px: match ? match.px : null, ms: match ? match.ms : null, rest: match ? match.rest : null });
    }
    if (word) line = word;
  }
  episodes.forEach(function (ep) { if (!ep.used) out.other.push(ep); });
  return JSON.stringify(out);
`;

(async () => {
  if (mode === 'arm') {
    const armed = await ask(arm);
    if (!armed || !armed.startsWith('armed')) {
      console.error('The recorder did not install: ' + armed + '. Is a reader open, and is Metro writing to ' + metroLog + '?');
      process.exit(2);
    }
    // Have the bridge send the player's inset again, so the target is known —
    // same trick line-follow.cjs uses.
    send({ do: 'collapse', on: true });
    await sleep(800);
    send({ do: 'collapse', on: false });
    await sleep(800);
    const started = await ask('window.__glideTouch.start(); return "started inset=" + window.__glideTouch.inset;');
    console.log(started);
    process.exit(started && started.startsWith('started') ? 0 : 2);
  }
  const result = await ask(analyse, 8000);
  if (result === null) {
    console.error('No answer to the analysis.');
    process.exit(2);
  }
  const page = JSON.parse(result);
  console.log(page.n + ' frames, h ' + page.h + ', inset ' + page.inset + ', target ' + page.target);
  console.log('line changes (at ms, section, matched episode [start,end] or null, px, ms, rest px from target):');
  for (const l of page.lines) console.log('  ' + [l.at, 's' + l.s, l.matchedEpisode ? '[' + l.matchedEpisode.join('..') + ']' : 'NO EPISODE', l.px + ' px', l.ms + ' ms', 'rest ' + l.rest].join('  '));
  if (page.other.length) {
    console.log('other (unmatched) episodes:');
    for (const o of page.other) console.log('  ' + [o.at, o.endAt, o.px + ' px', o.ms + ' ms', 'rest ' + o.rest, '[' + o.steps + ']'].join('  '));
  }
  console.log('real touch events (ms, kind, clientY):');
  for (const t of page.touches) console.log('  ' + t.join('  '));
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
