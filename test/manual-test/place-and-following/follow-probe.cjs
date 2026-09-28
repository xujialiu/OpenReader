#!/usr/bin/env node
// Press Play with the page scrolled away from the reading, and report where the
// page lands, whether the sentence and the word are drawn, and what the program
// said about it (#50).
//
//   node test/manual-test/place-and-following/follow-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [SECONDS]
//
// Needs a reader open with the reading **paused on a sentence of spine item
// SECTION after its Clip has started** (so Play resumes it rather than fetching
// it), the simulator silenced (`silence.sh set`), and METRO_LOG, the file this
// worktree's Metro writes its output to, because the harness answers there.
//
// It installs a probe in the reader's WebView that timestamps every scroll the
// continuous manager is asked for (`scrollBy`, `scrollTo`, `moveTo`, with LIVE or
// silent and the views held), every `rendition.display()`, every section
// epub.js's content hook adopts, and every problem the program posts. Then it
// scrolls the page upwards, 1,500 px at a time, until SECTION is no longer among
// the views; checks the silence; sends `play`; waits SECONDS
// (default 2.5 — long enough for a section to arrive, measured at ~0.6 s); reads
// the page; and sends `pause` at once.
//
// What it prints, times in ms from the `play` command reaching the WebView:
//
//   events   the timeline above
//   top      the container's scrollTop, and h its height
//   utt/word each painted Range of the two highlights, in px from the top of
//            the scroll container, so a sentence on the screen reads between 0
//            and h, and centred reads near (h - the player's height) / 2
//   problems the "could not be drawn" details the program posted
//
// GREEN is: no problem posted, and every piece of the Utterance's highlight
// between 0 and h. The centring's exact target depends on the player's height,
// which only the app knows, so compare `mid` with the same run's next sentence,
// or with a screenshot. Exit 0 GREEN, 1 RED, 2 on a usage or harness failure.
//
// It scrolls with `scrollTop` from inside the WebView, not with a finger, and
// calls the reading handler rather than touching the Player: neither is a touch
// test. It plays for SECONDS and then pauses, including after a failure.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, sectionArg, secondsArg = '2.5'] = process.argv.slice(2);
const section = Number(sectionArg);
const seconds = Number(secondsArg);
if (!device || !metroLog || !Number.isInteger(section) || !(seconds > 0 && seconds <= 10)) {
  console.error('Usage: follow-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [SECONDS, at most 10]');
  process.exit(2);
}

const documents = path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents');
const harnessFile = path.join(documents, 'harness.json');
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
// A `js` answer becomes the reader's note. The status line cuts a note at 500
// characters, so the answer is read in full from the `say` command's own
// `note attention=… "…"` line instead.
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf('HX note attention=');
  if (at < 0) return [];
  const quoted = line.slice(line.indexOf('"', at));
  try {
    const said = JSON.parse(quoted);
    return said.includes('PROBE ') ? [said.slice(said.indexOf('PROBE ') + 6)] : [];
  } catch { return []; }
});
/** One `js` command, answered: the code runs in the reader's WebView and returns a string. */
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

// Runs in the reader's WebView. Installed once per document load; `reset` starts
// a new timeline without wrapping anything twice.
const arm = `
  var P = window.__followProbe;
  if (!P) {
    P = window.__followProbe = { t0: performance.now(), ev: [] };
    var m = rendition.manager;
    var views = function () { return m.views.all().map(function (v) { return v.section.index + (v.displayed ? 'd' : '-'); }).join(','); };
    var log = function (s) { P.ev.push(Math.round(performance.now() - P.t0) + ' ' + s); };
    var sb = m.scrollBy; m.scrollBy = function (x, y, silent) { log('scrollBy ' + Math.round(y) + (silent ? ' silent' : ' LIVE') + ' from ' + Math.round(m.container.scrollTop) + ' [' + views() + ']'); return sb.call(m, x, y, silent); };
    var st = m.scrollTo; m.scrollTo = function (x, y, silent) { log('scrollTo ' + Math.round(y) + (silent ? ' silent' : ' LIVE') + ' [' + views() + ']'); return st.call(m, x, y, silent); };
    var mt = m.moveTo; m.moveTo = function (o, w) { log('moveTo +' + Math.round(o.top) + ' from ' + Math.round(m.container.scrollTop)); return mt.call(m, o, w); };
    var d = rendition.display; rendition.display = function (t) { log('display ' + t); return d.call(rendition, t); };
    rendition.hooks.content.register(function (c) { log('content ' + c.sectionIndex + ' top=' + Math.round(m.container.scrollTop)); });
    var bridge = window.ReactNativeWebView, post = bridge.postMessage;
    bridge.postMessage = function (text) {
      try { var said = JSON.parse(text); if (said.type === 'openreader:problem' && String(said.detail).indexOf('PROBE') !== 0) { P.problems = P.problems || []; P.problems.push(Math.round(performance.now() - P.t0) + ' ' + said.detail); log('problem'); } } catch (e) {}
      return post.call(bridge, text);
    };
  }
  P.reset = function () { P.t0 = performance.now(); P.ev = []; P.problems = []; };
  P.views = function () { return rendition.manager.views.all().map(function (v) { return v.section.index; }); };
  return 'armed';
`;

