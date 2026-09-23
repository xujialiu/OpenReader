#!/usr/bin/env node
// A state snapshot for pairing with real XCTest touches on #52 (BrowseTouchProbe.swift).
//
//   node test/manual-test/browse-touch-state.cjs SIMULATOR_UDID METRO_LOG [LABEL]
//
// Prints the same facts `browse-probe.cjs` compares before/after its own
// synthetic `section` call — the status line, the Library's place for every
// book, the section at the top of the page, and every painted highlight Range
// — but sends no `section` itself. A real XCTest tap is the action; this script
// is only the read, run once before and once after it from the host shell so a
// real touch's effect can be diffed the same way. Needs a reader open and
// METRO_LOG, the file this worktree's Metro writes to.
//
// Removes Documents/harness.json once its answer has arrived, so a later
// reader remount (Back, then reopen) does not replay a stale command
// (test/manual-test/README.md Pitfalls, "A stale harness.json replays on
// every reader remount").
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, label = 'state'] = process.argv.slice(2);
if (!device || !metroLog) {
  console.error('Usage: browse-touch-state.cjs SIMULATOR_UDID METRO_LOG [LABEL]');
  process.exit(2);
}

const documents = path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents');
const harnessFile = path.join(documents, 'harness.json');
let seq = (() => { try { return Number(JSON.parse(fs.readFileSync(harnessFile, 'utf8')).seq) || 0; } catch { return 0; } })();
const send = (command) => { seq += 1; fs.writeFileSync(harnessFile, JSON.stringify({ seq, ...command })); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logSize = () => fs.statSync(metroLog).size;
const logSince = (offset) => {
  const fd = fs.openSync(metroLog, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const bytes = Buffer.alloc(Math.max(0, size - offset));
    fs.readSync(fd, bytes, 0, bytes.length, offset);
    return bytes.toString('utf8');
  } finally { fs.closeSync(fd); }
};
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf('HX note attention=');
  if (at < 0) return [];
  try {
    const said = JSON.parse(line.slice(line.indexOf('"', at)));
    return said.includes('PROBE ') ? [said.slice(said.indexOf('PROBE ') + 6)] : [];
  } catch { return []; }
});
async function ask(code, ms = 4000) {
  const offset = logSize();
  send({ do: 'js', code });
  await sleep(700);
  const end = Date.now() + ms;
  for (;;) {
    send({ do: 'say' });
    await sleep(400);
    const found = answers(logSince(offset)).at(-1);
    if (found !== undefined) return found;
    if (Date.now() >= end) return null;
  }
}
async function answer(command, marker, ms = 4000) {
  const offset = logSize();
  send(command);
  const end = Date.now() + ms;
  for (;;) {
    await sleep(250);
    const lines = logSince(offset).split('\n').filter((line) => line.includes(marker));
    if (lines.length) {
      await sleep(250);
      return logSince(offset).split('\n').filter((line) => line.includes(marker));
    }
    if (Date.now() >= end) return [];
  }
}
async function state() {
  const said = (await answer({ do: 'say' }, 'HX status ')).at(-1) ?? '';
  const places = (await answer({ do: 'shelf' }, ' place='))
    .map((line) => line.replace(/.*HX shelf /, '').replace(/ stamp=\d+$/, ''));
  if (!said) {
    console.error('The harness did not answer "say". Is a reader open, and is Metro writing to ' + metroLog + '?');
    process.exit(2);
  }
  const field = (name) => (said.match(new RegExp(' ' + name + '=(\\S+)')) ?? [])[1] ?? null;
  return { playing: field('playing'), utterance: field('utterance'), section: field('section'), places };
}
const read = `
  var m = rendition.manager, box = m.container.getBoundingClientRect();
  var out = { views: m.views.all().map(function (v) { return v.section.index; }), top: null, utt: [], word: [] };
  rendition.getContents().forEach(function (c) {
    var w = c.window; if (!w || !w.frameElement) return;
    var f = w.frameElement.getBoundingClientRect();
    if (f.top <= box.top + 1 && f.bottom > box.top + 1) out.top = c.sectionIndex;
    if (!w.CSS) return;
    [['utt', 'openreader-utterance'], ['word', 'openreader-word']].forEach(function (pair) {
      var h = w.CSS.highlights.get(pair[1]);
      if (h) h.forEach(function (r) {
        var rr = r.getBoundingClientRect();
        out[pair[0]].push([c.sectionIndex, Math.round(f.top + rr.top - box.top), Math.round(f.top + rr.bottom - box.top), r.toString().slice(0, 48)]);
      });
    });
  });
  return JSON.stringify(out);
`;
const print = (said, page) => {
  console.log(label + ': playing=' + said.playing + ' utterance=' + said.utterance + ' section=' + said.section +
    ' | page top=' + page.top + ' views=' + page.views.join(','));
  for (const place of said.places) console.log('  shelf ' + place);
  for (const [at, top, bottom, text] of page.utt) console.log('  utt  s' + at + ' ' + top + '..' + bottom + ' "' + text + '"');
  for (const [at, top, bottom, text] of page.word) console.log('  word s' + at + ' ' + top + '..' + bottom + ' "' + text + '"');
};

(async () => {
  const said = await state();
  const answered = await ask(read);
  if (answered === null) {
    console.error('No answer from the reader. Is one open, and is Metro writing to ' + metroLog + '?');
    process.exit(2);
  }
  const page = JSON.parse(answered);
  print(said, page);
  try { fs.unlinkSync(harnessFile); } catch { /* already gone */ }
})().catch((error) => { console.error(error); process.exit(2); });
