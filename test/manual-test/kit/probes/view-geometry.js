// Direct landing geometry for a Contents-row press (#307 form, corrected
// oracle for the 6e follow-up): for each view the manager holds, the view's
// iframe top in the scroll stage, its height, its first heading's text and
// that heading's top in stage coordinates. "Lands" is the pressed chapter's
// view top sitting at the bar's reserved band (54 pt on the phone) with its
// heading the pressed chapter's own, stable across two samples. Unlike the
// passage-anchor probe, this measures the pressed view directly and cannot be
// fooled by the previous section's tail still being visible.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/kit/probes/view-geometry.js
//
// Needs a Document open in the Reader. Reads only.
/* global rendition */
// eslint-disable-next-line no-unused-vars -- hx.cjs injects this standalone probe by name.
function probe() {
  let out = {};
  try {
    let m = rendition.manager;
    let stage = m.container;
    let st = stage.getBoundingClientRect();
    out.scrollTop = Math.round(stage.scrollTop);
    out.scrollH = stage.scrollHeight;
    out.views = m.views._views.map(function (v) {
      let e = { section: v.section && v.section.index };
      try {
        let f = v.iframe && v.iframe.getBoundingClientRect();
        e.viewTopInStage = f ? Math.round(f.top - st.top) : null;
        e.height = f ? Math.round(f.height) : null;
        let d = v.contents && v.contents.document;
        if (d) {
          let h = d.querySelector('h1,h2,h3');
          if (h) {
            e.h1 = (h.textContent || '').trim().slice(0, 40);
            e.h1TopInStage = f ? Math.round(f.top - st.top + h.getBoundingClientRect().top) : null;
          }
        }
      } catch (err) { e.err = String(err).slice(0, 60); }
      return e;
    });
  } catch (e) { out.error = String(e).slice(0, 100); }
  return JSON.stringify(out);
}
