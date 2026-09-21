#!/usr/bin/env node
// Photograph the voice sheet while it is still asking for the Voices (#24, #28).
//
//   [VIDEO=1] node test/manual-test/voice-sheet-loading.cjs SIMULATOR_UDID METRO_LOG DOCUMENT_ID NEW_OUT_DIR [SHOTS]
//
// A cold launch with the walkthrough harness's `open` for DOCUMENT_ID already in
// `harness.json`; `voicesheet` the moment the reader's first `HX playing=` line
// reaches METRO_LOG (the file this worktree's Metro writes to); then SHOTS
// screenshots (default 10). `voicelist` goes out once the sheet command has been
// read, so the log says whether Fish was still being asked during the burst. It
// then waits for the listing to finish, photographs the loaded sheet, closes the
// sheet and removes `harness.json`. VIDEO=1 also records the screen to
// NEW_OUT_DIR/sheet.mp4, from before the launch to the loaded sheet: the loading
// state can last less than a second, and one screenshot takes up to one.
//
// Harness commands, not touches. Needs Fish enabled with its key and the
// Document in the Library. Never plays.
'use strict';
const { execFileSync, spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');

const [udid, metroLog, documentId, out, shotsArg] = process.argv.slice(2);
if (!udid || !metroLog || !documentId || !out) {
  console.error('Usage: [VIDEO=1] node test/manual-test/voice-sheet-loading.cjs SIMULATOR_UDID METRO_LOG DOCUMENT_ID NEW_OUT_DIR [SHOTS]');
  process.exit(2);
}
if (fs.existsSync(out) && fs.readdirSync(out).length) {
  console.error('Use a new output directory');
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const shots = Number(shotsArg ?? 10);
const bundle = 'top.xujialiu.openreader';
const data = execFileSync('xcrun', ['simctl', 'get_app_container', udid, bundle, 'data']).toString().trim();
const harness = path.join(data, 'Documents', 'harness.json');

let t0 = Date.now();
const at = () => `+${((Date.now() - t0) / 1000).toFixed(2)} s`;
let seq = (Math.floor(Date.now() / 1000) % 1_000_000) * 10;
function put(command) {
  seq += 1;
  // Written whole and renamed into place, so a poll never reads half a file.
  fs.writeFileSync(`${harness}.tmp`, JSON.stringify({ seq, ...command }));
  fs.renameSync(`${harness}.tmp`, harness);
  console.log(`${at()} put ${JSON.stringify({ seq, ...command })}`);
}
function shot(name) {
  const began = at();
  spawnSync('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(out, `${name}.png`)], { stdio: 'ignore' });
  console.log(`${began}..${at()} shot ${name}`);
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
function logSince(offset) {
  const size = fs.statSync(metroLog).size;
  if (size <= offset) return '';
  const fd = fs.openSync(metroLog, 'r');
  const buffer = Buffer.alloc(size - offset);
  fs.readSync(fd, buffer, 0, buffer.length, offset);
  fs.closeSync(fd);
  return buffer.toString();
}
async function waitFor(pattern, offset, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const line = logSince(offset).split('\n').find((one) => pattern.test(one));
    if (line) return line;
    await sleep(50);
  }
  return null;
}

async function main() {
  let recorder = null;
  let recorderExit = null;
  if (process.env.VIDEO === '1') {
    const errors = path.join(out, 'record.log');
    recorder = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', path.join(out, 'sheet.mp4')], {
      stdio: ['ignore', 'ignore', fs.openSync(errors, 'w')],
    });
    recorderExit = new Promise((done) => recorder.on('exit', done));
    const until = Date.now() + 10_000;
    while (Date.now() < until && !fs.readFileSync(errors, 'utf8').includes('Recording started')) await sleep(50);
    console.log(`recording: ${fs.readFileSync(errors, 'utf8').trim() || 'no word from simctl'}`);
  }
  try {
    spawnSync('xcrun', ['simctl', 'terminate', udid, bundle], { stdio: 'ignore' });
    put({ do: 'open', id: documentId });
    const mark = fs.statSync(metroLog).size;
    t0 = Date.now();
    execFileSync('xcrun', ['simctl', 'launch', udid, bundle], { stdio: 'ignore' });
    console.log(`${at()} launched`);

    let first = await waitFor(/HX playing=/, mark, 12_000);
    if (!first) {
      // The shell's first poll can come before navigation is ready, and then `open` is spent doing nothing.
      put({ do: 'open', id: documentId });
      first = await waitFor(/HX playing=/, mark, 12_000);
    }
    if (!first) throw new Error('no reader logged');
    console.log(`${at()} reader: ${first.trim().slice(0, 120)}`);
    put({ do: 'voicesheet', on: true });
    const sheetAt = Date.now();
    let asked = false;
    for (let n = 1; n <= shots; n++) {
      shot(`loading-${String(n).padStart(2, '0')}`);
      // Two polls after the sheet command, so `voicelist` does not replace it unread.
      if (!asked && Date.now() - sheetAt >= 600) {
        put({ do: 'voicelist', provider: 'fish', n: 1 });
        asked = true;
      }
    }
    if (!asked) {
      await sleep(Math.max(0, 600 - (Date.now() - sheetAt)));
      put({ do: 'voicelist', provider: 'fish', n: 1 });
    }
    const answer = await waitFor(/HX voicelist fish/, mark, 5_000);
    console.log(`${at()} ${answer ? answer.trim() : 'no voicelist answer'}`);

    // Then the loaded sheet, once the listing is done.
    let loaded = answer && /asking=false/.test(answer);
    const until = Date.now() + 30_000;
    while (!loaded && Date.now() < until) {
      await sleep(1_500);
      const before = fs.statSync(metroLog).size;
      put({ do: 'voicelist', provider: 'fish', n: 1 });
      const said = await waitFor(/HX voicelist fish/, before, 3_000);
      if (said) console.log(`${at()} ${said.trim()}`);
      loaded = Boolean(said && /asking=false/.test(said));
    }
    await sleep(800);
    shot('loaded');
  } finally {
    if (recorder) {
      recorder.kill('SIGINT');
      await Promise.race([recorderExit, sleep(15_000)]);
      console.log(`${at()} recording stopped`);
    }
    put({ do: 'voicesheet', on: false });
    await sleep(700);
    fs.rmSync(harness, { force: true });
    console.log(`${at()} sheet closed, harness.json removed`);
  }
}
main().catch((problem) => {
  console.error(`${at()} ${problem.message}`);
  process.exitCode = 1;
});
