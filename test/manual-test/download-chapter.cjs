#!/usr/bin/env node
// Download chosen chapters of a Library Document through the app's own offline
// runtime, without the Download sheet, and wait for the task to finish. Real
// synthesis: every sentence of those chapters is sent to the Provider once.
//
//   node test/manual-test/download-chapter.cjs DOCUMENT_ID TITLE PROVIDER VOICE CHAPTER_ID [CHAPTER_ID…]
//
// CHAPTER_ID is a plan id (`nav.0`, `section-3`); run with `--list` in place of
// the chapter ids to print the plan's chapters first. OPENREADER_METRO and
// OPENREADER_DEVICE are passed through to cdp.cjs. Nothing plays.
const { execFile } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [documentId, title, provider, voice, ...chapters] = process.argv.slice(2);
if (!documentId || !title || !provider || !voice || chapters.length === 0) {
  console.error('Usage: download-chapter.cjs DOCUMENT_ID TITLE PROVIDER VOICE (--list | CHAPTER_ID…)');
  process.exit(2);
}
const output = mkdtempSync(join(tmpdir(), 'openreader-download-chapter-'));
let serial = 0;
const evaluate = (expression) => new Promise((resolve, reject) => {
  const file = join(output, `${++serial}.js`);
  writeFileSync(file, expression);
  execFile(process.execPath, [require.resolve('./cdp.cjs'), '--eval', file], { timeout: 12000 }, (error, stdout, stderr) => {
    if (error) reject(Error(stderr || error.message));
    else { try { resolve(JSON.parse(stdout).value); } catch (e) { reject(e); } }
  });
});
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Loaded by the module's own name, as offline-playback.cjs does. `forEach`, not
// `for…of`: what --eval sends is compiled without Babel (README, Pitfalls).
const runtime = `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === 'src/offline/runtime.ts') found = __r(id); }); if (!found) throw Error('runtime'); return found; })()`;
const args = JSON.stringify({ documentId, title, provider, voice, chapters });

(async () => {
  await evaluate(`(() => { const a = ${args}; ${runtime}.requestPlan(a.documentId, a.title); return true; })()`);
  let plan = null;
  for (let i = 0; i < 50 && !plan; i++) {
    await delay(200);
    plan = await evaluate(`(() => { const a = ${args}; const p = ${runtime}.planOf(a.documentId); return p && JSON.stringify(p.chapters.map(c => [c.id, c.title, c.section])); })()`);
  }
  if (!plan) throw Error('The plan did not load; is the Document in the Library?');
  if (chapters[0] === '--list') {
    for (const [id, name, section] of JSON.parse(plan)) console.log(`${id}\t${section}\t${name}`);
    return;
  }
  await evaluate(`(() => { const a = ${args}; ${runtime}.enqueue(a.documentId, { provider: a.provider, voice: a.voice, label: a.voice }, a.chapters); return true; })()`);
  const started = Date.now();
  // To the millisecond, for comparing with the saved clips' file times.
  console.log(`enqueued ${new Date(started).toISOString()}`);
  for (;;) {
    await delay(3000);
    const state = JSON.parse(await evaluate(`(() => { const a = ${args}; const r = ${runtime}; const t = r.downloadTasks(a.documentId).find(t => t.voice.provider === a.provider && t.voice.voice === a.voice); return JSON.stringify({ state: t && t.state, error: t && t.error, failed: t && t.failed, bytes: r.occupied(a.documentId), store: r.downloadError() }); })()`));
    console.log(`${Math.round((Date.now() - started) / 1000)} s ${JSON.stringify(state)}`);
    if (['done', 'blocked', 'paused'].includes(state.state) || state.store) {
      if (state.state !== 'done' || state.failed?.length) process.exitCode = 1;
      return;
    }
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
