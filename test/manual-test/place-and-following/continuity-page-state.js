// The reader page's view list, offscreen preparation hosts, iframes and lit
// highlights, for the reading-continuity verification (#153/#161/#170/#156).
// Sent with the harness's `js` command, which runs `probe()` in the reader's
// WebView page and posts the answer as a `[probe]` line:
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file \
//     test/manual-test/place-and-following/continuity-page-state.js
//
// views     epub.js's visible views: spine index : d displayed : height px
// hosts     direct <body> children styled as the temporary offscreen
//           preparation host (`left:-200vw`): what prepareSection appends and
//           must remove. 1 while a preparation is in flight is expected; any
//           left behind after it finished is a leak.
// iframes   every iframe in the page (visible views + any live preparation).
// lit       what each section's CSS highlights hold: spine:name:first-40-chars.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const out = {};
  try {
    out.href = String(location.href).slice(0, 60);
    if (typeof rendition === 'undefined' || !rendition.manager || !rendition.manager.views) {
      out.views = null;
    } else {
      out.views = rendition.manager.views._views.map(function (v) {
        return [v.section && v.section.index, v.displayed ? 'd' : '-', Math.round((v.element && v.element.offsetHeight) || 0)].join(':');
      });
    }
    out.hosts = Array.from(document.body ? document.body.children : []).filter(function (e) {
      return (e.getAttribute && (e.getAttribute('style') || '').indexOf('-200vw') >= 0) || (e.getAttribute && e.getAttribute('aria-hidden') === 'true');
    }).map(function (e) {
      return (e.getAttribute('style') || '').slice(0, 60);
    });
    out.iframes = document.querySelectorAll('iframe').length;
    out.lit = [];
    if (typeof rendition !== 'undefined' && rendition.manager && rendition.manager.views) {
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
    out.threw = String(e);
  }
  return JSON.stringify(out);
}
