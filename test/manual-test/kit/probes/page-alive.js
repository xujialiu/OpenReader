// Whether the reader's page is the one the Reader opened, or a page with no
// book in it: for a blank reader whose renderer has stopped logging. Run with
// phone-hx.cjs --code-file, which appends the call.
//
// born      performance.timeOrigin: when this page was created. A page created
//           after the book was opened is not the page that opened it (its web
//           content process was replaced).
// up        seconds since then
// rendition, book   typeof each global; 'undefined' means no book on this page
// views     epub.js's views: spine index : d displayed : height
// body      element count under <body>, and the page's height
// lit       what each section's CSS highlights hold: name, then the first 40
//           characters of its first range (the sentence painted, the word)
/* global rendition, book */
// eslint-disable-next-line no-unused-vars
function probe() {
  let out = {};
  try {
    out.href = String(location.href).slice(0, 80);
    out.born = new Date(performance.timeOrigin).toISOString();
    out.up = Math.round(performance.now() / 1000);
    out.ready = document.readyState;
    out.visibility = document.visibilityState;
    out.rendition = typeof rendition;
    out.book = typeof book;
    out.body = document.body ? [document.body.getElementsByTagName('*').length, document.body.scrollHeight] : null;
    if (typeof rendition !== 'undefined' && rendition.manager && rendition.manager.views) {
      out.views = rendition.manager.views._views.map(function (v) {
        return [v.section && v.section.index, v.displayed ? 'd' : '-', Math.round((v.element && v.element.offsetHeight) || 0)].join(':');
      });
      out.lit = [];
      rendition.manager.views._views.forEach(function (v) {
        let win = null;
        try { win = v.contents && v.contents.window; } catch { /* a view without a live document */ }
        if (!win || !win.CSS || !win.CSS.highlights) return;
        win.CSS.highlights.forEach(function (highlight, name) {
          let first = null;
          highlight.forEach(function (range) { if (first === null) first = range; });
          if (first) out.lit.push(v.section.index + ':' + name + ':' + String(first).slice(0, 40));
        });
      });
    }
  } catch (e) {
    out.error = String(e);
  }
  return JSON.stringify(out);
}
