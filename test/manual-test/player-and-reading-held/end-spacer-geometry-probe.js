// hx.cjs evaluates this function inside the reader WebView.
/* global rendition */
// eslint-disable-next-line no-unused-vars -- hx.cjs appends the call.
function probe() {
  const out = {};
  try {
    const c = rendition.manager.container;
    const contents = rendition.getContents().find((item) => item.document.getElementById('ending'));
    if (!contents) return JSON.stringify({ error: 'no mounted #ending' });
    const viewDoc = contents.document;
    const style = document.getElementById('openreader-bar');
    out.style = style ? style.textContent : null;
    out.scroll = { top: c.scrollTop, client: c.clientHeight, height: c.scrollHeight, width: c.clientWidth };
    const frame = contents.window.frameElement.getBoundingClientRect();
    const line = viewDoc.getElementById('ending');
    const range = viewDoc.createRange();
    range.selectNodeContents(line);
    out.endingViewport = Array.from(range.getClientRects()).map((r) => ({
      top: frame.top + r.top,
      bottom: frame.top + r.bottom,
      left: frame.left + r.left,
      right: frame.left + r.right,
    }));
    out.remaining = c.scrollHeight - c.scrollTop - c.clientHeight;
    out.atLimit = Math.abs(out.remaining) <= 1;
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}
