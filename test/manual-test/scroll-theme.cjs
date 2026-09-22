#!/usr/bin/env node
// Fling the open reader's page and report, for every section epub.js holds,
// whether the app's own stylesheet made it into that section's document.
//
//   node test/manual-test/scroll-theme.cjs SIMULATOR_UDID METRO_LOG [RUNS] [DIRECTION] [PX_PER_FRAME] [FRAMES]
//
// DIRECTION is `down` (the finger swipes up and later text comes into view,
// the default) or `up`. Each run waits for epub.js's own work queue to empty,
// puts the page back where the fling starts — the first section for `down`,
// section START (environment, default 30) for `up` — waits for the queue again,
// scrolls the manager's own container by PX_PER_FRAME (default 120) on each of
// FRAMES (default 90) animation frames, waits SETTLE ms (environment, default
// 1500) and for the queue once more, and reads every view twice, the second
// time two seconds later.
//
// A view reads `INDEX:MARK`, then `?` when epub.js does not count it as
// displayed and `*` when any of it is on screen. MARK is `D` for a document
// holding `#openreader-highlight` with the dark page colour in it, `l` for one
// holding it without, `L` for a document with **no** `#openreader-highlight`
// at all, `n` for an iframe without a document, and `x` for a view with no
// iframe (destroyed). An `L` also reads `[sameN epN]`: whether the view's own
// Contents is that document, and how many stylesheets epub.js injected into it
// itself. The run is red when a displayed view reads `L` in the second
// reading: a section on the page that the app never styled, which is what a
// white section on a dark page is (#34).
//
// A queue that has not emptied after ten seconds is reported as STUCK rather
// than read as a pass. Exit 0 when every run is green, 1 when any is red, 3
// when none is red but some were stuck, 2 on a usage or harness failure.
//
// Needs the theme set to dark, a reader open on a Document with several
// sections taller than the screen (`scroll-fixture.ts`), and METRO_LOG, the file
// this worktree's Metro writes its output to, because the harness answers
// there. SHOTS_DIR in the environment also takes a screenshot after each run.
// It scrolls with `scrollTop` from inside the WebView rather than with a
// finger: that reaches epub.js's `scroll` listener exactly as a finger does,
// but it is not a touch test. Never plays.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, runsArg = '5', direction = 'down', pxArg = '120', framesArg = '90'] = process.argv.slice(2);
const runs = Number(runsArg);
const px = Number(pxArg);
const frames = Number(framesArg);
const settle = Number(process.env.SETTLE ?? 1500);
const start = Number(process.env.START ?? 30);
if (!device || !metroLog || !(runs > 0) || !['down', 'up'].includes(direction) || !(px > 0) || !(frames > 0)) {
  console.error('Usage: scroll-theme.cjs SIMULATOR_UDID METRO_LOG [RUNS] [down|up] [PX_PER_FRAME] [FRAMES]');
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
// A `js` answer arrives as the reader's note in its HX status line, JSON-escaped
// and cut at 500 characters: parse the quoted string after note= (README Pitfalls).
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf(' note="');
  if (!line.includes('HX playing=') || at < 0) return [];
  try { return [JSON.parse(line.slice(at + 6)).replace(/^The highlight could not be drawn: PROBE /, '')]; } catch { return []; }
});
async function answer(offset, test, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const found = answers(logSince(offset)).find(test);
    if (found !== undefined) return found;
    if (Date.now() >= end) return null;
    await sleep(50);
  }
}

