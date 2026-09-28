#!/usr/bin/env node
// A generic walkthrough-harness sender, for ad hoc commands no dedicated
// script already covers (#71 batches 3/4 verification). Writes one JSON
// command to the app's own Documents/harness.json, with a fresh `seq`
// carried on from whatever is there (README Pitfalls, "Two harness commands
// written back to back run only the second" — so callers running several of
// these must sleep at least 300 ms between calls themselves).
//
//   node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"say"}'
//   node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{"do":"settings","patch":{"theme":"dark"}}'
//
// Prints the container's Documents path and the command actually written.
// Sends only; reading the answer back is still Metro's log (`HX …` lines) or
// a screenshot, exactly as every other script here does.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [device, json] = process.argv.slice(2);
if (!device || !json) {
  console.error('Usage: hx.cjs SIMULATOR_UDID JSON_COMMAND_WITHOUT_SEQ');
  process.exit(2);
}
let command;
try { command = JSON.parse(json); } catch (problem) {
  console.error(`Not valid JSON: ${problem.message}`);
  process.exit(2);
}
const documents = path.join(
  execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(),
  'Documents',
);
const harnessFile = path.join(documents, 'harness.json');
let seq = (() => {
  try { return Number(JSON.parse(fs.readFileSync(harnessFile, 'utf8')).seq) || 0; } catch { return 0; }
})();
seq += 1;
const body = { seq, ...command };
fs.writeFileSync(harnessFile, JSON.stringify(body));
console.log(`${harnessFile} <- ${JSON.stringify(body)}`);
