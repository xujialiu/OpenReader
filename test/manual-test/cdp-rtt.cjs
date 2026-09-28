#!/usr/bin/env node
// How long the app's JavaScript thread takes to answer: one debugger connection
// kept open, and `Runtime.evaluate("1")` sent every INTERVAL_MS, each answer's
// round trip printed as a line `RTT <unix ms> <ms>` (or `RTT <unix ms> timeout`
// after 10 s). A round trip waits for whatever the thread is doing, so it is
// the thread's responsiveness as a tap would meet it, plus the socket's few ms.
//
//   node test/manual-test/cdp-rtt.cjs SECONDS [INTERVAL_MS=3000]
//
// Leaves the app alone: it evaluates a constant. OPENREADER_METRO (127.0.0.1,
// not localhost: Pitfalls, cdp.md) and OPENREADER_DEVICE as for cdp.cjs.
const WebSocket = require('ws');
const [seconds, interval = '3000'] = process.argv.slice(2);
if (!(Number(seconds) > 0)) { console.error('Usage: cdp-rtt.cjs SECONDS [INTERVAL_MS]'); process.exit(2); }
const metro = process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081';
(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then((response) => response.json());
  const device = process.env.OPENREADER_DEVICE;
  const targets = pages.filter((page) => page.appId === 'top.xujialiu.openreader' && (!device || page.deviceName === device));
  if (targets.length !== 1) throw new Error(`Expected one OpenReader debug target; found ${targets.length}`);
  const endpoint = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(endpoint.href, { origin: `http://${endpoint.host}` });
  const pending = new Map();
  let id = 0;
  socket.on('message', (bytes) => {
    const message = JSON.parse(bytes.toString());
    const sent = pending.get(message.id);
    if (sent === undefined) return;
    pending.delete(message.id);
    console.log(`RTT ${sent} ${Date.now() - sent}`);
  });
  socket.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  await new Promise((resolve) => socket.on('open', resolve));
  const end = Date.now() + Number(seconds) * 1000;
  const timer = setInterval(() => {
    const now = Date.now();
    pending.forEach((sent, key) => { if (now - sent > 10000) { pending.delete(key); console.log(`RTT ${sent} timeout`); } });
    if (now >= end) { clearInterval(timer); socket.close(); return; }
    pending.set(++id, now);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: '1', returnByValue: true } }));
  }, Number(interval));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
