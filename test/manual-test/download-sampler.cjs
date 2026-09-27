#!/usr/bin/env node
// What the app itself saw during a download run (#75): once a second, the
// Reading's playing, buffering and Utterance and one Document's download state;
// and, as they happen, every AppState change and every `expired` event of the
// offline module (the end of the background time), through a listener added
// beside the runtime's own. It lives in the app's JavaScript, so it keeps
// sampling while the app runs away from the screen, where CDP answers are
// slower, and it needs no CDP call until it is read.
//
//   node test/manual-test/download-sampler.cjs install DOCUMENT_ID
//   node test/manual-test/download-sampler.cjs read [SINCE_MS [UNTIL_MS [OUT.json]]]
//
// `read` prints the events, any gap over 2.5 s between samples (the app's
// JavaScript not running), each buffering episode, the Utterances played and
// the longest stay on one Utterance while playing (pauses break a stay). A
// second `install` replaces the first; a relaunch removes it. OPENREADER_METRO
// (127.0.0.1, not localhost) is passed to cdp.cjs. The times are UTC.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [mode, ...rest] = process.argv.slice(2);
if (!['install', 'read'].includes(mode) || (mode === 'install' && !rest[0])) {
  console.error('Usage: download-sampler.cjs install DOCUMENT_ID | read [SINCE_MS [UNTIL_MS [OUT.json]]]');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-sampler-'));
const evaluate = (expression) => {
  const file = join(output, 'probe.js');
  writeFileSync(file, expression);
  return JSON.parse(execFileSync(process.execPath, [require.resolve('./cdp.cjs'), '--eval', file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).value;
};

// `forEach`, not `for…of`: what --eval sends is compiled without Babel (Pitfalls, cdp.md).
const install = (documentId) => `(() => {
  const old = globalThis.__downloadSampler;
  if (old) { clearInterval(old.timer); old.subs.forEach((s) => { try { s.remove(); } catch (e) {} }); }
  let runtime, offline, RN;
  __r.getModules().forEach((m, id) => {
    const n = m.verboseName || '';
    if (n === 'src/offline/runtime.ts') runtime = __r(id);
    if (n === 'modules/open-reader-offline/index.ts') offline = __r(id);
    if (/node_modules\\/react-native\\/index\\.js$/.test(n)) RN = __r(id);
  });
  const S = { samples: [], events: [], subs: [], started: Date.now() };
  const event = (name, extra) => S.events.push(Object.assign({ t: Date.now(), name }, extra || {}));
  if (offline && offline.offlineNative) S.subs.push(offline.offlineNative.addListener('expired', () => event('expired')));
  S.subs.push(RN.AppState.addEventListener('change', (v) => event('appstate', { v })));
  const status = () => {
    let view;
    const walk = (f) => { if (!f || view) return; if (f.type && f.type.name === 'ReadingView') view = f; walk(f.child); walk(f.sibling); };
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    hook.renderers.forEach((_, id) => hook.getFiberRoots(id).forEach((root) => walk(root.current)));
    if (!view) return null;
    for (let h = view.memoizedState; h; h = h.next) { const v = h.memoizedState; if (v && typeof v.known === 'number' && 'buffering' in v) return v; }
    return null;
  };
  let last = null;
  S.timer = setInterval(() => {
    try {
      const st = status();
      const t = runtime.downloadTasks(${JSON.stringify(documentId)})[0];
      const state = t ? t.state : null;
      if (state !== last) { event('task', { v: state, current: t ? t.current : null }); last = state; }
      S.samples.push([Date.now(), RN.AppState.currentState, st ? st.playing : null, st ? st.buffering : null, st ? st.utterance : null, state, t ? t.current : null]);
      if (S.samples.length > 4000) S.samples.shift();
    } catch (e) { S.samples.push([Date.now(), 'err', String(e).slice(0, 120)]); }
  }, 1000);
  globalThis.__downloadSampler = S;
  return JSON.stringify({ installed: S.started, expiredListener: !!(offline && offline.offlineNative) });
})()`;

if (mode === 'install') {
  console.log(evaluate(install(rest[0])));
  process.exit(0);
}
const since = Number(rest[0] || 0);
const until = Number(rest[1] || 9e15);
const value = evaluate(`(() => { const S = globalThis.__downloadSampler; if (!S) return 'none'; return JSON.stringify({ started: S.started, events: S.events.filter(e => e.t >= ${since} && e.t <= ${until}), samples: S.samples.filter(s => s[0] >= ${since} && s[0] <= ${until}) }); })()`);
if (value === 'none') { console.log('No sampler installed: run install first (a relaunch removes it).'); process.exit(1); }
const data = JSON.parse(value);
if (rest[2]) writeFileSync(rest[2], JSON.stringify(data));
const iso = (t) => new Date(t).toISOString().slice(11, 23);
console.log('events:');
data.events.forEach((e) => console.log(`  ${iso(e.t)} ${e.name} ${e.v ?? ''} ${e.current ?? ''}`));
const s = data.samples;
console.log(`samples: ${s.length}`);
for (let i = 1; i < s.length; i++) if (s[i][0] - s[i - 1][0] > 2500) console.log(`  gap ${((s[i][0] - s[i - 1][0]) / 1000).toFixed(1)} s from ${iso(s[i - 1][0])} to ${iso(s[i][0])}`);
let buffering = null;
s.forEach((x) => {
  if (x[3] === true && buffering === null) buffering = x[0];
  if (x[3] !== true && buffering !== null) { console.log(`  buffering ${iso(buffering)} .. ${iso(x[0])} (~${((x[0] - buffering) / 1000).toFixed(1)} s)`); buffering = null; }
});
if (buffering !== null) console.log(`  buffering from ${iso(buffering)} to the end`);
const playing = s.filter((x) => x[2] === true);
if (playing.length) {
  console.log(`playing samples: ${playing.length}; utterance ${playing[0][4]} -> ${playing.at(-1)[4]} between ${iso(playing[0][0])} and ${iso(playing.at(-1)[0])}`);
  let run = null, longest = { u: null, from: 0, to: 0 };
  s.forEach((x) => {
    if (x[2] !== true) { run = null; return; }
    if (run && x[4] === run.u) run.to = x[0]; else run = { u: x[4], from: x[0], to: x[0] };
    if (run.to - run.from > longest.to - longest.from) longest = { ...run };
  });
  console.log(`longest stay on one utterance while playing: ${longest.u} for ${((longest.to - longest.from) / 1000).toFixed(1)} s (${iso(longest.from)}..${iso(longest.to)})`);
}
