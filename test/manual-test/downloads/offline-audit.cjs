#!/usr/bin/env node
// Audit an app container's offline catalogue against its payload files on disk
// (#313/#176 verification, 2026-10-23; corrected after the r1 review).
//
//   node test/manual-test/downloads/offline-audit.cjs UDID [--strict] [--json]
//   node test/manual-test/downloads/offline-audit.cjs /path/to/container/data [--strict] [--json]
//
// Snapshot: the catalogue is captured with the SQLite ONLINE BACKUP API
// (`sqlite3 SRC ".backup DEST"`), which takes a consistent snapshot while the
// app is running; falling back to file copies only warns and is then NOT
// consistent (main/WAL copies race a live writer). node:sqlite on this machine
// has no backup() (Node 22); the CLI is used instead.
//
// Reports, per Document and Voice: clip counts by state, and for every `ready`
// row whether its payload file exists and matches the sidecar's recorded size.
// Also lists the `audio-verified:<document>` markers from the `state` table.
//
// --strict exits 1 when any ready row's payload is missing or short (the state
// #313 repairs). Row/file agreement is only meaningful when the store is
// QUIESCENT: during an active deletion sweep the snapshot may legitimately
// hold rows whose files are already gone or files whose rows are not yet
// dropped — run --strict with the app idle (or terminated), and read a sweep's
// intermediate states from the non-strict counts. The temp snapshot directory
// and the database handle are always cleaned up.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, existsSync, statSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
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
const dest = join(work, 'catalog.sqlite');
let method = 'sqlite3 .backup (online, consistent)';
let consistent = true;
try {
  execFileSync('sqlite3', [dbPath, `.backup '${dest}'`], { timeout: 30000 });
} catch (problem) {
  method = `file copies (NOT consistent: ${String(problem.message).slice(0, 80)})`;
  consistent = false;
  for (const suffix of ['', '-wal', '-shm'])
    if (existsSync(dbPath + suffix)) execFileSync('cp', [dbPath + suffix, dest + suffix]);
}
if (!existsSync(dest) || statSync(dest).size === 0) {
  rmSync(work, { recursive: true, force: true });
  console.error('snapshot failed');
  process.exit(2);
}
let db;
try {
  db = new DatabaseSync(dest, { readOnly: true });

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
    snapshot: { method, consistent },
    groups: [...perGroup.values()],
    readyChecked: checked,
    verifiedMarkers: markers.map((m) => m.name),
    problems,
    caveat: consistent ? null : 'inconsistent snapshot: strict results valid only for quiescent stores',
  };
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    if (!consistent) console.log(`WARNING ${report.caveat}`);
    for (const g of report.groups)
      console.log(`${g.document} voice ${g.voice.slice(0, 10)}… states=${JSON.stringify(g.states)} ready=${g.ready} missingPayload=${g.missing} shortPayload=${g.short}`);
    console.log(`ready rows checked against disk: ${checked}`);
    console.log(`audio-verified markers: ${report.verifiedMarkers.length ? report.verifiedMarkers.join(', ') : '(none)'}`);
    for (const p of problems) console.log(`PROBLEM ${p}`);
    console.log(problems.length ? `AUDIT: ${problems.length} problem(s)` : 'AUDIT: clean');
  }
  if (strict && problems.length) process.exitCode = 1;
} finally {
  try { if (db) db.close(); } catch {}
  rmSync(work, { recursive: true, force: true });
}
