// Host-side deleting-count progression for one offline deletion, single process.
// Polls the catalog via the sqlite3 online-backup API and prints
// `ISO {"deleting":n,"ready":m}` lines. Terminal semantics (the r2 review):
// 0 deleting counts as terminal ONLY after positive deleting rows were seen —
// a poller started before its deletion (or against a quiescent store) would
// otherwise exit immediately and leave the progression uncaptured. Start this
// in the same shell chain as the confirming touch.
//
//   node delete-count-poller.cjs CONTAINER_DATA DOCUMENT_KEY [DEADLINE_SECONDS=200] [INTERVAL_MS=350]
//
// Exits 0 after two consecutive terminal polls; 3 on deadline. The temp
// snapshot directory is removed on every exit.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const [data, doc, deadlineSeconds, intervalMs] = process.argv.slice(2);
if (!data || !doc) { console.error('usage: delete-count-poller.cjs CONTAINER_DATA DOC_KEY [DEADLINE_S=200] [INTERVAL_MS=350]'); process.exit(2); }
const dbPath = join(data, 'Documents', 'offline-narration-v2', 'catalog.sqlite');
const work = mkdtempSync(join(tmpdir(), 'or176-poller-'));
const dest = join(work, 'catalog.sqlite');
const deadline = Date.now() + Number(deadlineSeconds ?? 200) * 1000;
const interval = Number(intervalMs ?? 350);
let zeros = 0;
let sawPositive = false;
const cleanup = () => rmSync(work, { recursive: true, force: true });
const poll = () => {
  try {
    execFileSync('sqlite3', [dbPath, `.backup '${dest}'`], { timeout: 10000 });
    const out = execFileSync('sqlite3', [dest, `SELECT state||'='||COUNT(*) FROM clips WHERE document='${doc}' GROUP BY state;`], { timeout: 10000 }).toString().trim();
    const counts = {};
    for (const line of out.split('\n').filter(Boolean)) { const [k, v] = line.split('='); counts[k] = Number(v); }
    console.log(`${new Date().toISOString()} ${JSON.stringify(counts)}`);
    if ((counts.deleting ?? 0) > 0) { sawPositive = true; zeros = 0; }
    else if (sawPositive) { zeros += 1; if (zeros >= 2) { console.log(`${new Date().toISOString()} TERMINAL`); cleanup(); process.exit(0); } }
    // 0 before any positive row: quiescent store — keep waiting for the start.
  } catch (e) {
    console.log(`${new Date().toISOString()} POLL_ERROR ${String(e.message).slice(0, 80)}`);
  }
  if (Date.now() > deadline) { console.log(`${new Date().toISOString()} DEADLINE_REACHED sawPositive=${sawPositive}`); cleanup(); process.exit(3); }
  setTimeout(poll, interval);
};
console.log(`${new Date().toISOString()} POLLER_START (terminal requires positive deleting rows first)`);
poll();
