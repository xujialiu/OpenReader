#!/usr/bin/env node
// Samples the offline runtime's download window through one CDP connection,
// every INTERVAL ms (default 250), until the task leaves `downloading`/`preparing`
// for a settled state or STOP_AFTER seconds pass. One JSON line per sample:
//   { t, v, state, writing, current, occupied }
// `writing` is #311's task.writing (an array), `current` the pre-#311 task.current
// (baseline), read from the same task. Also polls whether the app's bundle still
// answers, so a relaunch mid-sample is visible as a gap.
//
//   node download-window-sampler.cjs OUT.jsonl DOCUMENT_ID PROVIDER VOICE [INTERVAL_MS] [STOP_AFTER_S] [METRO_URL]
//
// Stops by itself when the task reads done/blocked/paused/interrupted on three
// consecutive samples. SIGINT stops cleanly. Nothing is evaluated during a
// bundle reload: a failed eval is recorded as { t, error } and retried.
const { readFileSync, writeFileSync, openSync, appendFileSync, closeSync } = require('node:fs');
// ws ships with Metro in this repository's node_modules.
const WebSocket = require('ws');

const args = process.argv.slice(2);
const [out, documentId, provider, voice] = args;
const interval = Number(args[4] ?? 250);
const stopAfter = Number(args[5] ?? 1200) * 1000;
const metro = args[6] ?? process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081';
if (!out || !documentId || !provider || !voice) {
  console.error('Usage: download-window-sampler.cjs OUT.jsonl DOCUMENT_ID PROVIDER VOICE [INTERVAL_MS=250] [STOP_AFTER_S=1200] [METRO_URL]');
  process.exit(2);
}

// Loaded by the module's own name, as download-chapter.cjs does. One expression,
// evaluated per sample; `forEach` because --eval code is compiled without Babel.
const runtime = `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === 'src/offline/runtime.ts') found = __r(id); }); if (!found) throw Error('runtime'); return found; })()`;
const version = `(() => { let v; __r.getModules().forEach((m, id) => { if (m.verboseName === 'app-version.ts') v = __r(id).APP_VERSION; }); return v ?? '?'; })()`;
const expression = `(() => { const a = ${JSON.stringify({ documentId, provider, voice })}; const r = ${runtime}; const t = r.downloadTasks(a.documentId).find(t => t.voice.provider === a.provider && t.voice.voice === a.voice); return JSON.stringify({ v: ${version}, state: t ? t.state : null, writing: t ? (t.writing ?? null) : null, current: t ? (t.current ?? null) : null, occupied: r.occupied(a.documentId) }); })()`
;

(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then((r) => r.json());
  const targets = pages.filter((page) => page.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error(`Expected one OpenReader debug target; found ${targets.length}`);
  const endpoint = new URL(targets[0].webSocketDebuggerUrl);
  const origin = `${endpoint.protocol === 'wss:' ? 'https:' : 'http:'}//${endpoint.host}`;
  const socket = new WebSocket(endpoint.href, { origin });
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });

  const fd = openSync(out, 'a');
  let serial = 0;
  const ask = () => new Promise((resolve) => {
    const id = ++serial;
    const onMessage = (bytes) => {
      const message = JSON.parse(bytes.toString());
      if (message.id !== id) return;
      socket.off('message', onMessage);
      if (message.error || message.result?.exceptionDetails) return resolve({ error: JSON.stringify(message.error ?? message.result.exceptionDetails).slice(0, 200) });
      resolve(JSON.parse(message.result.result.value));
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    setTimeout(() => { socket.off('message', onMessage); resolve({ error: 'timeout' }); }, 4000);
  });

  let settled = 0;
  let seenRunning = false;
  const started = Date.now();
  const timer = setInterval(async () => {
    const t = Date.now();
    const sample = { t, ...(await ask()) };
    appendFileSync(fd, JSON.stringify(sample) + '\n');
    // Only a settled task state stops the sampler; `null` (no task yet, before
    // the enqueue registers) must never count, or the sampler quits at once.
    // A task already `done` from an earlier run of the same voice does not
    // count either until this run has been seen running.
    if (sample.state && !['done', 'blocked', 'paused', 'interrupted'].includes(sample.state)) seenRunning = true;
    if (seenRunning && ['done', 'blocked', 'paused', 'interrupted'].includes(sample.state)) settled += 1;
    else if (!seenRunning) settled = 0;
    if (settled >= 3 || t - started > stopAfter) {
      clearInterval(timer);
      appendFileSync(fd, JSON.stringify({ t: Date.now(), stopped: true }) + '\n');
      closeSync(fd);
      socket.close();
      process.exit(0);
    }
  }, interval);
  process.on('SIGINT', () => { clearInterval(timer); appendFileSync(fd, JSON.stringify({ t: Date.now(), stopped: 'sigint' }) + '\n'); closeSync(fd); socket.close(); process.exit(0); });
})().catch((error) => { console.error(error.message); process.exit(1); });
