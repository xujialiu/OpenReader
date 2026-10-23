#!/usr/bin/env node
// Audit an app container's offline catalogue against its payload files on disk
// (#313/#176 verification, 2026-10-23). Read-only: the catalog.sqlite (+WAL/SHM)
// is copied to a temp directory first, so a running app cannot be disturbed.
//
//   node test/manual-test/downloads/offline-audit.cjs UDID [--strict] [--json]
//   node test/manual-test/downloads/offline-audit.cjs /path/to/container/data [--strict] [--json]
//
// Reports, per Document and Voice: clip counts by state, and for every `ready`
// row whether its payload file exists and matches the sidecar's recorded size.
// Also lists the `audio-verified:<document>` markers from the `state` table.
// --strict exits 1 when any ready row's payload is missing or short (a state
// #313 repairs); without it the audit is pure inspection and always exits 0.
// What it cannot prove: it reads the container, not the app's memory; a row the
// app has not yet flushed still shows its last committed state.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, copyFileSync, existsSync, statSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, basename } = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const asJson = args.includes('--json');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: offline-audit.cjs UDID|CONTAINER_DATA_PATH [--strict] [--json]');
  process.exit(2);
}
const data = target.includes('/')
  ? target
  : execFileSync('xcrun', ['simctl', 'get_app_container', target, 'top.xujialiu.openreader', 'data']).toString().trim();
const offline = join(data, 'Documents', 'offline-narration-v2');
const dbPath = join(offline, 'catalog.sqlite');
if (!existsSync(dbPath)) {
  console.error(`no catalog at ${dbPath}`);
  process.exit(2);
}
const work = mkdtempSync(join(tmpdir(), 'openreader-offline-audit-'));
for (const suffix of ['', '-wal', '-shm'])
  if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, join(work, 'catalog.sqlite' + suffix));
const db = new DatabaseSync(join(work, 'catalog.sqlite'));

const rows = db.prepare(
  "SELECT document, voice, state, COUNT(*) AS n FROM clips GROUP BY document, voice, state ORDER BY document, voice, state",
).all();
const ready = db.prepare(
  "SELECT document, voice, key, metadata FROM clips WHERE state='ready' ORDER BY document, voice, key",
).all();
const markers = db.prepare("SELECT name, value FROM state WHERE name LIKE 'audio-verified:%' ORDER BY name").all();

const problems = [];
const perGroup = new Map();
const group = (d, v) => {
  const k = `${d.slice(0, 12)}…/${v.slice(0, 10)}…`;
  if (!perGroup.has(k)) perGroup.set(k, { document: d, voice: v, states: {}, ready: 0, missing: 0, short: 0 });
  return perGroup.get(k);
};
for (const r of rows) {
  const g = group(r.document, r.voice);
  g.states[r.state] = r.n;
}
let checked = 0;
for (const r of ready) {
  const g = group(r.document, r.voice);
  g.ready++;
  let sidecar = null;
  try { sidecar = JSON.parse(r.metadata); } catch {}
  const format = sidecar?.format;
  const ext = format === 'alac' ? 'm4a' : format === 'encoded' ? 'audio' : null;
  const payload = ext ? join(offline, r.document, r.voice, `${r.key}.${ext}`) : null;
  const size = payload && existsSync(payload) ? statSync(payload).size : 0;
  checked++;
  if (!payload || !existsSync(payload)) { g.missing++; problems.push(`missing payload: ${r.document.slice(0, 12)}…/${r.voice.slice(0, 10)}…/${r.key}`); }
  else if (sidecar && Number.isSafeInteger(sidecar.size) && size !== sidecar.size) { g.short++; problems.push(`short payload (${size} != ${sidecar.size}): ${r.document.slice(0, 12)}…/${r.voice.slice(0, 10)}…/${r.key}`); }
}
const report = {
  container: data,
  catalog: dbPath,
  groups: [...perGroup.values()].map((g) => ({ ...g, document: g.document, voice: g.voice })),
  readyChecked: checked,
  verifiedMarkers: markers.map((m) => m.name),
  problems,
};
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  for (const g of report.groups)
    console.log(`${g.document} voice ${g.voice.slice(0, 10)}… states=${JSON.stringify(g.states)} ready=${g.ready} missingPayload=${g.missing} shortPayload=${g.short}`);
  console.log(`ready rows checked against disk: ${checked}`);
  console.log(`audio-verified markers: ${report.verifiedMarkers.length ? report.verifiedMarkers.join(', ') : '(none)'}`);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  console.log(problems.length ? `AUDIT: ${problems.length} problem(s)` : 'AUDIT: clean');
}
if (strict && problems.length) process.exit(1);
