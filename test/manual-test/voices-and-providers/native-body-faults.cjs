#!/usr/bin/env node
// NATIVE-BODY-FAULTS — drives the running app's own global `fetch` (the native
// expo/fetch whose buffered readers the #203 patch changes) against
// `provider-fault-server.cjs`, through CDP. This is a native-boundary probe,
// not a UI test: no touch is claimed.
//
// Control 1 (fetch identity) is a separate one-off: globalThis.fetch must be
// expo's winter fetch (async), and the object it returns must be an expo
// FetchResponse whose text()/arrayBuffer() call the native ExpoFetchModule
// AsyncFunctions (`super.text()` in FetchResponse.ts) — not an XHR/RN
// body-buffering wrapper. The global `Response` class is RN's whatwg-fetch
// polyfill by expo's design (runtime.native.ts installs only `fetch`).
//
// Run 2 (2026-10-17) varies ONLY the delivered prefix per the parent's
// steering: 8192 bytes before the cut, Content-Length 65536, cut at +1000 ms —
// a 200-byte prefix may stay buffered below URLSession, and run 1 (kept as
// boundary-01.txt) could not show responseReceivedAt before the cut. Every
// scenario records the stage times (fetchResolvedAt, readerCalledAt, and the
// rejection delta after the call) beside the verdict.
//
//   node test/manual-test/voices-and-providers/native-body-faults.cjs \
//     [METRO_URL=http://127.0.0.1:8093] [SERVER=http://127.0.0.1:8765]
//
// Prints one JSON line per result and EXPECT/SUMMARY lines; exit 0 only if
// every expectation held. Results accumulate in globalThis.__nbf.
const WebSocket = require('ws');

const metro = process.argv[2] ?? process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8093';
const base = process.argv[3] ?? 'http://127.0.0.1:8765';

const INSTALL = `(function () {
  globalThis.__nbf = { out: [] };
  globalThis.__nbfArm = function (name, make) {
    var start = Date.now();
    var stages = { start: start };
    Promise.resolve().then(make(stages)).then(
      function (v) { globalThis.__nbf.out.push(Object.assign({ name: name, ended: 'resolved', ms: Date.now() - start }, stages, { value: String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80) })); },
      function (e) { globalThis.__nbf.out.push(Object.assign({ name: name, ended: 'rejected', ms: Date.now() - start }, stages, { error: String(e && (e.message ?? e)).slice(0, 220) })); },
    );
    return 'armed:' + name;
  };
  return 'installed';
})()`;

const arm = (name, makeBody) =>
  `(function () { return globalThis.__nbfArm(${JSON.stringify(name)}, function (stages) { return (async function () { ${makeBody} }); }); })()`;
const count = `(function () { return globalThis.__nbf.out.length; })()`;
const all = `(function () { return JSON.stringify(globalThis.__nbf.out); })()`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let serial = 0;
let socket;
const pending = new Map();

