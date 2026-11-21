// Read the #371 end-spacer geometry from a running reader over the harness:
// the manager's stage scroll box, the last readable line's iframe range
// mapped into stage CSS pixels, the installed reserve rule, and the derived
// gap above the Player. One reusable measurement; it asserts nothing.
//
//   node test/manual-test/player-and-reading-held/end-spacer-geometry.js SIMULATOR_UDID [LINE_ID]
//
// LINE_ID defaults to `ending`; the fixture's last paragraph carries it.
// Raw answer is also written to the app's Debug Log as `[probe] …`, so the
// invocation's own stdout and the log line agree. It cannot prove a painted
// Player; pair it with a screenshot and the AX tree for that.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const [udid, lineId = 'ending'] = process.argv.slice(2);
if (!udid) {
  console.error('Usage: end-spacer-geometry.js SIMULATOR_UDID [LINE_ID]');
  process.exit(2);
}
const here = path.join(__dirname, 'end-spacer-geometry-probe.js');
execFileSync('node', [
  path.join(__dirname, '..', 'kit', 'hx.cjs'),
  udid,
  '{}',
  '--code-file',
  here,
], { stdio: 'inherit' });

// Provenance: 2026-11-21, #371 tester retest on ClearEnding371.epub at the
// scroll limit. With the Player expanded it answered gapAbovePlayer 132,
// remaining 0 (screenshot retest/screens/23-at-max-openplayer.png); after a
// genuine Following cue it answered gapAbovePlayer 132, remaining 32 while a
// 32 px note above the Player kept the scroll box from reaching the limit
// (screenshot 29-after-follow.png, sampler 29-sampler.jsonl). Unit note: the
// renderer's stage CSS box is 1.57 CSS px per screen point here, so a 132 CSS
// px gap is about 84 pt on screen; compare only within this probe's units.
