// Hold one real section report from the installed reader page until
// continuity-release-report.js is sent through the same walkthrough harness.
// The report payload is kept only in this WebView; this probe never edits it.
//
// For #271 on continuity fixture: hold spine section 4, after sections 0–3
// have reported. This lets the Reading reach the end of its known text while
// a real later section has been rendered but not yet delivered to the app.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file \
//     test/manual-test/place-and-following/continuity-hold-report.js
//
// Re-running this probe reports only held metadata (index, href, block count);
// it never releases the message.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const existing = globalThis.__openreader271ReportGate;
  if (existing) {
    return JSON.stringify({
      armed: true,
      target: existing.target,
      held: existing.held.map((item) => ({
        sectionIndex: item.sectionIndex,
        section: item.section,
        blocks: item.blocks,
        bytes: item.bytes,
        receivedAt: item.receivedAt,
      })),
      releasedAt: existing.releasedAt || null,
    });
  }
  const bridge = window.ReactNativeWebView;
  if (!bridge || typeof bridge.postMessage !== 'function') return 'ReactNativeWebView.postMessage missing';
  const target = 4;
  const send = bridge.postMessage.bind(bridge);
  const gate = { bridge, send, target, held: [], releasedAt: null };
  bridge.postMessage = function (raw) {
    let message = null;
    try {
      message = JSON.parse(raw);
    } catch {
      // Non-JSON messages belong to the real bridge.
    }
    if (message && message.type === 'openreader:blocks' && message.sectionIndex === target) {
      gate.held.push({
        raw,
        sectionIndex: message.sectionIndex,
        section: message.section,
        blocks: Array.isArray(message.blocks) ? message.blocks.length : null,
        bytes: raw.length,
        receivedAt: Date.now(),
      });
      return;
    }
    return send(raw);
  };
  globalThis.__openreader271ReportGate = gate;
  const views = rendition && rendition.manager && rendition.manager.views
    ? rendition.manager.views._views.map((view) => view.section && view.section.index)
    : null;
  return JSON.stringify({ armed: true, target, views, held: [] });
}
