// #176 device measurement: arms an in-app heartbeat and unrelated-Clip reader
// through CDP, then samples while the operator deletes audio through the UI.
// Read-only instrumentation on globalThis; injects no app code changes.
//
//   ARM:  node offline-delete-sampler.cjs arm <METRO_URL> <DEVICE_NAME> <UNRELATED_DOC_ID> <PROVIDER> <VOICE_ID> '<UNRELATED_TEXT>'
//   MARK: node offline-delete-sampler.cjs mark <METRO_URL> <DEVICE_NAME> <LABEL>
//   READ: node offline-delete-sampler.cjs read <METRO_URL> <DEVICE_NAME>
//
// arm installs globalThis.__or176 = { ticks, reads, marks }:
//   - a 25 ms setInterval pushes Date.now() into ticks (the JS turn supply);
//   - an async loop re-reads one saved Clip of the unrelated Document through
//     the repository's readClip every 400 ms, recording request/completion
//     times. The text must be one already saved for that voice (the fixture's
//     known first sentence), because a miss would go to the Provider.
// The UNRELATED_TEXT is passed in, not discovered, so the probe needs no
// knowledge of the catalogue's chapter shapes; readClip is the access #176
// measures. What it cannot prove: repository-internal queue order; that is
// the host tests' evidence.
const { writeFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const [, , mode, metro, device, ...rest] = process.argv;
if (!mode || !metro) { console.error('usage: sampler arm|mark|read METRO DEVICE [args]'); process.exit(2); }

const evalCdp = (expression) => {
  const out = mkdtempSync(join(tmpdir(), 'or176-'));
  const f = join(out, 'e.js');
  writeFileSync(f, expression);
  return execFileSync(process.execPath,
    [require.resolve('../kit/cdp.cjs'), '--eval', f, metro],
    { timeout: 15000, env: { ...process.env, OPENREADER_DEVICE: device } },
  ).toString();
};

const dbmod = `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === 'src/offline/database.ts') found = __r(id); }); if (!found) throw Error('database module'); return found; })()`;

if (mode === 'arm') {
  const [docId, provider, voiceId, text] = rest;
  if (!docId || !provider || !voiceId || !text) {
    console.error('arm needs UNRELATED_DOC_ID PROVIDER VOICE_ID TEXT');
    process.exit(2);
  }
  const expr = `(() => {
  globalThis.__or176 = { ticks: [], reads: [], marks: {}, note: 'armed ' + new Date().toISOString() };
  const s = globalThis.__or176;
  s.timer = setInterval(() => { s.ticks.push(Date.now()); if (s.ticks.length > 400000) s.ticks = s.ticks.slice(-200000); }, 25);
  (async () => {
    const repo = await (${dbmod}).offlineRepository();
    s.repoObtainedAt = Date.now();
    const voice = { provider: ${JSON.stringify(provider)}, voice: ${JSON.stringify(voiceId)}, label: ${JSON.stringify(voiceId)} };
    for (;;) {
      const requestedAt = Date.now();
      try {
        const read = await repo.readClip(${JSON.stringify(docId)}, voice, ${JSON.stringify(text)});
        s.reads.push({ requestedAt, resolvedAt: Date.now(), ok: !!read.clip, dropped: !!read.dropped });
      } catch (e) {
        s.reads.push({ requestedAt, resolvedAt: Date.now(), ok: false, error: String(e && e.message).slice(0, 120) });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  })().catch((e) => { s.readLoopError = String(e && e.message).slice(0, 200); });
  return 'armed';
})()`;
  console.log(evalCdp(expr));
} else if (mode === 'mark') {
  const [label] = rest;
  console.log(evalCdp(`(() => { const s = globalThis.__or176; if (!s) return 'not-armed'; s.marks[${JSON.stringify(label)}] = { at: Date.now(), ticks: s.ticks.length, reads: s.reads.length }; return 'marked ' + ${JSON.stringify(label)}; })()`));
} else {
  const expr = `(() => {
  const s = globalThis.__or176;
  if (!s) return JSON.stringify({ armed: false });
  const ticks = s.ticks;
  const gaps = [];
  for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i] - ticks[i - 1]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const reads = s.reads;
  return JSON.stringify({
    armed: true,
    note: s.note,
    marks: s.marks,
    ticks: ticks.length,
    firstTick: ticks[0], lastTick: ticks[ticks.length - 1],
    maxGap: sorted[sorted.length - 1],
    p99Gap: sorted[Math.floor(sorted.length * 0.99)],
    worstGaps: sorted.slice(-10).reverse(),
    gapsOver100ms: gaps.filter((g) => g > 100).length,
    gapsOver250ms: gaps.filter((g) => g > 250).length,
    reads: reads.length,
    readOk: reads.filter((r) => r.ok).length,
    readFail: reads.filter((r) => !r.ok).length,
    lastReads: reads.slice(-8),
    readLoopError: s.readLoopError ?? null,
  });
})()`;
  console.log(evalCdp(expr));
}
