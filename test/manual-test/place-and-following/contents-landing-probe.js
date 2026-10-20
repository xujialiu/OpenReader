// #307 landing probe: where a Contents row's target heading sits in the
// reader's scroll container, measured from the reader's page. Generated per
// fragment with `sed -e 's/__FRAGMENT__/<id>/'` and sent by
// `node test/manual-test/kit/hx.cjs UDID '{}' --code-file THIS_FILE`; the
// answer comes back as an `[probe]` line in the Debug Log and `HX PROBE` in
// Metro's log.
//
// "Lands" is `h2TopInStage` 54 (the bar's reserved `.epub-container::before`
// height, read back as `barCss`) at about t0 and again about 2 s later. The
// `h2TopInDoc`/`scrollTop` pair tells a drift of the content above the heading
// (scrollTop == the heading's pre-growth position) from a scroll that never
// happened (scrollTop at the view top).
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  let FRAG = '__FRAGMENT__';
  let out = { frag: FRAG };
  try {
    let m = rendition.manager;
    let stage = m && m.container;
    if (!stage) return JSON.stringify({ frag: FRAG, error: 'no manager.container' });
    let stageRect = stage.getBoundingClientRect();
    out.scrollTop = Math.round(stage.scrollTop);
    out.scrollH = stage.scrollHeight;
    let bar = document.getElementById('openreader-bar');
    out.barCss = bar ? bar.textContent.trim() : null;
    out.views = [];
    m.views._views.forEach(function (v) {
      let entry = { section: v.section && v.section.index };
      let win = null;
      try { win = v.contents && v.contents.window; } catch (_e) { /* view without a live document */ }
      if (!win || !win.document) { out.views.push([entry.section, 'no-doc']); return; }
      let el = win.document.getElementById(FRAG);
      if (!el) { out.views.push(entry); return; }
      let frame = win.frameElement;
      let frameTop = frame ? frame.getBoundingClientRect().top : NaN;
      let r = el.getBoundingClientRect();
      entry.h2TopInStage = Math.round(frameTop - stageRect.top + r.top);
      entry.h2TopInDoc = Math.round(r.top);
      entry.frameTopInStage = Math.round(frameTop - stageRect.top);
      entry.h2Text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
      out.views.push(entry);
    });
  } catch (e) { out.error = String(e); }
  return JSON.stringify(out);
}
