#!/usr/bin/env node
// What the app's JavaScript thread was doing: Hermes's sampling profiler over
// one debugger connection, started before FILE is evaluated and stopped
// SECONDS later. Writes the raw CDP profile to OUT.json and prints, for the
// busiest stretch (or for the window given), the functions with the most
// samples, by self time and with their callers included.
//
//   node test/manual-test/kit/cdp-profile.cjs FILE SECONDS OUT.json
//   node test/manual-test/kit/cdp-profile.cjs --read OUT.json [FROM_UNIX_MS UNTIL_UNIX_MS]
//
// FILE is evaluated as cdp.cjs --eval does; its result is printed. The
// profiler slows the thread a little, so a time measured under it is an upper
// bound. OPENREADER_METRO (127.0.0.1, not localhost: Pitfalls, cdp.md) and
// OPENREADER_DEVICE as for cdp.cjs.
const { readFileSync, writeFileSync } = require('node:fs');
const args = process.argv.slice(2);

function summarise(profile, from, until) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  profile.nodes.forEach((n) => (n.children || []).forEach((c) => parent.set(c, n.id)));
  // Sample times: startTime and timeDeltas are microseconds; wallStart maps them to Unix ms.
  let t = profile.startTime;
  const times = profile.timeDeltas.map((d) => (t += d));
  const toWall = (us) => profile.wallStart + (us - profile.startTime) / 1000;
  const name = (n) => `${n.callFrame.functionName || '(anonymous)'} ${String(n.callFrame.url).replace(/^.*\//, '').slice(0, 40)}:${n.callFrame.lineNumber}`;
  let window = [from, until];
  if (from === undefined) {
    // The busiest second: most samples whose top frame is not idle.
    const busy = profile.samples.map((s, i) => [toWall(times[i]), !/\(idle\)|\(program\)|\(root\)/.test(nodes.get(s).callFrame.functionName)]);
    let best = [0, 0];
    for (let i = 0, j = 0; i < busy.length; i++) {
      while (busy[j][0] < busy[i][0] - 1000) j++;
      const n = busy.slice(j, i + 1).filter((b) => b[1]).length;
      if (n > best[0]) best = [n, busy[j][0]];
    }
    window = [best[1], best[1] + 1000];
  }
  const self = new Map(), total = new Map();
  let count = 0;
  profile.samples.forEach((s, i) => {
    const wall = toWall(times[i]);
    if (wall < window[0] || wall > window[1]) return;
    count++;
    const leaf = nodes.get(s);
    self.set(name(leaf), (self.get(name(leaf)) || 0) + 1);
    const seen = new Set();
    for (let id = s; id !== undefined; id = parent.get(id)) {
      const key = name(nodes.get(id));
      if (!seen.has(key)) { seen.add(key); total.set(key, (total.get(key) || 0) + 1); }
    }
  });
  const iso = (ms) => new Date(ms).toISOString().slice(11, 23);
  console.log(`window ${iso(window[0])}..${iso(window[1])}: ${count} samples`);
  console.log('self:');
  [...self].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log(`  ${v}\t${k}`));
  console.log('with callers:');
  [...total].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(`  ${v}\t${k}`));
}

if (args[0] === '--read') {
  const profile = JSON.parse(readFileSync(args[1], 'utf8'));
  summarise(profile, args[2] ? Number(args[2]) : undefined, args[3] ? Number(args[3]) : undefined);
  process.exit(0);
}
const [file, seconds, out] = args;
if (!file || !(Number(seconds) > 0) || !out) { console.error('Usage: cdp-profile.cjs FILE SECONDS OUT.json | --read OUT.json [FROM UNTIL]'); process.exit(2); }
const WebSocket = require('ws');
const metro = process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081';
(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then((response) => response.json());
  const device = process.env.OPENREADER_DEVICE;
  const targets = pages.filter((page) => page.appId === 'top.xujialiu.openreader' && (!device || page.deviceName === device));
  if (targets.length !== 1) throw new Error(`Expected one OpenReader debug target; found ${targets.length}`);
  const endpoint = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(endpoint.href, { origin: `http://${endpoint.host}`, maxPayload: 1 << 30 });
  let id = 0;
  const waiting = new Map();
  socket.on('message', (bytes) => {
    const message = JSON.parse(bytes.toString());
    const done = waiting.get(message.id);
    if (done) { waiting.delete(message.id); done(message); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { waiting.set(++id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });
  await send('Profiler.enable');
  const started = await send('Profiler.start');
  if (started.error) throw new Error(JSON.stringify(started.error));
  const wallStart = Date.now();
  const answer = await send('Runtime.evaluate', { expression: readFileSync(file, 'utf8'), returnByValue: true });
  console.log(`evaluated at ${new Date(wallStart).toISOString()}: ${JSON.stringify(answer.result?.result?.value ?? answer.result ?? answer.error)}`);
  await new Promise((resolve) => setTimeout(resolve, Number(seconds) * 1000));
  const stopped = await send('Profiler.stop');
  if (!stopped.result?.profile) throw new Error(JSON.stringify(stopped.error ?? stopped).slice(0, 300));
  // Hermes's startTime is its own clock; the first sample is taken as the moment profiling began.
  const profile = { ...stopped.result.profile, wallStart };
  writeFileSync(out, JSON.stringify(profile));
  socket.close();
  console.log(`samples ${profile.samples.length}, written ${out}`);
  summarise(profile);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
