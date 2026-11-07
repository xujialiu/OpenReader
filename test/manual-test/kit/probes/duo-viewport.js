// Issue #346 checkpoint B: the reader page's own viewport numbers, for
// measuring the DOM side of a pose change. Run with:
//
//   node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{}' --code-file test/manual-test/kit/probes/duo-viewport.js
//
// Requires a mounted reader (the js command runs in the reader's page). The
// answer lands in the Debug Log as a `[probe]` line — kept under the log's
// 2,000-character budget — and on Metro's log. It reads sizes only; it
// touches nothing.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const w = window;
  const d = document;
  const out = {
    inner: [w.innerWidth, w.innerHeight],
    doc: [d.documentElement.clientWidth, d.documentElement.clientHeight],
    dpr: w.devicePixelRatio,
  };
  try {
    out.vv = w.visualViewport
      ? [Math.round(w.visualViewport.width), Math.round(w.visualViewport.height),
         Math.round(w.visualViewport.offsetTop), Math.round(w.visualViewport.offsetLeft),
         Math.round(w.visualViewport.scale * 100) / 100]
      : null;
    out.orientation = (w.screen && w.screen.orientation)
      ? `${w.screen.orientation.type}/${w.screen.orientation.angle}`
      : null;
    const m = rendition.manager;
    const c = m.container;
    const cr = c.getBoundingClientRect();
    out.container = [c.clientWidth, c.clientHeight, Math.round(cr.width), Math.round(cr.height)];
    const views = (m.views && m.views._views) || [];
    const v = views.find((x) => x.iframe) || views[0];
    if (v && v.iframe) {
      const r = v.iframe.getBoundingClientRect();
      out.iframe = [Math.round(r.width), Math.round(r.height)];
    }
    out.views = views.length;
  } catch (e) {
    out.err = String(e).slice(0, 60);
  }
  return JSON.stringify(out);
}
