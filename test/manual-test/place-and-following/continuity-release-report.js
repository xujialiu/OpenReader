// Restore the page's real React Native WebView bridge and deliver each exact
// section report held by continuity-hold-report.js, in its original order.
// The response excludes the report text.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file \
//     test/manual-test/place-and-following/continuity-release-report.js
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const gate = globalThis.__openreader271ReportGate;
  if (!gate) return 'report gate was not armed';
  if (!gate.held.length) {
    return JSON.stringify({ released: false, target: gate.target, heldCount: 0 });
  }
  gate.bridge.postMessage = gate.send;
  const held = gate.held.splice(0);
  held.forEach((item) => gate.send(item.raw));
  gate.releasedAt = Date.now();
  const result = {
    released: true,
    target: gate.target,
    count: held.length,
    sections: held.map((item) => ({
      sectionIndex: item.sectionIndex,
      section: item.section,
      blocks: item.blocks,
      bytes: item.bytes,
      receivedAt: item.receivedAt,
    })),
    releasedAt: gate.releasedAt,
  };
  delete globalThis.__openreader271ReportGate;
  return JSON.stringify(result);
}