// Runs in the reader's WebView. `run` answers twice through the same problem
// message the harness's own `js` answers through, prefixed so the two readings
// of one run cannot be confused with each other or with a stale note.
const probe = `
  var P = window.__scrollTheme = {};
  P.post = function (said) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openreader:problem', utterance: -1, detail: 'PROBE ' + said }));
  };
  /* What an unstyled document does hold, read without touching epub.js: whether
     the view's own Contents is this very document, and how many stylesheets
     epub.js itself injected (its theme arrives through the content hook, so a
     count above zero means epub.js had finished preparing the document). */
  P.detail = function (view, doc) {
    var contents = view.contents;
    return '[same' + (contents && contents.document === doc ? 1 : 0) +
      ' ep' + doc.querySelectorAll('style[id^="epubjs-inserted-css"]').length + ']';
  };
  P.audit = function () {
    var manager = rendition.manager, box = manager.container.getBoundingClientRect();
    return manager.views.all().map(function (view) {
      var said = String(view.section.index), frame = view.iframe;
      if (!frame) return said + ':x';
      var rect = frame.getBoundingClientRect();
      var seen = rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom;
      var doc = frame.contentDocument, mark, more = '';
      if (!doc || !doc.body) mark = 'n';
      else {
        var style = doc.getElementById('openreader-highlight');
        mark = !style ? 'L' : style.textContent.indexOf('#111114') >= 0 ? 'D' : 'l';
        if (mark === 'L') more = P.detail(view, doc);
      }
      return said + ':' + mark + (view.displayed ? '' : '?') + (seen ? '*' : '') + more;
    }).join(' ');
  };
  /* Resolves once epub.js's own queue has nothing left to do, which is when
     every section it is going to put on the page is there: a reading taken
     earlier could catch a view between its display and its styling. A queue
     that never empties is its own finding, and is reported as STUCK rather
     than read as a pass. */
  P.idle = function (ms, then, stuck) {
    var queue = rendition.manager.q, end = Date.now() + ms;
    (function poll() {
      if (!queue._q.length && !queue.running) { then(); return; }
      if (Date.now() > end) { stuck(queue._q.length); return; }
      setTimeout(poll, 50);
    })();
  };
  P.run = function (id, from, step, frames, settle) {
    var manager = rendition.manager;
    var stuck = function (where) { return function (pending) { P.post('RUN ' + id + ' STUCK ' + where + ' with ' + pending + ' queued ' + P.audit()); }; };
    P.idle(10000, function () {
      rendition.display(from).then(function () {
        P.idle(10000, function () {
          var container = manager.container, done = 0;
          (function fling() {
            container.scrollTop += step;
            done += 1;
            if (done < frames) { requestAnimationFrame(fling); return; }
            setTimeout(function () {
              P.idle(10000, function () {
                P.post('RUN ' + id + ' A ' + P.audit());
                setTimeout(function () { P.post('RUN ' + id + ' B ' + P.audit() + ' top=' + Math.round(container.scrollTop)); }, 2000);
              }, stuck('after the fling'));
            }, settle);
          })();
        }, stuck('before the fling'));
      }, function (error) { P.post('RUN ' + id + ' failed ' + error); });
    }, stuck('before the reset'));
    return 'RUN ' + id + ' started';
  };
  return 'probe installed';`;

(async () => {
  let offset = logSize();
  send({ do: 'js', code: probe });
  if (!(await answer(offset, (text) => text === 'probe installed', 5000))) throw new Error('The WebView probe was not installed (is a reader open?)');
  const from = direction === 'down' ? 0 : start;
  const step = direction === 'down' ? px : -px;
  let red = 0;
  let stuckRuns = 0;
  for (let run = 1; run <= runs; run += 1) {
    const id = `${Date.now().toString(36)}-${run}`;
    offset = logSize();
    send({ do: 'js', code: `return window.__scrollTheme.run(${JSON.stringify(id)}, ${from}, ${step}, ${frames}, ${settle});` });
    const first = await answer(offset, (text) => /^RUN \S+ (A|failed|STUCK) /.test(text) && text.startsWith(`RUN ${id} `), 60000);
    const second = first && / A /.test(first) ? await answer(offset, (text) => text.startsWith(`RUN ${id} B `), 10000) : null;
    if (process.env.SHOTS_DIR) {
      fs.mkdirSync(process.env.SHOTS_DIR, { recursive: true });
      execFileSync('xcrun', ['simctl', 'io', device, 'screenshot', path.join(process.env.SHOTS_DIR, `run-${run}.png`)], { stdio: 'ignore' });
    }
    const views = (second ?? '').replace(/^RUN \S+ B /, '').replace(/ top=\S+$/, '').split(/ (?=\d+:)/).filter(Boolean);
    const unstyled = views.filter((view) => /^\d+:L\*?(\[|$)/.test(view));
    if (unstyled.length) red += 1;
    if (first && / STUCK /.test(first)) stuckRuns += 1;
    console.log(`run ${run}: ${unstyled.length ? 'RED' : second ? 'green' : first && / STUCK /.test(first) ? 'STUCK' : 'NO ANSWER'}`);
    console.log(`  ${first ?? '(no first reading)'}`);
    console.log(`  ${second ?? '(no second reading)'}`);
  }
  console.log(`${red} of ${runs} runs left a displayed section without the app's stylesheet${stuckRuns ? `; ${stuckRuns} found epub.js's queue stuck` : ''}`);
  process.exit(red ? 1 : stuckRuns ? 3 : 0);
})().catch((error) => {
  console.error(error.message);
  process.exit(2);
});
