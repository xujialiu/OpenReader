#!/usr/bin/env node
/* global __dirname, Buffer */
// Seek the open Document to an Utterance, play, and pause the moment the
// chosen Utterance becomes the one being spoken — for #197's placement check,
// where the fact is where the page sits while the long sentence is
// highlighted. Handler probe through Metro's debugger, as reading.cjs does;
// the seek and the catch need indices, not gestures.
//
//   node untimed-placement.cjs SIMULATOR_UDID METRO_LOG CATCH_UTTERANCE MAX_SECONDS [METRO_URL]
//
// Checks the simulator's own volume first (exit 2 unless zero). Prints every
// observed utterance change with its time from the play, then the total play
// span. HOLD_MS waits that long past the catch before pausing, so a placement
// whose glide (250 ms) is still in flight at the cue is measured settled; keep
// catch + HOLD_MS inside the caught clip's own length. Leaves the reading
// paused; the page keeps its position, so the screenshot and the WebView
// measurement a caller takes afterwards describe the caught moment.
const { execFileSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const [device, metroLog, catchAt, secondsRaw, metro = process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081'] = process.argv.slice(2);
const seconds = Number(secondsRaw);
if (!device || !metroLog || catchAt === undefined || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60) {
  console.error('Usage: untimed-placement.cjs SIMULATOR_UDID METRO_LOG CATCH_UTTERANCE MAX_SECONDS(<=60) [METRO_URL]');
  process.exit(2);
}
// That device's own volume, not the Mac's.
try { execFileSync('bash', [path.join(__dirname, '../kit/silence.sh'), 'check', device], { stdio: 'inherit' }); } catch { process.exit(2); }

const documents = path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents');
const harnessFile = path.join(documents, 'harness.json');
let seq = (() => { try { return Number(JSON.parse(fs.readFileSync(harnessFile, 'utf8')).seq) || 0; } catch { return 0; } })();
const send = (command) => { seq += 1; fs.writeFileSync(harnessFile, JSON.stringify({ seq, ...command })); };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then(r => r.json());
  const targets = pages.filter(p => p.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error(`Expected one OpenReader target, found ${targets.length}`);
  const url = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(url.href, { origin: `http://${url.host}` });
  const pending = new Map(); let n = 0;
  socket.on('message', bytes => { const r = JSON.parse(bytes.toString()); pending.get(r.id)?.(r); pending.delete(r.id); });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++n;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('evaluate timed out')); }, 5000);
    pending.set(id, reply => {
      clearTimeout(timer);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error('evaluation failed'));
      else resolve(reply.result.result.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  await evaluate(`globalThis.__uPlace = () => {
    let found;
    function walk(f) { if (!f) return; if (f.type?.name === 'Player') found = f.memoizedProps; walk(f.child); walk(f.sibling); }
    const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
    if (!found) throw new Error('Open a Document first'); return found;
  }`);
  const state = async () => {
    const p = await evaluate('__uPlace()');
    return { playing: p.playing, enabled: p.enabled };
  };
  // The utterance index comes from the reading's status line in the Metro log,
  // which is the same value the status line prints every 500 ms.
  const utteranceNow = () => {
    const fd = fs.openSync(metroLog, 'r');
    try {
      const buf = Buffer.alloc(fs.fstatSync(fd).size);
      fs.readSync(fd, buf, 0, buf.length, 0);
      const lines = buf.toString('utf8').split('\n').filter(l => l.includes('playing='));
      const last = lines[lines.length - 1];
      if (!last) return null;
      const m = /utterance=(-?\d+)/.exec(last);
      return m ? Number(m[1]) : null;
    } finally { fs.closeSync(fd); }
  };

  const before = await state();
  if (before.playing || !before.enabled) throw new Error(`Start with an enabled, paused reader (playing=${before.playing} enabled=${before.enabled})`);
  send({ do: 'seek', utterance: Number(process.env.SEEK_UTTERANCE ?? catchAt - 1) });
  await sleep(1200);
  console.log(`seek done, log utterance=${utteranceNow()}`);

  const t0 = Date.now();
  await evaluate('(() => { const p = __uPlace(); p.onPlay(); globalThis.__uWatchdog = setTimeout(p.onPause, ' + Math.round(seconds * 1000) + '); return true; })()');
  console.log(`play pressed (in-app watchdog at ${seconds}s)`);
  const t = () => ((Date.now() - t0) / 1000).toFixed(2);
  let caught = null; let last = null;
  while (Date.now() - t0 < seconds * 1000) {
    const u = utteranceNow();
    if (u !== null && u !== last) { last = u; console.log(`t=${t()}s utterance=${u}`); }
    if (u === Number(catchAt) && caught === null) {
      caught = t();
      console.log(`t=${caught}s caught utterance ${catchAt}`);
      break;
    }
    await sleep(120);
  }
  if (caught === null) {
    await evaluate('__uPlace().onPause(); true').catch(() => {});
    throw new Error(`utterance ${catchAt} never became the spoken one within ${seconds}s`);
  }
  const hold = Number(process.env.HOLD_MS ?? 0);
  if (hold > 0) {
    await sleep(hold);
    console.log(`t=${t()}s held ${hold} ms past the catch`);
  }
  await evaluate('(() => { const p = __uPlace(); clearTimeout(globalThis.__uWatchdog); p.onPause(); return true; })()');
  console.log(`pause sent at t=${t()}s`);
  await evaluate('__uPlace().onPause(); true').catch(() => console.error('confirming pause failed'));
  await sleep(300);
  const after = await state();
  console.log(`PAUSE confirmed playing=${after.playing}; play span ${caught}s from press to catch`);
  socket.close();
  const shot = process.env.SHOT;
  if (shot) {
    await new Promise((resolve) => execFile('xcrun', ['simctl', 'io', device, 'screenshot', shot], () => resolve()));
    console.log(`screenshot ${shot}`);
  }
  process.exit(0);
})().catch(error => { console.error(error.message); process.exit(1); });
