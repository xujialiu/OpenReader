#!/usr/bin/env node
/* global __dirname */
// #351 final-result extension of library-and-reader/pending-lookup-fold.cjs.
// Reuses the REAL response gate and existing device-filtered CDP client. Run
// inside one ios_guard phase, alongside an attach-only native long press.
// Unlike the transport-only coordinator, retain the gate until the parsed
// state AND native assertion finish, then take the final duplicate count.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { lookupReceipt } = require('./duo-lookup-receipt.cjs');
const run = promisify(execFile);
const [deviceName, metro, foldScript, nativeScript, output] = process.argv.slice(2);
if (!deviceName || !metro || !foldScript || !nativeScript || !output) {
  console.error('Usage: duo-pending-lookup.cjs DEVICE_NAME METRO_URL VERIFIED_FOLD_SCRIPT NATIVE_RESULT_SCRIPT NEW_OUTPUT_DIR');
  process.exit(2);
}
const kit = path.resolve(__dirname, '../kit');
const lookup = path.resolve(__dirname, '../library-and-reader');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { status: 'CONTROL_INCOMPLETE', deviceName, events: [], startedAt: Date.now() };
const env = { ...process.env, OPENREADER_DEVICE: deviceName, OPENREADER_METRO: metro };
const directory = path.resolve(output);
fs.mkdirSync(directory, { recursive: false }); // Never overwrite an earlier attempt.
const dimensionsFile = path.join(directory, 'window-expression.js');
fs.writeFileSync(dimensionsFile, `(() => {
  let dimensions;
  __r.getModules().forEach((module,id) => {
    if (module.verboseName && /\\/Utilities\\/Dimensions\\.js$/.test(module.verboseName)) {
      const exported=__r(id); dimensions=exported.default||exported;
    }
  });
  if (!dimensions) throw Error('Dimensions module unavailable');
  return dimensions.get('window');
})()`);
async function evaluate(file) {
  const result = await run(process.execPath, [path.join(kit, 'cdp.cjs'), '--eval', file, metro], { env, timeout: 4000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout).value;
}
const state = () => evaluate(path.join(__dirname, 'DuoAcceptanceLookupState.js'));
const gateState = () => evaluate(path.join(lookup, 'lookup-fetch-gate-state.js'));
async function action(script, label, timeout, args = []) {
  report.events.push({ action: label + '-start', at: Date.now() });
  const result = await run('bash', [path.resolve(script), ...args], { env, timeout, maxBuffer: 4 * 1024 * 1024 });
  fs.writeFileSync(path.join(directory, label + '.log'), result.stdout + result.stderr);
  report.events.push({ action: label + '-complete', at: Date.now() });
  return result;
}
(async () => {
  let installed = false;
  try {
    const initial = await state();
    if (initial.selection || initial.gate || initial.traffic) throw new Error('Close the old lookup and restore all fetch observers first');
    report.beforeWindow = await evaluate(dimensionsFile);
    await evaluate(path.join(lookup, 'lookup-fetch-gate-install.js'));
    installed = true;
    fs.writeFileSync(path.join(directory, 'gate.ready'), JSON.stringify({ readyAt: Date.now(), deviceName }));
    const controlDeadline = Date.now() + 120000; // Cold native press setup, not the request deadline.
    while (Date.now() < controlDeadline) {
      report.beforeFold = await gateState();
      if (report.beforeFold.aborted || report.beforeFold.count > 1) throw new Error('Invalid initial request control');
      if (report.beforeFold.count === 1 && report.beforeFold.waiting) break;
      await delay(80);
    }
    const before = report.beforeFold;
    if (!before?.waiting || before.count !== 1) throw new Error('No real held response inside control budget');
    const startedAt = before.requests[0].startedAt;
    if (before.now - startedAt > 2500) throw new Error('Response already too old for the timed fold control');
    await action(foldScript, 'actual-fold', 6500);
    const geometryDeadline = Date.now() + 2000;
    do {
      report.afterWindow = await evaluate(dimensionsFile);
      if (report.afterWindow.width !== report.beforeWindow.width || report.afterWindow.height !== report.beforeWindow.height) break;
      await delay(80);
    } while (Date.now() < geometryDeadline);
    if (report.afterWindow.width === report.beforeWindow.width && report.afterWindow.height === report.beforeWindow.height) {
      throw new Error('No actual app window change; input is not an accepted fold');
    }
    report.afterFold = await gateState();
    if (report.afterFold.now - startedAt >= 12000 || report.afterFold.aborted || report.afterFold.count !== 1 || !report.afterFold.waiting) {
      throw new Error('Invalid/late held-response control after actual fold');
    }
    report.release = await evaluate(path.join(lookup, 'lookup-fetch-gate-release.js'));
    if (report.release.released !== 1) throw new Error('The actual response was not released');
    for (;;) {
      const snapshot = await state();
      report.finalParsed = snapshot;
      if (snapshot.gate?.count !== 1 || snapshot.gate.aborted) throw new Error('Duplicate/cancelled lookup after timely release; inspect retained state');
      if (snapshot.observedAt - startedAt >= 15000) throw new Error('No parsed-result observation inside the actual lookup deadline');
      if (!snapshot.loading && !snapshot.selection?.selecting) {
        report.receipt = lookupReceipt(snapshot, 'duo351-' + report.startedAt);
        break;
      }
      await delay(80);
    }
    const config = path.join(directory, 'native-result.json');
    fs.writeFileSync(config, JSON.stringify(report.receipt, null, 2));
    // Prebuild the native probe before this control. It must attach, not
    // relaunch/scroll/change the query; arg1 is its exact --mode config path.
    const native = await action(nativeScript, 'native-visible-definition', 90000, [config]);
    const nativeLog = native.stdout + native.stderr;
    if (!nativeLog.includes(`DuoAcceptanceLookup-v1 runID=${report.receipt.runID} `) ||
        !new RegExp(`DuoAcceptanceLookup native-definition-observedAt=[0-9.]+ runID=${report.receipt.runID} `).test(nativeLog) ||
        !/Executed [1-9][0-9]* test.*, with 0 failures/.test(nativeLog) || /Executed .*with [1-9][0-9]* failures/.test(nativeLog)) {
      throw new Error('Native helper must echo this run\'s executed definition markers and zero-failure XCTest log, not merely exit zero');
    }
    report.afterNative = await state();
    if (report.afterNative.gate?.count !== 1 || report.afterNative.gate.aborted ||
        report.afterNative.loading || report.afterNative.error || report.afterNative.selection?.selecting ||
        report.afterNative.selection?.mode !== 'dictionary' || report.afterNative.selection?.text !== report.receipt.query ||
        report.afterNative.result?.text !== report.finalParsed.result.text) {
      throw new Error('Lookup task/count changed before the post-native observation');
    }
    report.status = 'TRANSPORT_PARSED_NATIVE_ASSERTION_COMPLETE_VISUAL_REVIEW_PENDING';
    report.limit = 'Review the actual active-display screenshot for the definition excerpt; a native tree/hit-test alone cannot prove visible pixels. No issue closure follows automatically.';
  } catch (error) {
    report.error = error.message;
    if (error.stdout || error.stderr) fs.writeFileSync(path.join(directory, 'failed-action.log'), String(error.stdout || '') + String(error.stderr || ''));
    process.exitCode = 1;
  } finally {
    if (installed) {
      try { report.cleanup = await evaluate(path.join(lookup, 'lookup-fetch-gate-restore.js')); }
      catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
    }
    report.endedAt = Date.now();
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, error: report.error, output: directory }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
