#!/usr/bin/env node
// One Document's persisted Reading Position and Stamp, exactly as the Library
// wrote them to disk (#96 evidence: what a paused tap or a failed Play must
// NOT change, and what an actual Play at the cursor must).
//
//   node test/manual-test/place-and-following/entry-place.cjs SIMULATOR_UDID DOCUMENT_ID
//
// Prints one JSON line: { id, title, position: { cfi, anchor: {exact, offset},
// stamp: {at, device} } | null, stamp: {at, device} }, read from the app
// container's Documents/library.json (the same file `writeLibrary` writes and
// the next launch reads — not a probe into the running app). Exit 1 when the
// id is not in the Library. The values are the owner's reading: never commit
// them into fixtures or logs beyond what a recipe quotes.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [device, id] = process.argv.slice(2);
if (!device || !id) {
  console.error('Usage: entry-place.cjs SIMULATOR_UDID DOCUMENT_ID');
  process.exit(2);
}
const container = execFileSync('xcrun', ['simctl', 'get_app_container', device, 'top.xujialiu.openreader', 'data']).toString().trim();
const raw = JSON.parse(fs.readFileSync(path.join(container, 'Documents', 'library.json'), 'utf8'));
const entry = (raw.entries ?? []).find((one) => one.id === id);
if (!entry) {
  console.error(`no entry ${id} in library.json (${(raw.entries ?? []).length} entries)`);
  process.exit(1);
}
const out = {
  id: entry.id,
  title: entry.title,
  position: entry.position
    ? {
        cfi: entry.position.locator?.locations?.cfi ?? entry.position.locator ?? null,
        anchor: entry.position.anchor ?? null,
        stamp: entry.position.stamp ?? null,
      }
    : null,
  stamp: entry.stamp ?? null,
};
console.log(JSON.stringify(out));
