// Read the #371 end-spacer geometry from a running reader over the harness:
// the stage scroll box, the last readable line's range in VIEWPORT CSS pixels
// (the manager container's own coordinate space; on this device one viewport
// CSS pixel is one screen point), and the scroll remaining at the limit.
//
//   node test/manual-test/player-and-reading-held/end-spacer-geometry.js SIMULATOR_UDID
//
// The answer is the harness's own `[probe] …` Debug Log line; this wrapper
// only sends the command. Pair it with a screenshot or the AX tree for the
// painted card: a viewport coordinate is not a card frame, and the container's
// client box can end above the card when a page note is open.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const [udid] = process.argv.slice(2);
if (!udid) {
  console.error('Usage: end-spacer-geometry.js SIMULATOR_UDID');
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
