// Issue #346 D1: the lit highlight's box in viewport coordinates, for the
// Following-fold check ("real highlights inside usable width"). Sent with the
// harness's `js` command like every page probe. Read-only.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file \
//     test/manual-test/place-and-following/following-highlight.js
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const out = { viewport: [window.innerWidth, window.innerHeight] };
  try {
    const manager = rendition.manager;
    const frameRects = manager.views._views
      .filter((v) => v.displayed && v.iframe)
      .map((v) => {
        const r = v.iframe.getBoundingClientRect();
        return { section: v.section.index, left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
      });
    out.frames = frameRects;
    out.lit = [];
    manager.views._views.forEach((v) => {
      let win = null;
      try { win = v.contents && v.contents.window; } catch { /* no live document */ }
      if (!win || !win.CSS || !win.CSS.highlights) return;
      win.CSS.highlights.forEach((highlight, name) => {
        let first = null;
        highlight.forEach((range) => { if (first === null) first = range; });
        if (!first) return;
        const r = first.getBoundingClientRect();
        const f = v.iframe.getBoundingClientRect();
        out.lit.push({
          section: v.section.index,
          name: String(name),
          text: String(first).slice(0, 30),
          inFrame: [Math.round(r.left), Math.round(r.right), Math.round(r.top)],
          inViewport: [Math.round(f.left + r.left), Math.round(f.left + r.right), Math.round(f.top + r.top)],
        });
      });
    });
  } catch (e) {
    out.threw = String(e).slice(0, 80);
  }
  return JSON.stringify(out);
}
