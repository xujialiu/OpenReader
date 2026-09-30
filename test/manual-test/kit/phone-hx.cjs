#!/usr/bin/env node
// One walkthrough-harness command to the owner's iPhone, and its answer read
// back out of the phone's Debug Log (docs/debug-on-iphone.md). The phone's
// counterpart of hx.cjs, which reaches only a simulator.
//
//   node test/manual-test/kit/phone-hx.cjs IPHONE_UDID '{"do":"navstate"}'
//   node test/manual-test/kit/phone-hx.cjs IPHONE_UDID '{"do":"js"}' --code-file test/manual-test/kit/probes/renderer-state.js
//   node test/manual-test/kit/phone-hx.cjs IPHONE_UDID --restore
//
// 1. Reads the phone's Documents/harness.json for its `seq` and writes the
//    command with the next one (the poll runs a command whose seq it has not
//    seen). `--code-file` makes it a `js` command with that file as its body;
//    the body is parsed here first, so a syntax error never reaches the phone.
// 2. Waits --wait seconds (default 6: the poll is 250 ms, the Debug Log is
//    appended at most 2 s after a line, and the copy itself takes a moment),
//    copies the Debug Log off with debug-log.py, and prints every line stamped
//    from one second before the send, less the reading's periodic `[hx]`
//    status line (--status keeps it).
// 3. When something answered, puts `{"do":"noop"}` back in harness.json with
//    the seq after, because the harness runs whatever the file holds once at
//    every launch (pitfalls/physical-iphone.md). --keep leaves the command.
//    Nothing answering leaves the command where it is and says why that
//    happens; --restore replaces it later.
//
// Needs a build with Debug Mode (the harness and the Debug Log exist only in
// one) and devicectl's reach (cable or Wi-Fi). The command runs only while the
// app's JavaScript runs: in the foreground, or in the background while a
// Reading plays or a download runs. `js` and `say` need the Reader open.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BUNDLE = 'top.xujialiu.openreader';
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const [, value] = args.splice(at, 2);
  return value;
};
const has = (name) => {
  const at = args.indexOf(name);
  if (at < 0) return false;
  args.splice(at, 1);
  return true;
};
const codeFile = flag('--code-file');
const wait = Number(flag('--wait') ?? 6);
const keep = has('--keep');
const status = has('--status');
const restoreOnly = has('--restore');
const [device, json] = args;
if (!device || (!json && !restoreOnly)) {
  console.error('Usage: phone-hx.cjs IPHONE_UDID JSON_COMMAND [--code-file FILE] [--wait S] [--keep] [--status]\n       phone-hx.cjs IPHONE_UDID --restore');
  process.exit(2);
}

const work = fs.mkdtempSync('/tmp/openreader-phone-hx-');
const container = ['--device', device, '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE];
const devicectl = (...rest) => execFileSync('xcrun', ['devicectl', 'device', ...rest], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

function currentSeq() {
  const local = path.join(work, 'harness-before.json');
  try {
    devicectl('copy', 'from', ...container, '--source', 'Documents/harness.json', '--destination', local);
    return Number(JSON.parse(fs.readFileSync(local, 'utf8')).seq) || 0;
  } catch {
    return 0; // No file yet: any seq is new to the poll.
  }
}

function put(body) {
  const local = path.join(work, `harness-${body.seq}.json`);
  fs.writeFileSync(local, JSON.stringify(body));
  devicectl('copy', 'to', ...container, '--source', local, '--destination', 'Documents/harness.json');
}

let seq = currentSeq();
if (restoreOnly) {
  put({ seq: seq + 1, do: 'noop' });
  console.log(`harness.json <- {"seq":${seq + 1},"do":"noop"}`);
  process.exit(0);
}

let command;
try {
  command = JSON.parse(json);
} catch (problem) {
  console.error(`Not valid JSON: ${problem.message}`);
  process.exit(2);
}
if (codeFile) {
  command.do = 'js';
  command.code = fs.readFileSync(codeFile, 'utf8');
}
if (command.do === 'js') {
  try {
    new Function(String(command.code));
  } catch (problem) {
    console.error(`The probe does not parse: ${problem.message}`);
    process.exit(2);
  }
}

seq += 1;
const sentAt = Date.now() - 1000;
put({ ...command, seq });
console.log(`sent seq ${seq}: ${JSON.stringify(command).slice(0, 160)}`);
execFileSync('sleep', [String(wait)]);

const out = path.join(work, 'log');
execFileSync('python3', [path.join(__dirname, 'debug-log.py'), device, out], { stdio: ['ignore', 'ignore', 'inherit'] });
const STAMP = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d\.\d{3}) ([+-]\d\d:\d\d) \[([a-z-]+)\] (.*)$/;
const answers = [];
for (const name of fs.readdirSync(path.join(out, 'debug-log')).filter((n) => /^debug-log-\d{6}\.txt$/.test(n)).sort()) {
  for (const line of fs.readFileSync(path.join(out, 'debug-log', name), 'utf8').split('\n')) {
    const found = STAMP.exec(line);
    if (!found || Date.parse(`${found[1]}T${found[2]}${found[3]}`) < sentAt) continue;
    if (!status && found[4] === 'hx' && found[5].startsWith('playing=')) continue;
    answers.push(line);
  }
}
for (const line of answers) console.log(line);
console.log(`Debug Log copy: ${out}`);

if (answers.length === 0) {
  console.log(
    `no line since the send after ${wait} s. The app is not running JavaScript (in the background with nothing playing or ` +
      `downloading), or the screen that answers this command is not open. harness.json still holds seq ${seq}; it runs when ` +
      'the app next polls, and once at every launch. `--restore` replaces it.',
  );
  process.exit(1);
}
if (!keep) {
  put({ seq: seq + 1, do: 'noop' });
  console.log(`harness.json back to {"seq":${seq + 1},"do":"noop"}`);
}