function evaluate(expression, timeoutMs = 15_000) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP eval timed out (${timeoutMs} ms): ${expression.slice(0, 80)}`)); }, timeoutMs);
    pending.set(id, { resolve, reject: (e) => { clearTimeout(timer); reject(e); }, timer });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
}

const value = async (expression, timeoutMs) => {
  const reply = JSON.parse(await evaluate(expression, timeoutMs));
  if (reply.error || reply.exceptionDetails) throw new Error(JSON.stringify(reply.error ?? reply.exceptionDetails));
  return reply.result?.value;
};

(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then((r) => r.json());
  const device = process.env.OPENREADER_DEVICE;
  const targets = pages.filter((p) => p.appId === 'top.xujialiu.openreader' && (!device || p.deviceName === device));
  if (targets.length !== 1) throw new Error(`Expected one OpenReader debug target on ${metro}; found ${targets.length}`);
  const endpoint = new URL(targets[0].webSocketDebuggerUrl);
  const origin = `${endpoint.protocol === 'wss:' ? 'https:' : 'http:'}//${endpoint.host}`;
  socket = new WebSocket(endpoint.href, { origin });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (bytes) => {
    const message = JSON.parse(bytes.toString());
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(JSON.stringify(message.result ?? { error: message.error }));
  });

  console.log(await value(INSTALL));
  const results = new Map();
  const expectations = [];
  const expect = (name, check) => expectations.push({ name, check });

  const armAndGet = async (name, makeBody, deadlineMs) => {
    await value(arm(name, makeBody));
    const deadline = Date.now() + deadlineMs;
    for (;;) {
      const n = Number(await value(count));
      if (n > results.size) {
        const fresh = JSON.parse(await value(all)).slice(results.size);
        for (const one of fresh) { results.set(one.name, one); console.log(JSON.stringify(one)); }
      }
      if (results.has(name)) return results.get(name);
      if (Date.now() > deadline) throw new Error(`${name}: no result within ${deadlineMs} ms`);
      await sleep(250);
    }
  };

  const cutAt = 1000;
  const cutUrl = (path, prefix) => `${base}${path}?prefix=${prefix}&delay=${cutAt}`;

  /** Cut scenario: await fetch (recording fetchResolvedAt — must precede the
   * cut), then optionally delay, then the reader call (recording its time and
   * the rejection delta after the call). */
  const cutCase = (path, prefix, reader, delayMs) => `
    var r = await fetch(${JSON.stringify(cutUrl(path, prefix))});
    stages.fetchResolvedAt = Date.now() - stages.start;
    stages.ctype = r.headers.get('content-type');
    if (${delayMs}) await new Promise(function (res) { setTimeout(res, ${delayMs}); });
    stages.readerCalledAt = Date.now() - stages.start;
    var v = await r.${reader}();
    stages.readerDoneAt = Date.now() - stages.start;
    return typeof v === 'string' ? v.slice(0, 40) : (v.byteLength + ' bytes');`;

  // --- Control 2: 8192-byte prefix, cut at +1000 ms ---
  expect('p8k-text-immediate', (r) => r.ended === 'rejected' && r.fetchResolvedAt < cutAt && r.readerCalledAt < cutAt && r.ms < cutAt + 3000);
  await armAndGet('p8k-text-immediate', cutCase('/cut/text', 8192, 'text', 0), 30_000);
  expect('p8k-text-immediate-2', (r) => r.ended === 'rejected' && r.fetchResolvedAt < cutAt && r.ms < cutAt + 3000);
  await armAndGet('p8k-text-immediate-2', cutCase('/cut/text', 8192, 'text', 0), 30_000);
  expect('p8k-bytes-immediate', (r) => r.ended === 'rejected' && r.fetchResolvedAt < cutAt && r.ms < cutAt + 3000);
  await armAndGet('p8k-bytes-immediate', cutCase('/cut/bytes', 8192, 'arrayBuffer', 0), 30_000);
  expect('p8k-json-immediate', (r) => r.ended === 'rejected' && r.fetchResolvedAt < cutAt && r.ms < cutAt + 3000);
  await armAndGet('p8k-json-immediate', cutCase('/cut/json', 8192, 'json', 0), 30_000);

  // Consumption deliberately delayed until after the connection failed: the
  // reader is called ~1000 ms after the cut, and must reject promptly then.
  expect('p8k-text-delayed', (r) => r.ended === 'rejected' && r.fetchResolvedAt < cutAt && r.readerCalledAt >= cutAt + 500 && (r.ms - r.readerCalledAt) < 1500);
  await armAndGet('p8k-text-delayed', cutCase('/cut/text', 8192, 'text', cutAt + 1500), 30_000);
  expect('p8k-bytes-delayed', (r) => r.ended === 'rejected' && r.fetchResolvedAt < cutAt && r.readerCalledAt >= cutAt + 500 && (r.ms - r.readerCalledAt) < 1500);
  await armAndGet('p8k-bytes-delayed', cutCase('/cut/bytes', 8192, 'arrayBuffer', cutAt + 1500), 30_000);

  // The run-1 shape (200-byte prefix) rerun with the same 1000 ms cut, so the
  // prefix variation is the only difference between the two columns.
  expect('p200-text-immediate', (r) => r.ended === 'rejected' && r.ms < cutAt + 3000);
  await armAndGet('p200-text-immediate', cutCase('/cut/text', 200, 'text', 0), 30_000);

  // Stalled-prefix control: same 8192-byte prefix, no cut ever. fetch() must
  // resolve, text() must still be pending at +2 s (no failure → no error), and
  // the explicit abort at +3 s must be the exit, promptly.
  const stallCase = `
    var c = new AbortController();
    setTimeout(function () { c.abort(); }, 3000);
    var r = await fetch(${JSON.stringify(base + '/stall?prefix=8192')}, { signal: c.signal });
    stages.fetchResolvedAt = Date.now() - stages.start;
    var pending = true;
    var mark = r.text().then(function () { pending = false; return 'resolved'; }, function (e) { pending = false; return 'rejected: ' + String(e && (e.message ?? e)).slice(0, 120); });
    stages.readerCalledAt = Date.now() - stages.start;
    await new Promise(function (res) { setTimeout(res, 2000); });
    stages.stillPendingAt2s = pending;
    var end;
    try { end = await mark; } catch (e) { end = 'rejected: ' + String(e && (e.message ?? e)).slice(0, 120); }
    stages.end = end;
    return end;`;
  expect('p8k-stall-abort', (r) => r.ended === 'resolved' && r.fetchResolvedAt < cutAt && r.stillPendingAt2s === true && /rejected/.test(r.end ?? '') && r.ms >= 2500 && r.ms < 6000);
  await armAndGet('p8k-stall-abort', stallCase, 30_000);

  // --- complete controls (unchanged) ---
  expect('ok-text', (r) => r.ended === 'resolved' && /complete plain text/.test(r.value ?? ''));
  await armAndGet('ok-text', `return fetch(${JSON.stringify(base + '/ok/text')}).then(function (r) { return r.text(); });`, 15_000);
  expect('ok-json', (r) => r.ended === 'resolved' && /"answer":42/.test((r.value ?? '').replace(/\s+/g, '')));
  await armAndGet('ok-json', `return fetch(${JSON.stringify(base + '/ok/json')}).then(function (r) { return r.json(); });`, 15_000);
  expect('ok-bytes', (r) => r.ended === 'resolved');
  await armAndGet('ok-bytes', `return fetch(${JSON.stringify(base + '/ok/bytes')}).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return b.byteLength + ' bytes'; });`, 15_000);

  const failed = expectations.filter(({ name, check }) => { const r = results.get(name); return !r || !check(r); });
  for (const { name, check } of expectations) {
    const r = results.get(name);
    const held = r && check(r);
    console.log(`EXPECT ${held ? 'ok' : 'FAIL'} ${name}${r ? ` (${r.ended} total=${r.ms}ms fetchResolved=${r.fetchResolvedAt}ms readerCalled=${r.readerCalledAt}ms)` : ' (missing)'}`);
  }
  console.log(`SUMMARY ${expectations.length - failed.length}/${expectations.length} expectations held`);
  process.exitCode = failed.length ? 1 : 0;
  socket.close();
  await sleep(100);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
