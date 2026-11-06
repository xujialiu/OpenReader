#!/usr/bin/env node
/* global __dirname */
// Run INSIDE ios_guard.py alongside a joined, attach-only long-press probe.
// Start this coordinator first; OUTPUT.ready means the held-response gate is
// installed. Then start the native press. Do not wait for XCTest result export
// before folding: the app's real 15-second request deadline is already running.
// FOLD_SCRIPT must verify the owned Device Hub window and perform one genuine
// closed->inner pose change. It must not relaunch the app or mutate app state.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const WebSocket = require('ws');
const run = promisify(execFile);
const [device, metro, foldScript, output] = process.argv.slice(2);
if (!device || !metro || !foldScript || !output) {
  console.error('Usage: pending-lookup-fold.cjs DEVICE_NAME METRO_URL FOLD_SCRIPT OUTPUT_JSON');
  process.exit(2);
}
if (fs.existsSync(output) || fs.existsSync(`${output}.ready`)) throw new Error('Use a new output path; preserve prior attempts');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stateExpression = fs.readFileSync(path.join(__dirname, 'lookup-fetch-gate-state.js'), 'utf8');
const dimensionsExpression = `(() => {
  let dimensions;
  __r.getModules().forEach((module, id) => {
    if (module.verboseName && /\\/Utilities\\/Dimensions\\.js$/.test(module.verboseName)) {
      const exported = __r(id); dimensions = exported.default || exported;
    }
  });
  if (!dimensions || typeof dimensions.get !== 'function') throw new Error('RN Dimensions module unavailable');
  return dimensions.get('window');
})()`;

(async () => {
  const report = { device, startedAt: Date.now(), events: [], status: 'incomplete' };
  let socket;
  let evaluate;
  let installed = false;
  const awaiting = new Map();
  let serial = 0;
  try {
    const pages = await fetch(new URL('/json/list', metro), { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    const targets = pages.filter(p => p.appId === 'top.xujialiu.openreader' && p.deviceName === device);
    if (targets.length !== 1) throw new Error(`Expected one exact device target; got ${targets.length}`);
    const endpoint = new URL(targets[0].webSocketDebuggerUrl);
    socket = new WebSocket(endpoint.href, { origin: `${endpoint.protocol === 'wss:' ? 'https:' : 'http:'}//${endpoint.host}` });
    socket.on('message', bytes => {
      const answer = JSON.parse(bytes.toString());
      const pending = awaiting.get(answer.id);
      if (!pending) return;
      awaiting.delete(answer.id); clearTimeout(pending.timer);
      if (answer.error || answer.result?.exceptionDetails) pending.reject(new Error(JSON.stringify(answer.error || answer.result.exceptionDetails)));
      else pending.resolve(answer.result.result.value);
    });
    socket.on('close', () => {
      for (const pending of awaiting.values()) { clearTimeout(pending.timer); pending.reject(new Error('App debugger disconnected')); }
      awaiting.clear();
    });
    // Keep a listener after open as well; a transport error must not leave the gate installed silently.
    socket.on('error', error => {
      for (const pending of awaiting.values()) { clearTimeout(pending.timer); pending.reject(error); }
      awaiting.clear();
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP open deadline')), 5000);
      socket.once('open', () => { clearTimeout(timeout); resolve(); });
      socket.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    evaluate = expression => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { awaiting.delete(id); reject(new Error('CDP evaluation deadline')); }, 1500);
      awaiting.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    report.beforeWindow = await evaluate(dimensionsExpression);
    await evaluate(fs.readFileSync(path.join(__dirname, 'lookup-fetch-gate-install.js'), 'utf8'));
    installed = true;
    fs.writeFileSync(`${output}.ready`, JSON.stringify({ readyAt: Date.now(), device }));
    const waitUntil = Date.now() + 120000; // cold probe setup, NOT a lookup deadline extension
    let held;
    while (Date.now() < waitUntil) {
      const state = await evaluate(stateExpression);
      if (state.count > 1 || state.aborted) throw new Error(`Invalid pre-fold control: ${JSON.stringify(state)}`);
      if (state.count === 1 && state.waiting) { held = state; break; }
      await delay(40);
    }
    if (!held) throw new Error('No real held lookup response within the control budget');
    report.beforeFold = held;
    const requestedAt = held.requests[0].startedAt;
    if (held.now - requestedAt > 2500) throw new Error('Held response arrived too late for a valid fold/release control');
    report.events.push({ action: 'fold-start', at: Date.now() });
    // One actual system action, under the caller's shared admission guard.
    await run('bash', [path.resolve(foldScript)], { timeout: 6500, maxBuffer: 1024 * 1024 });
    report.events.push({ action: 'fold-command-complete', at: Date.now() });
    const geometryDeadline = Date.now() + 2000;
    while (Date.now() < geometryDeadline) {
      report.afterWindow = await evaluate(dimensionsExpression);
      if (report.afterWindow.width !== report.beforeWindow.width || report.afterWindow.height !== report.beforeWindow.height) break;
      await delay(40);
    }
    if (report.afterWindow.width === report.beforeWindow.width && report.afterWindow.height === report.beforeWindow.height) {
      throw new Error('No actual app window change after fold command; not a fold-continuity result');
    }
    await delay(200); // let the layout's React effects run, without waiting on XCTest export
    report.afterFold = await evaluate(stateExpression);
    // Check timing FIRST: a late abort must never be called a fold defect.
    if (report.afterFold.now - requestedAt >= 12000) throw new Error('Invalid control: exceeded the pre-timeout release budget');
    if (report.afterFold.aborted || report.afterFold.count !== 1 || !report.afterFold.waiting) {
      throw new Error(`Held response changed during a timely geometry control; cause requires audit: ${JSON.stringify(report.afterFold)}`);
    }
    report.release = await evaluate(fs.readFileSync(path.join(__dirname, 'lookup-fetch-gate-release.js'), 'utf8'));
    if (report.release.released !== 1 || report.release.aborted) throw new Error('The response was not released successfully');
    await delay(500);
    report.afterRelease = await evaluate(stateExpression);
    if (report.afterRelease.count !== 1 || report.afterRelease.aborted) throw new Error('Duplicate request or cancellation after release');
    report.status = 'response-delivered-across-window-change';
    report.limit = 'Caller must still assert the selected text and actual result in the native lookup Drawer.';
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    if (installed && evaluate && socket?.readyState === WebSocket.OPEN) {
      try { report.cleanup = await evaluate(fs.readFileSync(path.join(__dirname, 'lookup-fetch-gate-restore.js'), 'utf8')); }
      catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
    }
    if (socket) socket.close();
    report.endedAt = Date.now();
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, error: report.error, output }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
