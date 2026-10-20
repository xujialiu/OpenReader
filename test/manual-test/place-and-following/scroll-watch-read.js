// #307 read: dump the scrollTo record `scroll-watch-arm.js` collected, with
// the current scroll position and where the fragment now sits. Generate per
// fragment (`sed -e 's/__FRAGMENT__/<id>/'`) and send the same way.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  let FRAG = '__FRAGMENT__';
  let m = rendition.manager;
  if (!m) return JSON.stringify({ error: 'no manager' });
  let out = { frag: FRAG, scrolls: m.__owScrolls || null, now: Date.now() % 10000000 };
  try {
    let stage = m.container;
    let stageRect = stage.getBoundingClientRect();
    out.scrollTop = Math.round(stage.scrollTop);
    m.views._views.forEach(function (v) {
      let win = null;
      try { win = v.contents && v.contents.window; } catch (_e) { }
      if (!win || !win.document) return;
      let el = win.document.getElementById(FRAG);
      if (!el) return;
      let frame = win.frameElement;
      let frameTop = frame ? frame.getBoundingClientRect().top : NaN;
      let r = el.getBoundingClientRect();
      out.h2TopInStage = Math.round(frameTop - stageRect.top + r.top);
      out.h2TopInDoc = Math.round(r.top);
      out.scrollHeight = el.ownerDocument.documentElement.scrollHeight;
    });
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}
