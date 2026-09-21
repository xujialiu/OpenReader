#!/usr/bin/env node
// Play the open Document until one word is highlighted, then pause at once, and
// print what was sent to one host and every change of the highlight.
//
//   node test/manual-test/stop-on-word.cjs SIMULATOR_UDID METRO_LOG WORD MAX_SECONDS [METRO_URL] [HOST]
//
// Handler probe, not a touch test: Play and Pause are the Player's own handlers
// called through Metro's debugger (as reading.cjs does), with an in-app
// watchdog that pauses at MAX_SECONDS whatever the host does. What was sent
// comes from the walkthrough harness's `watchfetch` (method, URL and a string
// body, never headers), and the highlight from a recorder the harness's `js`
// installs in the reader's WebView: every change of the `openreader-utterance`
// and `openreader-word` CSS highlights, sampled every 40 ms, timed from its
// install. METRO_LOG is the file this worktree's Metro writes its output to,
// because the harness answers there. SHOTS_DIR in the environment also takes
// simulator screenshots for as long as it plays. Needs an open reader, paused,
// and the simulator's own volume at zero.
const { execFileSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');
const WebSocket = require('ws');

const [device, metroLog, word, seconds, metro = process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081', host = 'api.fish.audio'] = process.argv.slice(2);
const cap = Number(seconds) * 1000;
if (!device || !metroLog || !word || !Number.isFinite(cap) || cap <= 0 || cap > 30000) {
  console.error('Usage: stop-on-word.cjs SIMULATOR_UDID METRO_LOG WORD MAX_SECONDS(<=30) [METRO_URL] [HOST]');
  process.exit(2);
}
// That device's own volume, not the Mac's.
try { execFileSync('bash', [require.resolve('./silence.sh'), 'check', device], { stdio: 'inherit' }); } catch { process.exit(2); }

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
async function waitFor(offset, find, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const found = find(logSince(offset));
    if (found !== undefined && found !== null) return found;
    if (Date.now() >= end) return null;
    await sleep(40);
  }
}
// A `js` answer arrives as the reader's note in its HX status line, JSON-escaped
// and cut at 500 characters: parse the quoted string after note= (README Pitfalls).
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf(' note="');
  if (!line.includes('HX playing=') || at < 0) return [];
  try { return [JSON.parse(line.slice(at + 6)).replace(/^The highlight could not be drawn: PROBE /, '')]; } catch { return []; }
});
const answer = (offset, test, ms) => waitFor(offset, (text) => answers(text).find(test), ms);

const recorder = `
  clearInterval(window.__hxRecTimer);
  var d = window.__hxRec = { t0: Date.now(), seen: [], last: '', stopped: false };
  var texts = function (name) {
    return rendition.getContents().flatMap(function (c) {
      return Array.from(c.window.CSS.highlights.get(name) || []).map(function (r) { return r.toString(); });
    }).join('+');
  };
  window.__hxRecTimer = setInterval(function () {
    try {
      var w = texts('openreader-word'), u = texts('openreader-utterance');
      var key = u.slice(0, 16) + '|' + w;
      if (key === d.last) return;
      d.last = key;
      d.seen.push(((Date.now() - d.t0) / 1000).toFixed(2) + ' ' + key);
      if (w === ${JSON.stringify(word)} && !d.stopped) {
        d.stopped = true;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openreader:problem', utterance: -1, detail: 'PROBE STOPWORD ' + w }));
      }
    } catch (e) {}
  }, 40);
  return 'recorder installed';`;

