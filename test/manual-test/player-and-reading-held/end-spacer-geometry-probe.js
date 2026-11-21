// Paired with end-spacer-geometry.js: the stage scroll box, the #ending range
// in viewport CSS pixels, and the scroll remaining. Nothing here measures the
// painted Player; use the screenshot/AX card frame beside it.
/* global rendition */
function probe() {
  const out = {};
  try {
    const c = rendition.manager.container;
    const view = rendition.manager.views._views[0];
    const viewDoc = view.contents.document;
    const style = document.getElementById('openreader-bar');
    out.style = style ? style.textContent : null;
    out.scroll = { top: c.scrollTop, client: c.clientHeight, height: c.scrollHeight, width: c.clientWidth };
    const viewTop = view.element.getBoundingClientRect().top;
    const viewLeft = view.element.getBoundingClientRect().left;
    const line = viewDoc.getElementById('ending');
    if (!line) { out.error = 'no #ending'; return JSON.stringify(out); }
    const range = viewDoc.createRange();
    range.selectNodeContents(line);
    out.endingViewport = Array.from(range.getClientRects()).map((r) => ({
      top: viewTop + r.top,
      bottom: viewTop + r.bottom,
      left: viewLeft + r.left,
      right: viewLeft + r.right,
    }));
    out.remaining = c.scrollHeight - c.scrollTop - c.clientHeight;
    out.atLimit = out.remaining <= 1;
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}
