#!/usr/bin/env node
// Locks the device at a chosen moment of a download, rather than whenever
// lock-device.sh's runner finishes launching, then watches the download while
// locked and after unlocking (#76). Real synthesis, as download-away.cjs.
//
//   node test/manual-test/download-lock-at.cjs UDID DOCUMENT_ID PROVIDER VOICE AWAY_SECONDS WHEN CHAPTER_ID [CHAPTER_ID…]
//
// WHEN is the moment to lock:
//   left:N    — the chapter being written has N or fewer of its texts left to save;
//   preparing — the task reads 'preparing' (the chapter it needs is being prepared).
// The lock is `lock-device.sh UDID lock-on FILE`, started first and waiting, so
// the button is pressed within about 0.05 s of the moment. The task is sampled
// through cdp.cjs about four times a second until then and every second after,
// and printed when its state or chapter changes and otherwise every 5 s; clips
// are the saved files' birth times, as in download-away.cjs. After
// AWAY_SECONDS the device is unlocked and OpenReader brought to the front, and
// watched 40 s; then every chapter of the task is paused through `toggleTask`.
// OPENREADER_METRO (127.0.0.1, not localhost) and OPENREADER_DEVICE go to cdp.cjs.
const { execFile, execFileSync, spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [udid, documentId, provider, voice, away, when, ...chapters] = process.argv.slice(2);
const left = /^left:(\d+)$/.exec(when ?? '');
if (!udid || !documentId || !provider || !voice || !(Number(away) > 0) || !(left || when === 'preparing') || !chapters.length) {
  console.error('Usage: download-lock-at.cjs UDID DOCUMENT_ID PROVIDER VOICE AWAY_SECONDS left:N|preparing CHAPTER_ID…');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-lock-at-'));
const signal = join(output, 'lock-now');
let serial = 0;
const evaluate = (expression, timeout = 6000) => new Promise((resolve, reject) => {
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
const task = `r.downloadTasks(a.documentId).find(t => t.voice.provider === a.provider && t.voice.voice === a.voice)`;
/** The task, and how many texts of the chapter it is on are saved, from the progress the Download drawer also asks for. */
const sample = async () => {
  try {
    return JSON.parse(await evaluate(`(() => { const a = ${a}; const r = ${runtime}; const t = ${task}; if (!t) return 'null';
      const v = { provider: a.provider, voice: a.voice, label: a.voice };
      const c = t.current && r.planOf(a.documentId).chapters.find(c => c.id === t.current);
      const p = t.current && r.chapterProgress(a.documentId, v).get(t.current);
      return JSON.stringify({ state: t.state, current: t.current, error: t.error, prepared: c ? c.prepared !== false : null, saved: p ? p.count : null, texts: c && c.prepared !== false ? (c.textCount ?? c.texts.length) : null }); })()`, 3000));
  } catch (e) { return { answer: `none (${e.message.split('\n')[0].slice(0, 60)})` }; }
};
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
const before = new Set(births());
const fresh = () => births().filter((b) => !before.has(b));
const marks = [];
const mark = (name, at = Date.now()) => { marks.push([name, at]); console.log(`${new Date(at).toISOString()} ${name}`); };
const seen = new Set();
let shown = { at: 0, what: '' };
/** A sample, printed when the task's state or chapter changes and otherwise every 5 s. */
const show = (label, s) => {
  seen.add(s.state);
  const what = `${label} ${s.state} ${s.current} ${s.error}`;
  if (what === shown.what && Date.now() - shown.at < 5000) return;
  shown = { at: Date.now(), what };
  console.log(`${label} +${((Date.now() - marks.at(-1)[1]) / 1000).toFixed(1)} s  clips=${fresh().length}  ${JSON.stringify(s)}`);
};

(async () => {
  // The log names this run's own signal file: an earlier run's log also says `LOCKPROBE waiting`.
  const lockLog = '/tmp/openreader-lock-device/lock-on.log';
  const waiting = () => existsSync(lockLog) && readFileSync(lockLog, 'utf8').includes(`LOCKPROBE waiting for ${signal}`);
  const locker = spawn('bash', [join(__dirname, 'lock-device.sh'), udid, 'lock-on', signal], { stdio: 'inherit' });
  for (let i = 0; i < 240 && !waiting(); i++) await delay(500);
  if (!waiting()) throw Error('The lock probe did not start');
  // Asked once, as the open drawer asks: each saved clip then refreshes it.
  await evaluate(`(() => { const a = ${a}; const r = ${runtime}; r.requestProgress(a.documentId, { provider: a.provider, voice: a.voice, label: a.voice }); r.enqueue(a.documentId, { provider: a.provider, voice: a.voice, label: a.voice }, a.chapters); return true; })()`);
  mark('enqueued');
  for (let i = 0; ; i++) {
    const s = await sample();
    show('before', s);
    const due = when === 'preparing' ? s.state === 'preparing'
      : s.state === 'downloading' && s.texts !== null && s.saved !== null && s.texts - s.saved <= Number(left[1]);
    if (due) { writeFileSync(signal, ''); mark(`signalled (${JSON.stringify(s)})`); break; }
    if (Date.now() - marks[0][1] > 600000) throw Error(`Never ${when}`);
    await delay(150);
  }
  for (let i = 0; i < 100 && !/LOCKPROBE pressing at ([\d.]+)/.test(readFileSync(lockLog, 'utf8')); i++) await delay(100);
  const pressed = /LOCKPROBE pressing at ([\d.]+)/.exec(readFileSync(lockLog, 'utf8'));
  if (!pressed) throw Error('The lock probe did not press the lock button');
  mark('away (lock pressed)', Math.round(Number(pressed[1]) * 1000));
  const end = marks.at(-1)[1] + Number(away) * 1000;
  while (Date.now() < end) { show('away', await sample()); await delay(1000); }
  await new Promise((resolve) => locker.on('exit', resolve).exitCode !== null && resolve());
  sh('bash', join(__dirname, 'lock-device.sh'), udid, 'unlock');
  sh('xcrun', 'simctl', 'launch', udid, 'top.xujialiu.openreader');
  mark('back (OpenReader in front)');
  const back = Date.now() + 40000;
  while (Date.now() < back) { show('back', await sample()); await delay(1000); }
  await evaluate(`(() => { const a = ${a}; const r = ${runtime}; const t = ${task}; if (t && r.goesOn(t)) r.toggleTask(t); return true; })()`).catch(() => {});

  const [[, t0], , [, tAway], [, tBack]] = marks;
  const all = fresh().sort((x, y) => x - y);
  const within = (from, to) => all.filter((b) => b >= from && b < to).length;
  console.log('\nclips saved');
  console.log(`  before the lock:             ${within(t0, tAway)}`);
  console.log(`  locked, first 30 s:          ${within(tAway, Math.min(tAway + 30000, tBack))}`);
  console.log(`  locked, after 30 s:          ${within(Math.min(tAway + 30000, tBack), tBack)}`);
  console.log(`  back:                        ${within(tBack, Infinity)}`);
  const last = all.filter((b) => b < tBack).at(-1);
  if (last && last >= tAway) console.log(`  last clip while locked:      ${((last - tAway) / 1000).toFixed(1)} s after the lock`);
  const next = all.find((b) => b >= tBack);
  if (next) console.log(`  first clip after back:       ${((next - tBack) / 1000).toFixed(1)} s after back`);
  console.log(`  states seen:                 ${[...seen].join(', ')}`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
