#!/usr/bin/env node
// Test setup, not app behaviour: prepares chosen chapters' text in the
// foreground without asking for a single clip of them, so that a later run away
// from the screen crosses those chapter boundaries without the preparation that
// does not finish there (#76; `download-away.cjs` recipe).
//
//   node test/manual-test/download-prepare.cjs DOCUMENT_ID PROVIDER VOICE LAST_CHAPTER_ID CHAPTER_ID…
//
// Adds the chapters and LAST_CHAPTER_ID (a chapter after them in the Document,
// which is given up) to the voice's download through the runtime's `enqueue`,
// and pauses each chapter by its ring (`toggleChapter`) the moment the task
// reads `preparing` on it: its text is still prepared and saved, and the
// download moves to the next chapter without writing it. On LAST_CHAPTER_ID it
// pauses all, which cancels that one's preparation. The app must be in front.
// Chapters left unpaused in the task before this run are written between them,
// and paused at the end with everything else. A chapter already prepared passes
// through `preparing` too fast to be caught and may save its first clips
// (`pause-late` in the log). OPENREADER_METRO (127.0.0.1) is passed to cdp.cjs.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [documentId, provider, voice, last, ...chapters] = process.argv.slice(2);
if (!documentId || !provider || !voice || !last || !chapters.length) {
  console.error('Usage: download-prepare.cjs DOCUMENT_ID PROVIDER VOICE LAST_CHAPTER_ID CHAPTER_ID…');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-prepare-'));
const evaluate = (expression) => {
  const file = join(output, 'probe.js');
  writeFileSync(file, expression);
  return JSON.parse(execFileSync(process.execPath, [require.resolve('./cdp.cjs'), '--eval', file], { encoding: 'utf8' })).value;
};
const a = JSON.stringify({ documentId, provider, voice, last, chapters });
// `forEach`, not `for…of`: what --eval sends is compiled without Babel (Pitfalls, cdp.md).
const runtime = `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === 'src/offline/runtime.ts') found = __r(id); }); if (!found) throw Error('runtime'); return found; })()`;
evaluate(`(() => {
  const a = ${a}; const rt = ${runtime};
  const want = new Set(a.chapters); const log = [];
  rt.enqueue(a.documentId, { provider: a.provider, voice: a.voice, label: a.voice }, [...a.chapters, a.last]);
  const t = rt.downloadTasks(a.documentId).find((x) => x.voice.provider === a.provider && x.voice.voice === a.voice);
  const timer = setInterval(() => {
    if (!t.current) return;
    if (want.has(t.current)) {
      const id = t.current; want.delete(id);
      log.push([Date.now(), t.state === 'preparing' ? 'pause-while-preparing' : 'pause-late-' + t.state, id]);
      rt.toggleChapter(t, id);
    } else if (t.current === a.last && t.state === 'preparing') { log.push([Date.now(), 'pause-all', a.last]); rt.toggleTask(t); clearInterval(timer); }
  }, 30);
  globalThis.__downloadPrepare = { log, timer, t };
  return true;
})()`);
(async () => {
  for (let i = 0; i < 120; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const done = evaluate(`(() => { const p = globalThis.__downloadPrepare; return JSON.stringify({ log: p.log, state: p.t.state }); })()`);
    if (done.includes('pause-all')) {
      JSON.parse(done).log.forEach(([t, what, id]) => console.log(`${new Date(t).toISOString()} ${what} ${id}`));
      const plan = evaluate(`(() => { const a = ${a}; const p = ${runtime}.planOf(a.documentId); return JSON.stringify(a.chapters.map((id) => { const c = p.chapters.find((x) => x.id === id); return id + ' prepared=' + c.prepared + ' texts=' + c.textCount; })); })()`);
      JSON.parse(plan).forEach((line) => console.log(line));
      return;
    }
  }
  console.error('Did not reach LAST_CHAPTER_ID within two minutes; the download is left as it is.');
  process.exitCode = 1;
})();
