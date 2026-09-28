#!/usr/bin/env node
// How the chapters of a download are prepared (#76): every request the runtime
// hands the hidden rendering, in order, with how long each took and how it
// ended, whether two were ever out at once, and how busy the JavaScript thread
// was meanwhile. Installed in the app's JavaScript, so it keeps recording while
// the app is away from the screen and needs no CDP call until it is read.
//
//   node test/manual-test/downloads/download-ahead.cjs install DOCUMENT_ID [INTERVAL_MS=100]
//   node test/manual-test/downloads/download-ahead.cjs fail SECTION MAX [MESSAGE_PREFIX]
//   node test/manual-test/downloads/download-ahead.cjs read [OUT.json]
//   node test/manual-test/downloads/download-ahead.cjs prepared DOCUMENT_ID CHAPTER_ID…
//
// `install` polls `preparationRequest()` every INTERVAL_MS. Each request seen
// (a new token) is recorded with its section, the task's state and chapter at
// that moment (`writer` when the task reads `preparing` on a chapter of that
// section, otherwise `ahead`), and how many requests seen before it had not yet
// settled (`overlap`, which is 0 when one is out at a time). Its own `resolve`
// and `reject`, which the runtime calls on it, are wrapped to record when and
// how it ended (`PreparationInterrupted`, a failure's message) without
// changing what happens. Tokens are consecutive, so a gap in them is a request
// shorter than the poll. It also records every AppState change, the task's
// state and chapter whenever they change, and a 100 ms timer's lateness (the
// JavaScript thread's lag: `lagMax` per second).
//
// `fail` provokes failures of one section's preparation, a handler probe: every
// 10 ms it calls `failPreparation(token, 'MESSAGE_PREFIX N')` on a request for
// SECTION, at most MAX times, once per token.
//
// A relaunch removes both, and the pitfalls ask for one after any probe that
// wrapped something (Pitfalls, cdp.md). OPENREADER_METRO (127.0.0.1, not
// localhost) is passed to cdp.cjs. Times are UTC.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [mode, ...rest] = process.argv.slice(2);
if (!['install', 'fail', 'read', 'prepared'].includes(mode) || (mode === 'install' && !rest[0]) || (mode === 'fail' && !(rest[0] && rest[1])) || (mode === 'prepared' && rest.length < 2)) {
  console.error('Usage: download-ahead.cjs install DOCUMENT_ID [INTERVAL_MS] | fail SECTION MAX [PREFIX] | read [OUT.json] | prepared DOCUMENT_ID CHAPTER_ID…');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-ahead-'));
const evaluate = (expression) => {
  const file = join(output, 'probe.js');
  writeFileSync(file, expression);
  return JSON.parse(execFileSync(process.execPath, [require.resolve('../kit/cdp.cjs'), '--eval', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).value;
};
// `forEach`, not `for…of`: what --eval sends is compiled without Babel (Pitfalls, cdp.md).
const modules = `let rt, RN; __r.getModules().forEach((m, id) => { const n = m.verboseName || '';
  if (n === 'src/offline/runtime.ts') rt = __r(id);
  if (/node_modules\\/react-native\\/index\\.js$/.test(n)) RN = __r(id); });`;

if (mode === 'install') {
  const [documentId, interval = '100'] = rest;
  console.log(evaluate(`(() => { ${modules}
    const old = globalThis.__aheadMonitor;
    if (old) { clearInterval(old.timer); clearInterval(old.lagTimer); old.subs.forEach((s) => { try { s.remove(); } catch (e) {} }); }
    const D = ${JSON.stringify(documentId)};
    const M = { started: Date.now(), requests: [], events: [], lag: [], prepared: [], subs: [] };
    const byToken = new Map();
    M.subs.push(RN.AppState.addEventListener('change', (v) => M.events.push({ t: Date.now(), name: 'appstate', v })));
    let lastTask = '';
    M.timer = setInterval(() => {
      const now = Date.now();
      const t = rt.downloadTasks(D)[0];
      const what = t ? t.state + ' ' + t.current : 'none';
      if (what !== lastTask) { M.events.push({ t: now, name: 'task', v: t && t.state, current: t && t.current, error: t && t.error }); lastTask = what; }
      const r = rt.preparationRequest();
      if (!r || byToken.has(r.token)) return;
      const plan = rt.planOf(r.document);
      const current = t && t.current && plan ? plan.chapters.find((c) => c.id === t.current) : null;
      const open = M.requests.filter((q) => q.end === undefined).length;
      const q = { token: r.token, section: r.section, document: r.document, seen: now, state: t && t.state, current: t && t.current,
        role: t && t.state === 'preparing' && current && current.section === r.section ? 'writer' : 'ahead', overlap: open,
        chapters: plan ? plan.chapters.filter((c) => c.section === r.section).map((c) => c.id) : [] };
      byToken.set(r.token, q); M.requests.push(q);
      const resolve = r.resolve, reject = r.reject;
      r.resolve = function () { q.end = Date.now(); q.outcome = 'prepared'; return resolve.apply(this, arguments); };
      r.reject = function (e) { q.end = Date.now(); q.outcome = (e && e.name) + ': ' + (e && e.message); return reject.apply(this, arguments); };
    }, ${Number(interval)});
    // The JavaScript thread's lag: how late a 100 ms timer fires, the worst in each second.
    let expected = Date.now() + 100, second = Math.floor(Date.now() / 1000), worst = 0;
    M.lagTimer = setInterval(() => {
      const now = Date.now(); const late = Math.max(0, now - expected); expected = now + 100;
      const s = Math.floor(now / 1000);
      if (s !== second) {
        M.lag.push([second * 1000, worst]); if (M.lag.length > 7200) M.lag.shift(); second = s; worst = 0;
        // Once a second: how many of the task's chapters are prepared.
        const t = rt.downloadTasks(D)[0]; const p = rt.planOf(D);
        if (t && p) { const chosen = new Set(t.chapters); let n = 0; p.chapters.forEach((c) => { if (chosen.has(c.id) && c.prepared !== false) n++; }); M.prepared.push([now, n]); if (M.prepared.length > 7200) M.prepared.shift(); }
      }
      worst = Math.max(worst, late);
    }, 100);
    globalThis.__aheadMonitor = M;
    return JSON.stringify({ installed: M.started });
  })()`));
  process.exit(0);
}
if (mode === 'fail') {
  const [section, max, prefix = 'Provoked failure'] = rest;
  console.log(evaluate(`(() => { ${modules}
    const old = globalThis.__aheadFail; if (old) clearInterval(old.timer);
    const F = { section: ${Number(section)}, max: ${Number(max)}, done: [], tokens: new Set() };
    F.timer = setInterval(() => {
      const r = rt.preparationRequest();
      if (!r || r.section !== F.section || F.tokens.has(r.token)) return;
      if (F.done.length >= F.max) { clearInterval(F.timer); return; }
      F.tokens.add(r.token);
      const message = ${JSON.stringify(prefix)} + ' ' + (F.done.length + 1);
      F.done.push({ t: Date.now(), token: r.token, message });
      rt.failPreparation(r.token, message);
    }, 10);
    globalThis.__aheadFail = F;
    return JSON.stringify({ section: F.section, max: F.max });
  })()`));
  process.exit(0);
}
if (mode === 'prepared') {
  const [documentId, ...ids] = rest;
  console.log(evaluate(`(() => { ${modules} const p = rt.planOf(${JSON.stringify(documentId)}); if (!p) return 'no plan';
    const want = new Set(${JSON.stringify(ids)}); return JSON.stringify(p.chapters.filter((c) => want.has(c.id)).map((c) => [c.id, c.section, c.prepared !== false, c.textCount ?? null])); })()`));
  process.exit(0);
}
const value = evaluate(`(() => { const M = globalThis.__aheadMonitor; if (!M) return 'none'; const F = globalThis.__aheadFail;
  return JSON.stringify({ started: M.started, requests: M.requests, events: M.events, lag: M.lag, prepared: M.prepared, failed: F ? F.done : [] }); })()`);
if (value === 'none') { console.log('No monitor installed: run install first (a relaunch removes it).'); process.exit(1); }
const data = JSON.parse(value);
if (rest[0]) writeFileSync(rest[0], JSON.stringify(data));
const iso = (t) => new Date(t).toISOString().slice(11, 23);
console.log('events:');
data.events.forEach((e) => console.log(`  ${iso(e.t)} ${e.name} ${e.v ?? ''} ${e.current ?? ''} ${e.error ?? ''}`));
if (data.failed.length) { console.log('provoked:'); data.failed.forEach((f) => console.log(`  ${iso(f.t)} token ${f.token} ${f.message}`)); }
console.log('requests (token section chapters role seen duration outcome overlap):');
let previous = null, ordered = true, overlaps = 0, gaps = 0;
data.requests.forEach((q) => {
  const took = q.end !== undefined ? `${((q.end - q.seen) / 1000).toFixed(2)} s` : 'open';
  console.log(`  ${q.token} s${q.section} ${q.chapters.join(',')} ${q.role} ${iso(q.seen)} ${took} ${q.outcome ?? ''}${q.overlap ? ` OVERLAP ${q.overlap}` : ''}`);
  if (previous && q.role === 'ahead' && previous.role === 'ahead' && q.section < previous.section && previous.outcome === 'prepared') ordered = false;
  if (previous && q.token !== previous.token + 1) gaps += q.token - previous.token - 1;
  if (q.overlap) overlaps++;
  previous = q;
});
const done = data.requests.filter((q) => q.outcome === 'prepared' && q.role === 'ahead');
const times = done.map((q) => q.end - q.seen);
console.log(`requests: ${data.requests.length}; prepared ahead: ${done.length}; overlaps: ${overlaps}; tokens never seen: ${gaps}; ahead in list order after a success: ${ordered}`);
if (times.length) {
  const sorted = [...times].sort((x, y) => x - y);
  console.log(`ahead durations: min ${sorted[0]} ms, median ${sorted[Math.floor(sorted.length / 2)]} ms, max ${sorted.at(-1)} ms`);
}
const lags = data.lag.map((l) => l[1]).sort((x, y) => x - y);
if (data.prepared.length) console.log(`task chapters prepared: ${data.prepared[0][1]} at ${iso(data.prepared[0][0])} -> ${data.prepared.at(-1)[1]} at ${iso(data.prepared.at(-1)[0])}`);
if (lags.length) console.log(`JS lag (worst per second over ${lags.length} s): median ${lags[Math.floor(lags.length / 2)]} ms, p95 ${lags[Math.floor(lags.length * 0.95)]} ms, max ${lags.at(-1)} ms`);
