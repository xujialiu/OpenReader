// Paired with end-spacer-geometry.js: reads the stage scroll box, the #LINE_ID
// range in stage CSS pixels, and the installed reserve rule, then answers one
// JSON line with the derived gap above the Player and scroll remaining.
/* global rendition */
function probe() {
  const lineId = 'ending';
  const out = {};
  try {
    const c = rendition.manager.container;
    const view = rendition.manager.views._views[0];
    const viewDoc = view.contents.document;
    const style = document.getElementById('openreader-bar');
    out.style = style ? style.textContent : null;
    out.scroll = { top: c.scrollTop, client: c.clientHeight, height: c.scrollHeight, width: c.clientWidth };
    const viewTop = view.element.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
    out.viewTop = viewTop;
    const line = viewDoc.getElementById(lineId);
    if (!line) { out.error = 'no #' + lineId; return JSON.stringify(out); }
    const range = viewDoc.createRange();
    range.selectNodeContents(line);
    out.lineRectsStage = Array.from(range.getClientRects()).map((r) => ({
      top: viewTop + r.top,
      bottom: viewTop + r.bottom,
      left: r.left,
      right: r.right,
    }));
    const s = out.scroll;
    const bottom = out.lineRectsStage[out.lineRectsStage.length - 1].bottom;
    out.playerTop = s.top + s.client;
    out.gapAbovePlayer = s.top + s.client - bottom;
    out.remaining = s.height - s.top - s.client;
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}
