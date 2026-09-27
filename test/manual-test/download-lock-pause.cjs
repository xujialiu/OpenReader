#!/usr/bin/env node
// A Reading paused and played again with the phone locked, while a download
// runs (#75). Real synthesis: every sentence of the chapters is sent to the
// Provider once (Fish's s2.1-pro-free costs nothing).
//
//   node test/manual-test/download-lock-pause.cjs UDID DOCUMENT_ID PROVIDER VOICE PAUSE_AFTER PAUSED_FOR PLAY_FOR CHAPTER_ID [CHAPTER_ID…]
//
// Opens the Document, starts the download, waits for its first ten clips,
// reads aloud (simulator volume set and checked at zero first) and locks the
// device. PAUSE_AFTER seconds after the lock it pauses the Reading through the
// harness (the lock screen's own Pause, `lock-device.sh pause`, if the harness
// is not answered within 5 s), watches PAUSED_FOR seconds, presses the lock
// screen's own Play (`lock-device.sh play`, which checks the volume first),
// watches PLAY_FOR seconds, unlocks, brings OpenReader back, watches 20 s,
// pauses the Reading and then every chapter of the download.
//
// Every 5 s it prints the clips saved since the start (the files' birth times
// in Documents/offline-narration-v2/, as download-away.cjs reads them), the
// task's state through CDP when the app answers, and the state last persisted
// in the catalogue (read from a copy of catalog.sqlite, so it is there while the
// app is suspended). OPENREADER_METRO (127.0.0.1, not localhost) is passed to
// cdp.cjs. What it cannot show: when the system ends the app's background time
// (an in-app listener on the offline module's `expired` event can), or a
// phone's own background time, which the simulator's is not.
//
// EXPIRE_AT=SECONDS (less than PAUSE_AFTER) is a handler probe, not the system:
// that long after the lock it emits the offline module's `expired` event from
// JavaScript, to every listener the runtime has on it, as the end of the
// background time would. On the iOS 27.0 simulator that event did not come
// while a Reading played (#75 verification, 2026-09-28), so the paths that
// follow it can only be reached this way there.
const expireAt = process.env.EXPIRE_AT ? Number(process.env.EXPIRE_AT) : null;
const { execFile, execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readdirSync, statSync, existsSync, copyFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
/* global __dirname -- a CommonJS script run by node; the lint config does not declare it. */

const [udid, documentId, provider, voice, pauseAfter, pausedFor, playFor, ...chapters] = process.argv.slice(2);
if (!udid || !documentId || !provider || !voice || !(Number(pauseAfter) > 0) || !(Number(pausedFor) > 0) || !(Number(playFor) > 0) || !chapters.length) {
  console.error('Usage: download-lock-pause.cjs UDID DOCUMENT_ID PROVIDER VOICE PAUSE_AFTER PAUSED_FOR PLAY_FOR CHAPTER_ID…');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-lock-pause-'));
let serial = 0;
const evaluate = (expression, timeout = 8000) => new Promise((resolve, reject) => {
  const file = join(output, `${++serial}.js`);
  writeFileSync(file, expression);
  execFile(process.execPath, [require.resolve('./cdp.cjs'), '--eval', file], { timeout }, (error, stdout, stderr) => {
    if (error) reject(Error((stderr || error.message).trim()));
    else { try { resolve(JSON.parse(stdout).value); } catch (e) { reject(e); } }
  });
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sh = (...args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8' }).trim();
const container = sh('xcrun', 'simctl', 'get_app_container', udid, 'top.xujialiu.openreader', 'data');
// `forEach`, not `for…of`: what --eval sends is compiled without Babel (Pitfalls).
const runtime = `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === 'src/offline/runtime.ts') found = __r(id); }); if (!found) throw Error('runtime'); return found; })()`;
const a = JSON.stringify({ documentId, provider, voice, chapters });
const player = `(() => { let found; const walk = (f) => { if (!f) return; if (f.type && f.type.name === 'Player') found = f; walk(f.child); walk(f.sibling); }; const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__; hook.renderers.forEach((_, id) => hook.getFiberRoots(id).forEach((root) => walk(root.current))); if (!found) throw Error('Player'); return found.memoizedProps; })()`;
const task = `${runtime}.downloadTasks(a.documentId).find(t => t.voice.provider === a.provider && t.voice.voice === a.voice)`;

const root = join(container, 'Documents', 'offline-narration-v2');
function births() {
  const out = [];
  if (!existsSync(root)) return out;
  for (const doc of readdirSync(root)) {
    const d = join(root, doc);
    if (!statSync(d).isDirectory()) continue;
    for (const v of readdirSync(d)) {
      const dir = join(d, v);
      if (!statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir)) if (/\.(audio|m4a|mp3|wav|ogg|opus)$/.test(f)) out.push(statSync(join(dir, f)).birthtimeMs);
    }
  }
  return out;
}
/** The task's state as last persisted, from a copy of the catalogue: readable while the app is suspended. */
function persisted() {
  const copy = mkdtempSync(join(output, 'db-'));
  try {
    for (const f of ['catalog.sqlite', 'catalog.sqlite-wal', 'catalog.sqlite-shm']) if (existsSync(join(root, f))) copyFileSync(join(root, f), join(copy, f));
    const rows = sh('sqlite3', join(copy, 'catalog.sqlite'), 'select value from state').split('\n');
    for (const row of rows) {
      let value; try { value = JSON.parse(row); } catch { continue; }
      if (!Array.isArray(value)) continue;
      const t = value.find((x) => x && x.document === documentId && x.voice?.provider === provider && x.voice?.voice === voice);
      if (t) return `${t.state}${t.current ? ` ${t.current}` : ''}`;
    }
    return '(no task)';
  } catch (e) { return `(unread: ${e.message.split('\n')[0].slice(0, 60)})`; } finally { rmSync(copy, { recursive: true, force: true }); }
}
let seq = Date.now();
const harness = (command) => writeFileSync(join(container, 'Documents', 'harness.json'), JSON.stringify({ seq: ++seq, ...command }));
const playing = () => evaluate(`${player}.playing`, 4000).catch(() => null);
const state = async () => {
  try {
    return await evaluate(`(() => { const a = ${a}; const t = ${task}; return t ? t.state + (t.current ? ' ' + t.current : '') : 'none'; })()`, 4000);
  } catch { return '(no answer)'; }
};
const before = new Set(births());
const fresh = () => births().filter((b) => !before.has(b));
const marks = [];
const mark = (name) => { marks.push([name, Date.now()]); console.log(`${new Date().toISOString()} ${name}`); };
async function watch(seconds, label) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await delay(5000);
    const s = await state();
    console.log(`${label} +${Math.round((Date.now() - marks.at(-1)[1]) / 1000)} s  clips=${fresh().length}  task=${s}  persisted=${persisted()}  reading playing=${await playing()}`);
  }
}
async function pauseReading() {
  harness({ do: 'pause' });
  for (let i = 0; i < 17; i++) { await delay(300); if ((await playing()) === false) return 'harness'; }
  return null;
}

(async () => {
  sh('bash', join(__dirname, 'silence.sh'), 'set', udid);
  harness({ do: 'open', id: documentId });
  await delay(8000);
  harness({ do: 'voicesheet', on: false });
  await delay(600);
  harness({ do: 'voice', provider, voice });
  await delay(1500);
  await evaluate(`(() => { const a = ${a}; ${runtime}.enqueue(a.documentId, { provider: a.provider, voice: a.voice, label: a.voice }, a.chapters); return true; })()`);
  mark('enqueued');
  for (let i = 0; i < 60 && fresh().length < 10; i++) await delay(1000);
  console.log(`started: clips=${fresh().length} task=${await state()}`);
  // Set again just before the check: a boot or a new output device puts it back to 60 (Pitfalls).
  sh('bash', join(__dirname, 'silence.sh'), 'set', udid);
  sh('bash', join(__dirname, 'silence.sh'), 'check', udid);
  harness({ do: 'play' });
  for (let i = 0; i < 20 && !(await playing()); i++) await delay(500);
  if (!(await playing())) throw Error('The reading did not start');
  sh('bash', join(__dirname, 'lock-device.sh'), udid, 'lock');
  mark('locked (playing)');
  if (expireAt !== null && expireAt > 0 && expireAt < Number(pauseAfter)) {
    await watch(expireAt, 'locked, playing');
    await evaluate(`(() => { let off; __r.getModules().forEach((m, id) => { if (m.verboseName === 'modules/open-reader-offline/index.ts') off = __r(id); }); off.offlineNative.emit('expired'); return true; })()`);
    mark('expired emitted (handler probe)');
    await watch(Number(pauseAfter) - expireAt, 'locked, playing, expired');
  } else await watch(Number(pauseAfter), 'locked, playing');
  let how = await pauseReading();
  if (!how) { sh('bash', join(__dirname, 'lock-device.sh'), udid, 'pause'); how = 'lock screen'; }
  mark(`paused while locked (${how})`);
  await watch(Number(pausedFor), 'locked, paused');
  // lock-device.sh play checks the simulator's volume is zero before it presses Play.
  sh('bash', join(__dirname, 'lock-device.sh'), udid, 'play');
  mark('played again while locked (lock screen)');
  await watch(Number(playFor), 'locked, playing again');
  sh('bash', join(__dirname, 'lock-device.sh'), udid, 'unlock');
  sh('xcrun', 'simctl', 'launch', udid, 'top.xujialiu.openreader');
  mark('back (unlocked, OpenReader in front)');
  await watch(20, 'back, playing');
  if (!(await pauseReading())) console.log('The harness pause was not confirmed: check the Reading');
  mark('paused');
  await evaluate(`(() => { const a = ${a}; const r = ${runtime}; const t = ${task}; if (t && r.goesOn(t)) r.toggleTask(t); return true; })()`).catch(() => {});
  console.log(`after Pause all: task=${await state()}`);

  const all = fresh().sort((x, y) => x - y);
  console.log('\nclips saved, by window');
  for (let i = 0; i < marks.length; i++) {
    const [name, from] = marks[i];
    const to = i + 1 < marks.length ? marks[i + 1][1] : Infinity;
    const inside = all.filter((b) => b >= from && b < to);
    const last = inside.at(-1);
    console.log(`  ${name}: ${inside.length}${inside.length ? `, first ${((inside[0] - from) / 1000).toFixed(1)} s, last ${((last - from) / 1000).toFixed(1)} s after it` : ''}`);
  }
})().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
  // Stop the Reading whatever failed: the harness if the app answers, otherwise open the device and try again.
  if (await pauseReading()) return;
  try { sh('bash', join(__dirname, 'lock-device.sh'), udid, 'unlock'); sh('xcrun', 'simctl', 'launch', udid, 'top.xujialiu.openreader'); } catch { /* reported below */ }
  if (!(await pauseReading())) console.error('Could not confirm the Reading paused: stop it by hand.');
});
