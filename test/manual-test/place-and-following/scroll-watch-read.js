// #307 read: dump the scrollTo record `scroll-watch-arm.js` collected, with
// the current scroll position and where the fragment now sits. Generate per
// fragment (`sed -e 's/__FRAGMENT__/<id>/'`) and send the same way.
function probe() {
  var FRAG = '__FRAGMENT__';
  var m = rendition.manager;
  if (!m) return JSON.stringify({ error: 'no manager' });
  var out = { frag: FRAG, scrolls: m.__owScrolls || null, now: Date.now() % 10000000 };
  try {
    var stage = m.container;
    var stageRect = stage.getBoundingClientRect();
    out.scrollTop = Math.round(stage.scrollTop);
    m.views._views.forEach(function (v) {
      var win = null;
      try { win = v.contents && v.contents.window; } catch (e) { }
      if (!win || !win.document) return;
      var el = win.document.getElementById(FRAG);
      if (!el) return;
      var frame = win.frameElement;
      var frameTop = frame ? frame.getBoundingClientRect().top : NaN;
      var r = el.getBoundingClientRect();
      out.h2TopInStage = Math.round(frameTop - stageRect.top + r.top);
      out.h2TopInDoc = Math.round(r.top);
      out.scrollHeight = el.ownerDocument.documentElement.scrollHeight;
    });
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}
