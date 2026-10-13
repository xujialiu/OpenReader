#!/usr/bin/env node
// Read the open Reading's Utterances (the sentences the page's walk made) off
// the running Debug app through CDP, one JSON line. Used by the Block-walk
// verification of #184/#189/#192 (1.0.0 (8)-beta15).
//
//   OPENREADER_METRO=http://127.0.0.1:8093 node walk-utts.cjs
//
// It walks the React fiber tree for a hook whose state is a ref holding the
// loaded Utterance list ({text, spans}), the array `use-reading` keeps in
// `loadedRef`. What it cannot prove: it reads the Reading's own list, not the
// painted highlight; the highlight evidence is screenshots and the page probe.
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const output = mkdtempSync(join(tmpdir(), 'openreader-walk-utts-'));
const file = join(output, 'probe.js');
writeFileSync(file, `(() => {
  const seen = [];
  function hooksOf(fiber) {
    let hook = fiber.memoizedState; const found = [];
    for (let i = 0; i < 80 && hook; i++) { found.push(hook.memoizedState); hook = hook.next; }
    return found;
  }
  function walk(f) {
    if (!f || seen.length) return;
    if (typeof f.type === 'function' && f.memoizedState) {
      for (const state of hooksOf(f)) {
        const v = state && typeof state === 'object' && 'current' in state ? state.current : null;
        if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' &&
            typeof v[0].text === 'string' && Array.isArray(v[0].spans)) { seen.push(v); return; }
      }
    }
    walk(f.child); walk(f.sibling);
  }
  const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
  if (!seen.length) throw new Error('no loaded Utterance list found; is a Document open?');
  return JSON.stringify(seen[0].map((u, i) => [i, u.text]));
})()`);
let out;
try {
  out = execFileSync(process.execPath, [require.resolve('../kit/cdp.cjs'), '--eval', file], {
    timeout: 20000, env: { ...process.env }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
} catch (error) {
  console.error(error.stderr || error.message);
  process.exit(1);
}
const parsed = JSON.parse(out);
process.stdout.write(parsed.value + '\n');
