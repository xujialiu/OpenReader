// #350 red-loop: DOM-derived press point for the quoted fixture word, read at
// the CURRENT layout (never historic coordinates). Read-only: creates one
// throwaway DOM Range to measure the word box, mutates nothing.
/* global rendition, __r */
function probe() { // eslint-disable-line no-unused-vars
  for (const view of rendition.manager.views._views) {
    if (!view.displayed || !view.contents?.document?.defaultView) continue;
    const doc = view.contents.document;
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf('hope');
      if (idx < 0) continue;
      const r = doc.createRange();
      r.setStart(node, idx);
      r.setEnd(node, idx + 4);
      const rect = r.getBoundingClientRect();
      const frame = view.iframe.getBoundingClientRect();
      return JSON.stringify({
        at: Date.now(),
        rect: [Math.round((rect.left + frame.left) * 10) / 10, Math.round((rect.top + frame.top) * 10) / 10,
               Math.round(rect.width * 10) / 10, Math.round(rect.height * 10) / 10],
        viewport: [window.innerWidth, window.innerHeight],
        text: node.textContent.slice(Math.max(0, idx - 12), idx + 18),
      });
    }
  }
  return JSON.stringify({ error: 'no-displayed-view-or-word' });
}