(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then((response) => response.json());
  const named = process.env.OPENREADER_DEVICE;
  const targets = pages.filter((page) => page.appId === 'top.xujialiu.openreader' && (!named || page.deviceName === named));
  if (targets.length !== 1) throw new Error(`Expected one OpenReader debug target at ${metro}, found ${targets.length}`);
  const url = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(url.href, { origin: `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}` });
  const pending = new Map();
  let sequence = 0;
  socket.on('message', (bytes) => { const reply = JSON.parse(bytes.toString()); pending.get(reply.id)?.(reply); pending.delete(reply.id); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger request timed out')); }, 5000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error(`Evaluation failed: ${JSON.stringify(reply.error ?? reply.result.exceptionDetails).slice(0, 300)}`));
      else resolve(reply.result.result.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  await evaluate(`globalThis.__stopOnWordPlayer = () => {
    let found;
    function walk(f) { if (!f) return; if (f.type?.name === 'Player') found = f.memoizedProps; walk(f.child); walk(f.sibling); }
    const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
    if (!found) throw new Error('Open a Document first'); return found;
  }; true`);
  const state = () => evaluate('({ playing: __stopOnWordPlayer().playing, enabled: __stopOnWordPlayer().enabled })');

  const start = logSize();
  let played = false;
  let shooting = false;
  let shots = 0;
  try {
    send({ do: 'watchfetch', host });
    if (!(await waitFor(start, (text) => (text.includes(`HX fetch watched for ${host}`) ? true : null), 5000))) throw new Error('watchfetch was not acknowledged');
    let offset = logSize();
    send({ do: 'js', code: recorder });
    if (!(await answer(offset, (text) => text === 'recorder installed', 5000))) throw new Error('The WebView recorder was not installed (is a reader open?)');
    const before = await state();
    if (before.playing || !before.enabled) throw new Error(`Start with an enabled, paused reader: ${JSON.stringify(before)}`);

    if (process.env.SHOTS_DIR) {
      fs.mkdirSync(process.env.SHOTS_DIR, { recursive: true });
      shooting = true;
      (async () => {
        const t0 = Date.now();
        while (shooting) {
          const name = path.join(process.env.SHOTS_DIR, `play-${String(Date.now() - t0).padStart(5, '0')}ms.png`);
          await new Promise((resolve) => execFile('xcrun', ['simctl', 'io', device, 'screenshot', name], () => resolve()));
          shots += 1;
        }
      })();
    }
    offset = logSize();
    const began = Date.now();
    played = true;
    // The watchdog is the app's own: it pauses at the cap even if this host dies.
    await evaluate(`(() => { const p = __stopOnWordPlayer(); p.onPlay(); globalThis.__stopOnWordWatchdog = setTimeout(() => __stopOnWordPlayer().onPause(), ${cap}); return true; })()`);
    const seen = await answer(offset, (text) => text.startsWith('STOPWORD '), cap);
    await evaluate('__stopOnWordPlayer().onPause(); clearTimeout(globalThis.__stopOnWordWatchdog); true');
    const elapsed = Date.now() - began;
    shooting = false;
    console.log(`played ${(elapsed / 1000).toFixed(2)} s from Play to Pause; ${seen ? `"${word}" was highlighted` : `"${word}" was NOT highlighted within ${seconds} s`}`);
  } finally {
    shooting = false;
    if (played) await evaluate('__stopOnWordPlayer().onPause(); clearTimeout(globalThis.__stopOnWordWatchdog); true').catch(() => console.error('Pause was not confirmed; stop playback in the app'));
    await sleep(600);
    console.log(`after pause: ${JSON.stringify(await state().catch((e) => String(e)))}`);
  }

  // The recorder's log, a page at a time so no answer is cut at 500 characters.
  const transitions = [];
  for (let page = 0; page < 12; page++) {
    const offset = logSize();
    send({ do: 'js', code: `var s = window.__hxRec ? window.__hxRec.seen : []; return 'PAGE${page} ' + JSON.stringify(s.slice(${page * 6}, ${page * 6 + 6}));` });
    const text = await answer(offset, (value) => value.startsWith(`PAGE${page} `), 5000);
    if (!text) throw new Error(`No answer for page ${page} of the recorder`);
    const rows = JSON.parse(text.slice(`PAGE${page} `.length));
    transitions.push(...rows);
    if (rows.length < 6) break;
  }
  send({ do: 'js', code: "clearInterval(window.__hxRecTimer); return 'recorder removed';" });
  console.log('highlight changes (seconds since the recorder was installed, sentence|word):');
  for (const row of transitions) console.log(`  ${row}`);
  console.log(`requests to ${host} since the watcher was installed:`);
  for (const line of logSince(start).split('\n')) if (line.includes('HX fetch ') && !line.includes('HX fetch watched')) console.log(`  ${line.replace(/^.*HX fetch /, '').slice(0, 300)}`);
  if (process.env.SHOTS_DIR) console.log(`${shots} screenshots in ${process.env.SHOTS_DIR}`);
  await evaluate('delete globalThis.__stopOnWordPlayer; true').catch(() => {});
  socket.close();
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
