/* global rendition */
// #354 tester helper (duo-sim-runtime, 2026-11-08): a visible-character anchor
// near the top of the exposed page: CFI of the first character of the first
// fully visible text run below the header, its viewport rect, and the scroll.
// Read-only; sent with hx.cjs --code-file like every page probe.
// eslint-disable-next-line no-unused-vars
function probe() {
  const out = {};
  try {
    const manager = rendition.manager;
    const view = manager.views._views.find((v) => v.displayed && v.iframe);
    if (!view) { out.err = 'no displayed view'; return JSON.stringify(out); }
    const doc = view.contents.document;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node = null;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      if (!text.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.top >= 90 && r.bottom <= 400 && r.left >= 0 && r.height > 0) {
        const single = doc.createRange();
        single.setStart(node, text.search(/\S/));
        single.setEnd(node, text.search(/\S/) + 1);
        const sr = single.getBoundingClientRect();
        out.char = text.trim()[0];
        out.cfi = view.contents.cfiFromRange(single);
        out.rect = [Math.round(sr.left), Math.round(sr.top), Math.round(sr.width), Math.round(sr.height)];
        out.nodeTop = Math.round(r.top);
        out.scroll = Math.round(view.contents.window.scrollY);
        return JSON.stringify(out);
      }
    }
    out.err = 'no fully visible text run in the upper band';
  } catch (e) { out.err = String(e).slice(0, 80); }
  return JSON.stringify(out);
}
