// Issue #346: the on-screen point of a chosen word in the reader page, for a
// calibrated real long-press (lookup control). Sent with the harness `js`
// command like every page probe; read-only.
//
//   node test/manual-test/kit/hx.cjs UDID '{"do":"js","code":"..."}' --code-file \
//     test/manual-test/library-and-reader/lookup-word-frame.js
//
// The default WORD is `hope` (the lookup-words-fixture's first example).
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const WORD = 'hope';
  const out = { word: WORD };
  try {
    const manager = rendition.manager;
    const view = manager.views._views.find((v) => v.displayed && v.iframe);
    if (!view) { out.err = 'no displayed view'; return JSON.stringify(out); }
    const doc = view.contents.document;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node = null;
    while ((node = walker.nextNode())) {
      if (node.textContent.indexOf(WORD) >= 0) break;
    }
    if (!node) { out.err = 'word not found on the displayed page'; return JSON.stringify(out); }
    const idx = node.textContent.indexOf(WORD);
    const range = doc.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + WORD.length);
    const r = range.getBoundingClientRect();
    const f = view.iframe.getBoundingClientRect();
    const left = f.left + r.left;
    const top = f.top + r.top;
    out.inViewport = [Math.round(left), Math.round(left + r.width), Math.round(top), Math.round(top + r.height)];
    out.press = [Math.round(left + r.width / 2), Math.round(top + r.height / 2)];
    out.frame = [Math.round(f.left), Math.round(f.top), Math.round(f.width)];
  } catch (e) {
    out.err = String(e).slice(0, 80);
  }
  return JSON.stringify(out);
}
