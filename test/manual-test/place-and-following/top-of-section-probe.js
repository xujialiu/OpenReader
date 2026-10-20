// #307 control probe: where each displayed view's top and first heading sit in
// the reader's scroll container — for a book whose chapters each have a file,
// where a Contents row has no fragment and the chapter's top is the target.
// Sent by `hx.cjs --code-file` like the others.
function probe() {
  var m = rendition.manager;
  if (!m) return JSON.stringify({ error: 'no manager' });
  var stage = m.container;
  var stageRect = stage.getBoundingClientRect();
  var out = { scrollTop: Math.round(stage.scrollTop), bar: null, views: [] };
  try {
    var bar = document.getElementById('openreader-bar');
    out.bar = bar ? bar.textContent.trim() : null;
  } catch (e) { }
  m.views._views.forEach(function (v) {
    var win = null;
    try { win = v.contents && v.contents.window; } catch (e) { }
    if (!win || !win.document) { out.views.push([v.section && v.section.index, 'no-doc']); return; }
    var frame = win.frameElement;
    var frameTop = frame ? frame.getBoundingClientRect().top : NaN;
    var entry = { section: v.section && v.section.index, frameTopInStage: Math.round(frameTop - stageRect.top) };
    var el = win.document.querySelector('h1,h2,h3');
    if (el) {
      var r = el.getBoundingClientRect();
      entry.firstHeadingTopInStage = Math.round(frameTop - stageRect.top + r.top);
      entry.firstHeading = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44);
    }
    out.views.push(entry);
  });
  return JSON.stringify(out);
}
