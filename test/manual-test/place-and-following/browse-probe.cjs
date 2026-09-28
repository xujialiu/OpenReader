#!/usr/bin/env node
// A Contents row while the reading is paused is Browsing (#52): the page goes to
// SECTION, and the reading, its highlight and the stored place stay where they are.
//
//   node test/manual-test/place-and-following/browse-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [WAIT_MS]
//
// Needs a reader open with the reading **paused on a sentence that is its Reading
// Position** — reopened on a stored place, tapped, skipped to, or played and then
// paused — and METRO_LOG, the file this worktree's Metro writes its output to,
// because the harness answers there. It plays nothing, so it needs no Provider
// and no silence.
//
// It reads the status line, the Library's place for the open book, where the
// page is (the views, and the section at the top of the scroll container) and
// every painted Range of the two highlights. Then it makes the call a Contents
// row makes, `{"do":"section","section":SECTION}` (`reading.goToSection`), waits
// WAIT_MS (default 2500: a section of the owner's books arrives within ~0.6 s,
// and epub.js fills the neighbours after it), reads the same again and takes a
// screenshot beside METRO_LOG.
//
// GREEN (exit 0) is all of:
//   - the page went there: SECTION is the section at the top of the page;
//   - the reading did not move: the status line's Utterance and section are as
//     they were;
//   - the stored place did not change;
//   - no highlight moved: every painted piece of the Utterance highlight after is
//     one that was painted before (the reading's section may have left the page,
//     and then nothing is painted, which is not a move), and no word is lit.
// RED (exit 1) names what failed. Exit 2 is a precondition or harness failure.
//
// The section chosen matters. The one right after the reading's is the case the
// WebView itself used to undo: its display re-renders the reading's section as a
// neighbour, and the highlighter centred the paused sentence as it arrived
// (measured 2026-09-23 23:30, a scroll of -7,424 px). A section far away tests
// the React Native half alone.
//
// Not a touch test: it calls the reading handler the Contents sheet calls, and
// reads the page from inside the WebView.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Buffer } = require('node:buffer');

const [device, metroLog, sectionArg, waitArg = '2500'] = process.argv.slice(2);
const section = Number(sectionArg);
const wait = Number(waitArg);
if (!device || !metroLog || !Number.isInteger(section) || !(wait > 0)) {
  console.error('Usage: browse-probe.cjs SIMULATOR_UDID METRO_LOG SECTION [WAIT_MS]');
  process.exit(2);
}

const documents = path.join(execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim(), 'Documents');
const harnessFile = path.join(documents, 'harness.json');
// Every command needs a new seq (README Pitfalls), so carry on from the file's.
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
// A `js` answer becomes the reader's note, cut at 500 characters in the status
// line, so it is read in full from the `say` command's `note attention=` line.
const answers = (text) => text.split('\n').flatMap((line) => {
  const at = line.indexOf('HX note attention=');
  if (at < 0) return [];
  try {
    const said = JSON.parse(line.slice(line.indexOf('"', at)));
    return said.includes('PROBE ') ? [said.slice(said.indexOf('PROBE ') + 6)] : [];
  } catch { return []; }
});
/** One `js` command, answered: the code runs in the reader's WebView and returns a string. */
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
/**
 * Send a harness command and wait for the lines it answers with. The harness polls
 * its file four times a second and a reader busy laying out a section answers
 * later still: a fixed 600 ms missed the status line once on 2026-09-24 and read
 * a reading that had not moved as `utterance=null`.
 */
async function answer(command, marker, ms = 4000) {
  const offset = logSize();
  send(command);
  const end = Date.now() + ms;
  for (;;) {
    await sleep(250);
    const lines = logSince(offset).split('\n').filter((line) => line.includes(marker));
    if (lines.length) {
      // The shelf answers with a line per book; let the rest of them land.
      await sleep(250);
      return logSince(offset).split('\n').filter((line) => line.includes(marker));
    }
    if (Date.now() >= end) return [];
  }
}
/** The status line's playing, Utterance and section, and the Library's place for each book. */
async function state() {
  const said = (await answer({ do: 'say' }, 'HX status ')).at(-1) ?? '';
  // The place's own words, not the entry's stamp, which moves whenever the book is opened.
  const places = (await answer({ do: 'shelf' }, ' place='))
    .map((line) => line.replace(/.*HX shelf /, '').replace(/ stamp=\d+$/, ''));
  if (!said || !places.length) {
    console.error('The harness did not answer "say" and "shelf". Is a reader open, and is Metro writing to ' + metroLog + '?');
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
const print = (label, said, page) => {
  console.log(label + ': playing=' + said.playing + ' utterance=' + said.utterance + ' section=' + said.section +
    ' | page top=' + page.top + ' views=' + page.views.join(','));
  for (const place of said.places) console.log('  shelf ' + place);
  for (const [at, top, bottom, text] of page.utt) console.log('  utt  s' + at + ' ' + top + '..' + bottom + ' "' + text + '"');
  for (const [at, top, bottom, text] of page.word) console.log('  word s' + at + ' ' + top + '..' + bottom + ' "' + text + '"');
};

(async () => {
  const before = await state();
  const answered = await ask(read);
  if (answered === null) {
    console.error('No answer from the reader. Is one open, and is Metro writing to ' + metroLog + '?');
    process.exit(2);
  }
  const pageBefore = JSON.parse(answered);
  print('before', before, pageBefore);
  if (before.playing !== 'false' || before.utterance === null || before.utterance === 'null') {
    console.error('Precondition: a paused reading on a sentence (the status line names an Utterance).');
    process.exit(2);
  }

  send({ do: 'section', section });
  await sleep(wait);

  const after = await state();
  const answeredAfter = await ask(read);
  if (answeredAfter === null) {
    console.error('No answer from the reader after the Contents row.');
    process.exit(2);
  }
  const pageAfter = JSON.parse(answeredAfter);
  print('after', after, pageAfter);
  const shot = path.join(path.dirname(metroLog), 'browse-' + section + '.png');
  execFileSync('xcrun', ['simctl', 'io', device, 'screenshot', shot], { stdio: 'ignore' });
  console.log('screenshot ' + shot);

  const failures = [];
  if (pageAfter.top !== section) failures.push('the page is on section ' + pageAfter.top + ', not ' + section + ' (views ' + pageAfter.views.join(',') + ')');
  if (after.utterance !== before.utterance || after.section !== before.section) {
    failures.push('the reading moved: utterance ' + before.utterance + ' -> ' + after.utterance + ', section ' + before.section + ' -> ' + after.section);
  }
  if (JSON.stringify(after.places) !== JSON.stringify(before.places)) failures.push('the stored place changed');
  const moved = pageAfter.utt.filter((piece) => !pageBefore.utt.some((was) => was[3] === piece[3]));
  if (moved.length) failures.push('the highlight moved to "' + moved.map((piece) => piece[3]).join(' | ') + '"');
  if (pageAfter.word.length) failures.push('a word is lit while paused');
  console.log(failures.length ? 'RED: ' + failures.join('; ') : 'GREEN');
  process.exit(failures.length ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(2); });
