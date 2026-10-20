// #307 control probe: where each displayed view's top and first heading sit in
// the reader's scroll container — for a book whose chapters each have a file,
// where a Contents row has no fragment and the chapter's top is the target.
// Sent by `hx.cjs --code-file` like the others.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  let m = rendition.manager;
  if (!m) return JSON.stringify({ error: 'no manager' });
  let stage = m.container;
  let stageRect = stage.getBoundingClientRect();
  let out = { scrollTop: Math.round(stage.scrollTop), bar: null, views: [] };
  try {
    let bar = document.getElementById('openreader-bar');
    out.bar = bar ? bar.textContent.trim() : null;
  } catch (_e) { }
  m.views._views.forEach(function (v) {
    let win = null;
    try { win = v.contents && v.contents.window; } catch (_e) { }
    if (!win || !win.document) { out.views.push([v.section && v.section.index, 'no-doc']); return; }
    let frame = win.frameElement;
    let frameTop = frame ? frame.getBoundingClientRect().top : NaN;
    let entry = { section: v.section && v.section.index, frameTopInStage: Math.round(frameTop - stageRect.top) };
    let el = win.document.querySelector('h1,h2,h3');
    if (el) {
      let r = el.getBoundingClientRect();
      entry.firstHeadingTopInStage = Math.round(frameTop - stageRect.top + r.top);
      entry.firstHeading = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44);
    }
    out.views.push(entry);
  });
  return JSON.stringify(out);
}
