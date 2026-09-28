#!/usr/bin/env node
/* global __dirname */
// Does a download keep writing while the app is away from the screen, or while
// a reading plays? Real synthesis: every sentence of the chapters is sent to the
// Provider once (Fish's s2.1-pro-free costs nothing).
//
//   node test/manual-test/download-away.cjs MODE UDID DOCUMENT_ID PROVIDER VOICE AWAY_SECONDS CHAPTER_ID [CHAPTER_ID…]
//
// MODE is what happens once the first clips are saved:
//   home  — another app (Settings) is brought to the front, AWAY_SECONDS later
//           OpenReader is brought back, and watched 40 s more;
//   lock  — the same, with the device locked by `lock-device.sh` instead;
//   play  — the Document is opened and read aloud for AWAY_SECONDS (simulator
//           volume checked at zero first), then paused and watched 40 s more;
//   playlock — read aloud as in play, and the device locked while it plays;
//           unlocked, brought back and paused after AWAY_SECONDS.
// Until #75 the app held every download back while a Reading played; the
// PRETEND_NOT_PLAYING=1 that bypassed that hold for measuring went with it.
//
// Each saved clip is a file in Documents/offline-narration-v2/<document>/<voice>/
// whose birth time is when it was saved, so the timeline is read from the files
// and holds even while the app's JavaScript cannot answer. The task's state is
// read through cdp.cjs whenever the app answers. At the end every chapter of
// the task is paused through `toggleTask`, so nothing goes on spending.
// OPENREADER_METRO (use 127.0.0.1, not localhost: README Pitfalls) and
// OPENREADER_DEVICE are passed through to cdp.cjs.
const { execFile, execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [mode, udid, documentId, provider, voice, away, ...chapters] = process.argv.slice(2);
if (!['home', 'lock', 'play', 'playlock'].includes(mode) || !udid || !documentId || !provider || !voice || !(Number(away) > 0) || !chapters.length) {
  console.error('Usage: download-away.cjs home|lock|play|playlock UDID DOCUMENT_ID PROVIDER VOICE AWAY_SECONDS CHAPTER_ID…');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-away-'));
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
const appModule = (name) => `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === '${name}') found = __r(id); }); if (!found) throw Error('${name}'); return found; })()`;
const runtime = appModule('src/offline/runtime.ts');
const a = JSON.stringify({ documentId, provider, voice, chapters });
/** The Player's props, found by walking the React tree as voice-playback.cjs does. */
const player = `(() => { let found; const walk = (f) => { if (!f) return; if (f.type && f.type.name === 'Player') found = f; walk(f.child); walk(f.sibling); }; const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__; hook.renderers.forEach((_, id) => hook.getFiberRoots(id).forEach((root) => walk(root.current))); if (!found) throw Error('Player'); return found.memoizedProps; })()`;
const task = `${runtime}.downloadTasks(a.documentId).find(t => t.voice.provider === a.provider && t.voice.voice === a.voice)`;

/** Birth times, in ms, of every saved clip in the task's voice directory. */
function births() {
  const root = join(container, 'Documents', 'offline-narration-v2');
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
let seq = Date.now();
/** A command for the app's walkthrough harness (Documents/harness.json, polled four times a second). */
const harness = (command) => writeFileSync(join(container, 'Documents', 'harness.json'), JSON.stringify({ seq: ++seq, ...command }));
const playing = () => evaluate(`${player}.playing`).catch(() => null);
const state = async () => {
  try {
    return await evaluate(`(() => { const a = ${a}; const t = ${task}; return JSON.stringify(t && { state: t.state, current: t.current, error: t.error, failed: t.failed }); })()`);
  } catch (e) { return `(no answer: ${e.message.split('\n')[0].slice(0, 80)})`; }
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
    console.log(`${label} +${Math.round((Date.now() - marks.at(-1)[1]) / 1000)} s  clips=${fresh().length}  task=${s}${mode.startsWith('play') ? `  reading playing=${await playing()}` : ''}`);
  }
}

(async () => {
  if (mode.startsWith('play')) {
    sh('bash', join(__dirname, 'silence.sh'), 'set', udid);
    // The reader must be open before the download starts, so that the only change at `away` is Play.
    harness({ do: 'open', id: documentId });
    await delay(8000);
    harness({ do: 'voicesheet', on: false });
    await delay(600);
    harness({ do: 'voice', provider, voice });
    await delay(1500);
  }
  await evaluate(`(() => { const a = ${a}; ${runtime}.enqueue(a.documentId, { provider: a.provider, voice: a.voice, label: a.voice }, a.chapters); return true; })()`);
  mark('enqueued');
  for (let i = 0; i < 60 && fresh().length < 10; i++) await delay(1000);
  console.log(`started: clips=${fresh().length} task=${await state()}`);
  if (mode === 'home') { sh('xcrun', 'simctl', 'launch', udid, 'com.apple.Preferences'); mark('away (Settings in front)'); }
  if (mode === 'lock') { sh('bash', join(__dirname, 'lock-device.sh'), udid, 'lock'); mark('away (locked)'); }
  if (mode.startsWith('play')) {
    // Set again just before the check: a boot or a new output device puts it back to 60 (Pitfalls).
    sh('bash', join(__dirname, 'silence.sh'), 'set', udid);
    sh('bash', join(__dirname, 'silence.sh'), 'check', udid);
    harness({ do: 'play' });
    for (let i = 0; i < 20 && !(await playing()); i++) await delay(500);
    if (!(await playing())) throw Error('The reading did not start');
    if (mode === 'playlock') { sh('bash', join(__dirname, 'lock-device.sh'), udid, 'lock'); mark('away (playing, locked)'); }
    else mark('away (playing)');
  }
  await watch(Number(away), 'away');
  if (mode === 'playlock') {
    sh('bash', join(__dirname, 'lock-device.sh'), udid, 'unlock');
    sh('xcrun', 'simctl', 'launch', udid, 'top.xujialiu.openreader');
  }
  if (mode.startsWith('play')) {
    harness({ do: 'pause' });
    for (let i = 0; i < 10 && (await playing()); i++) await delay(300);
    mark('back (paused)');
  } else {
    if (mode === 'lock') sh('bash', join(__dirname, 'lock-device.sh'), udid, 'unlock');
    sh('xcrun', 'simctl', 'launch', udid, 'top.xujialiu.openreader');
    mark('back (OpenReader in front)');
  }
  await watch(40, 'back');
  await evaluate(`(() => { const a = ${a}; const r = ${runtime}; const t = ${task}; if (t && r.goesOn(t)) r.toggleTask(t); return true; })()`).catch(() => {});

  const [[, t0], [, tAway], [, tBack]] = marks;
  const all = fresh().sort((x, y) => x - y);
  const within = (from, to) => all.filter((b) => b >= from && b < to).length;
  console.log('\nclips saved');
  console.log(`  before away:                 ${within(t0, tAway)}`);
  console.log(`  away, first 30 s:            ${within(tAway, Math.min(tAway + 30000, tBack))}`);
  console.log(`  away, after 30 s:            ${within(Math.min(tAway + 30000, tBack), tBack)}`);
  console.log(`  back:                        ${within(tBack, Infinity)}`);
  const last = all.filter((b) => b < tBack).at(-1);
  if (last) console.log(`  last clip while away:        ${((last - tAway) / 1000).toFixed(1)} s after away`);
  const next = all.find((b) => b >= tBack);
  if (next) console.log(`  first clip after back:       ${((next - tBack) / 1000).toFixed(1)} s after back`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