const read = `
  var P = window.__followProbe, m = rendition.manager, box = m.container.getBoundingClientRect();
  var out = { events: P.ev, problems: P.problems || [], top: Math.round(m.container.scrollTop), h: m.container.clientHeight, views: P.views().join(','), utt: [], word: [] };
  rendition.getContents().forEach(function (c) {
    var w = c.window; if (!w || !w.CSS || !w.frameElement) return;
    var f = w.frameElement.getBoundingClientRect();
    [['utt', 'openreader-utterance'], ['word', 'openreader-word']].forEach(function (pair) {
      var h = w.CSS.highlights.get(pair[1]);
      if (h) h.forEach(function (r) {
        var rr = r.getBoundingClientRect();
        if (rr.height) out[pair[0]].push([c.sectionIndex, Math.round(f.top + rr.top - box.top), Math.round(f.top + rr.bottom - box.top), r.toString().slice(0, 24)]);
      });
    });
  });
  return JSON.stringify(out);
`;

(async () => {
  const armed = await ask(arm);
  if (armed !== 'armed') {
    console.error('The probe did not install: ' + armed + '. Is a reader open, and is Metro writing to ' + metroLog + '?');
    process.exit(2);
  }
  // Away from the reading, upwards, 1,500 px at a time until SECTION is gone.
  // Relative steps and not `scrollTop = 0`: that is the top of the first view,
  // and epub.js answers it by prepending the section above, scrolling down by its
  // height so the text stays put, and trimming it again — measured 2026-09-23,
  // twelve such scrolls left the views at [5, 6, 7] every time.
  let views = null;
  for (let turn = 0; turn < 24; turn += 1) {
    views = await ask('var c = rendition.manager.container; c.scrollTop = Math.max(0, c.scrollTop - 1500); return String(window.__followProbe.views());');
    if (views !== null && !views.split(',').map(Number).includes(section)) break;
    await sleep(600);
  }
  if (views === null || views.split(',').map(Number).includes(section)) {
    console.error('Section ' + section + ' is still on the page after 24 scrolls of 1,500 px upwards: views ' + views);
    process.exit(2);
  }
  console.log('away: views ' + views);

  try {
    execFileSync('bash', [require.resolve('../kit/silence.sh'), 'check', device], { stdio: 'inherit' });
  } catch {
    process.exit(2);
  }
  await ask('window.__followProbe.reset(); return "reset";');
  const played = Date.now();
  send({ do: 'play' });
  let result = null;
  try {
    await sleep(seconds * 1000);
    result = await ask(read);
  } finally {
    send({ do: 'pause' });
    console.log('played ' + ((Date.now() - played) / 1000).toFixed(1) + ' s, then paused');
  }
  if (result === null) {
    console.error('No answer to the read.');
    process.exit(2);
  }
  const page = JSON.parse(result);
  for (const event of page.events) console.log('  ' + event);
  console.log('top ' + page.top + ' h ' + page.h + ' views ' + page.views);
  for (const [section, top, bottom, text] of page.utt) console.log('  utt  s' + section + ' ' + top + '..' + bottom + ' "' + text + '"');
  for (const [section, top, bottom, text] of page.word) console.log('  word s' + section + ' ' + top + '..' + bottom + ' "' + text + '"');
  const pieces = page.utt;
  if (pieces.length) {
    const mid = (Math.min(...pieces.map((p) => p[1])) + Math.max(...pieces.map((p) => p[2]))) / 2;
    console.log('mid ' + Math.round(mid) + ' of ' + page.h);
  }
  for (const problem of page.problems) console.log('  problem ' + problem);
  const onScreen = pieces.length > 0 && pieces.every(([, top, bottom]) => top >= 0 && bottom <= page.h);
  const green = page.problems.length === 0 && onScreen;
  console.log(green ? 'GREEN' : 'RED: ' + (page.problems.length ? 'a problem was posted' : pieces.length ? 'the Utterance is off the screen' : 'nothing is highlighted'));
  process.exit(green ? 0 : 1);
})().catch((error) => {
  send({ do: 'pause' });
  console.error(error);
  process.exit(2);
});
