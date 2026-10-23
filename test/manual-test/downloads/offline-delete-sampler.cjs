// #176 device measurement, v2: a BOUNDED in-app heartbeat and unrelated-Clip
// reader, armed through CDP, with explicit stop, named phase markers, and raw
// timestamp retention. Injects no app code changes; nothing here is a gate.
//
//   ARM:  node offline-delete-sampler.cjs arm  METRO DEVICE UNRELATED_DOC_ID PROVIDER VOICE_ID 'ONE SAVED SENTENCE' [BOUNDED_SECONDS=90]
//   MARK: node offline-delete-sampler.cjs mark METRO DEVICE LABEL
//   STOP: node offline-delete-sampler.cjs stop METRO DEVICE [REASON]
//   READ: node offline-delete-sampler.cjs read METRO DEVICE [SINCE] [UNTIL]
//         SINCE/UNTIL: a mark label, ms since epoch, or 'now' (default: arm..now)
//   RAW:  node offline-delete-sampler.cjs raw  METRO DEVICE   (full JSON; host saves it)
//
// v2 corrections over the r1 helper (whose whole-window aggregates and last-8
// reads were not accepted as responsiveness evidence):
//   - arming STOPS any previous probe (timer + read loop) before installing;
//   - the probe auto-stops after BOUNDED_SECONDS and answers explicit stop;
//   - arrays are bounded (oldest dropped, counted), raw tick/read timestamps
//     are retained and dumpable (`raw`) for per-window analysis on the host;
//   - the heartbeat records each fire's DUE time, so summaries include
//     callback-start lateness, not only request-to-resolution;
//   - the unrelated read loop records its own due/startedAt/resolvedAt;
//   - `read` summarises ONLY the requested window (no pre-window data).
// The unrelated Document is read through repository.readClip. A miss returns
// {clip:null} and calls NO Provider — pass a sentence already saved so `ok`
// measures reads rather than misses; the calling layer decides on refresh.
const { writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const [, , mode, metro, device, ...rest] = process.argv;
if (!mode || !metro) {
  console.error('usage: sampler arm|mark|stop|read|raw METRO DEVICE [args]');
  process.exit(2);
}

const evalCdp = (expression) => {
  const out = mkdtempSync(join(tmpdir(), 'or176-'));
  const f = join(out, 'e.js');
  writeFileSync(f, expression);
  try {
    return execFileSync(process.execPath,
      [require.resolve('../kit/cdp.cjs'), '--eval', f, metro],
      { timeout: 20000, env: { ...process.env, OPENREADER_DEVICE: device } },
    ).toString();
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
};

const dbmod = `(() => { let found; __r.getModules().forEach((m, id) => { if (m.verboseName === 'src/offline/database.ts') found = __r(id); }); if (!found) throw Error('database module'); return found; })()`;
const MAX_TICKS = 60000;
const MAX_READS = 20000;
const READ_EVERY_MS = 400;
const HEARTBEAT_MS = 25;

if (mode === 'arm') {
  const [docId, provider, voiceId, text, boundedSeconds] = rest;
  if (!docId || !provider || !voiceId || !text) {
    console.error('arm needs UNRELATED_DOC_ID PROVIDER VOICE_ID TEXT [BOUNDED_SECONDS=90]');
    process.exit(2);
  }
  const seconds = Number(boundedSeconds ?? 90);
  const expr = `(() => {
  // Stop any previous probe: its timer, its read timer, its loop flag.
  const old = globalThis.__or176v2;
  if (old) { old.stopped = true; if (old.timer) clearInterval(old.timer); if (old.readTimer) clearTimeout(old.readTimer); old.stopReason = 'replaced by a new arm'; }
  const s = globalThis.__or176v2 = {
    v: 2,
    armedAt: Date.now(), boundedMs: ${Math.round(seconds * 1000)},
    ticks: [], droppedTicks: 0, reads: [], droppedReads: 0,
    marks: {}, stopped: false, stoppedAt: null, stopReason: null,
    maxTicks: ${MAX_TICKS}, maxReads: ${MAX_READS},
  };
  let expected = s.armedAt + ${HEARTBEAT_MS};
  let prevAt = s.armedAt;
  s.timer = setInterval(() => {
    if (s.stopped) return;
    const at = Date.now();
    if (s.ticks.length >= s.maxTicks) { s.ticks.splice(0, 10000); s.droppedTicks += 10000; }
    s.ticks.push({ at, due: expected, late: Math.max(0, at - expected), gap: prevAt === null ? 0 : at - prevAt });
    prevAt = at;
    expected = Math.max(expected + ${HEARTBEAT_MS}, at + 1);
    if (at - s.armedAt >= s.boundedMs) { s.stopped = true; s.stoppedAt = at; s.stopReason = 'bounded duration reached'; clearInterval(s.timer); if (s.readTimer) clearTimeout(s.readTimer); }
  }, ${HEARTBEAT_MS});
  const scheduleRead = () => {
    if (s.stopped) return;
    const due = Date.now() + ${READ_EVERY_MS};
    s.readTimer = setTimeout(async () => {
      if (s.stopped) return;
      const startedAt = Date.now();
      let entry = { due, startedAt, callbackStartDelay: Math.max(0, startedAt - due), requestedAt: startedAt, resolvedAt: null, ok: false, dropped: false, error: null };
      if (s.reads.length >= s.maxReads) { s.reads.splice(0, 5000); s.droppedReads += 5000; }
      s.reads.push(entry);
      try {
        const repo = await (${dbmod}).offlineRepository();
        const read = await repo.readClip(${JSON.stringify(docId)}, { provider: ${JSON.stringify(provider)}, voice: ${JSON.stringify(voiceId)}, label: ${JSON.stringify(voiceId)} }, ${JSON.stringify(text)});
        entry.ok = !!read.clip; entry.dropped = !!read.dropped;
      } catch (e) {
        entry.error = String(e && e.message).slice(0, 120);
      }
      entry.resolvedAt = Date.now();
      scheduleRead();
    }, ${READ_EVERY_MS});
  };
  scheduleRead();
  return JSON.stringify({ armed: true, armedAt: s.armedAt, boundedMs: s.boundedMs, replacedPrevious: !!old });
})()`;
  console.log(evalCdp(expr));
} else if (mode === 'mark') {
  const [label] = rest;
  if (!label) { console.error('mark needs LABEL'); process.exit(2); }
  console.log(evalCdp(`(() => {
  const s = globalThis.__or176v2;
  if (!s) return JSON.stringify({ armed: false });
  const at = Date.now();
  s.marks[${JSON.stringify(label)}] = { at, tickIndex: s.ticks.length, readIndex: s.reads.length, stopped: s.stopped };
  return JSON.stringify({ marked: ${JSON.stringify(label)}, at, armed: true, stopped: s.stopped });
})()`));
} else if (mode === 'stop') {
  const [reason] = rest;
  console.log(evalCdp(`(() => {
  const s = globalThis.__or176v2;
  if (!s) return JSON.stringify({ armed: false });
  if (s.stopped) return JSON.stringify({ alreadyStopped: true, stoppedAt: s.stoppedAt, stopReason: s.stopReason });
  s.stopped = true; s.stoppedAt = Date.now(); s.stopReason = ${JSON.stringify(reason ?? 'explicit stop')};
  if (s.timer) clearInterval(s.timer);
  if (s.readTimer) clearTimeout(s.readTimer);
  return JSON.stringify({ stopped: true, stoppedAt: s.stoppedAt, ticks: s.ticks.length, reads: s.reads.length });
})()`));
} else if (mode === 'raw') {
  console.log(evalCdp(`(() => JSON.stringify(globalThis.__or176v2))()`));
} else {
  const [since, until] = rest;
  const num = (spec, fallbackKind) => {
    if (!spec || spec === 'now') return spec === 'now' || !spec ? { now: true } : null;
    return { ms: Number.isFinite(Number(spec)) ? Number(spec) : { mark: spec } };
  };
  const resolveBound = (spec) => {
    if (!spec) return { expr: 's.armedAt', label: 'arm' };
    if (spec === 'now') return { expr: 'Date.now()', label: 'now' };
    if (Number.isFinite(Number(spec))) return { expr: String(Number(spec)), label: String(spec) };
    return { expr: `(s.marks[${JSON.stringify(spec)}] ? s.marks[${JSON.stringify(spec)}].at : null)`, label: `mark:${spec}` };
  };
  const A = resolveBound(since);
  const B = resolveBound(until ?? 'now');
  const expr = `(() => {
  const s = globalThis.__or176v2;
  if (!s) return JSON.stringify({ armed: false });
  const start = ${A.expr}; const end = ${B.expr};
  if (start === null) return JSON.stringify({ error: 'unknown since mark', marks: Object.keys(s.marks) });
  if (end === null) return JSON.stringify({ error: 'unknown until mark', marks: Object.keys(s.marks) });
  const win = (arr, key) => arr.filter((e) => e[key] >= start && e[key] <= end);
  const stats = (xs) => {
    const v = [...xs].sort((a, b) => a - b);
    const q = (p) => v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null;
    return { n: v.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: v.length ? v[v.length - 1] : null, over100: v.filter((x) => x > 100).length, over250: v.filter((x) => x > 250).length, over500: v.filter((x) => x > 500).length };
  };
  const wt = win(s.ticks, 'at');
  const wr = win(s.reads, 'startedAt');
  const done = wr.filter((r) => r.resolvedAt !== null);
  const worst = (xs, key) => [...xs].sort((a, b) => b[key] - a[key]).slice(0, 8).map((e) => ({ at: e.at ?? e.startedAt, v: e[key] }));
  return JSON.stringify({
    window: { start, end, ms: end - start, since: ${JSON.stringify(A.label)}, until: ${JSON.stringify(B.label)} },
    probe: { armedAt: s.armedAt, stopped: s.stopped, stoppedAt: s.stoppedAt, stopReason: s.stopReason, droppedTicks: s.droppedTicks, droppedReads: s.droppedReads, totalTicks: s.ticks.length + s.droppedTicks, totalReads: s.reads.length + s.droppedReads, marks: s.marks },
    ticks: { inWindow: wt.length, first: wt[0]?.at ?? null, last: wt[wt.length - 1]?.at ?? null, lateness: stats(wt.map((t) => t.late)), gaps: stats(wt.map((t) => t.gap)), worstLateness: worst(wt, 'late'), worstGaps: worst(wt, 'gap') },
    reads: { inWindow: wr.length, completed: done.length, ok: done.filter((r) => r.ok).length, missOrDropped: done.filter((r) => !r.ok).length, unresolved: wr.length - done.length, callbackStart: stats(done.map((r) => r.callbackStartDelay)), latency: stats(done.map((r) => r.resolvedAt - r.requestedAt)), worstCallbackStart: worst(done, 'callbackStartDelay') },
  });
})()`;
  console.log(evalCdp(expr));
}
