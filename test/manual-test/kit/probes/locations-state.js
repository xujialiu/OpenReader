// Reader Locations state for the #255 manual checks: whether the page holds a
// Locations index, and how much of the spine is loaded, at the moment of the
// call. Sent twice about twelve seconds apart, it shows the index staying
// empty and the loaded set staying bounded (no whole-spine scan on open, and
// none again after a page-process restart). It is a state read, not a
// performance measurement.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/kit/probes/locations-state.js
//
// The answer lands in the Debug Log as a `[probe]` line. Needs a Document
// open in the Reader (the reader view answers `js` commands). Reads only.
//
// locationsLength  book.locations.length(): entries in the Locations index.
//                  0 from `locations.load([])` (#255) and while generate()
//                  has not run; growing towards spineTotal would be a scan.
// spineTotal       how many spine items the document declares.
// loadedSections   spine items with a loaded document: the views epub.js is
//                  actually holding, bounded by the visible area and
//                  renderAhead; unbounded growth over time is the scan.
// loadedFirst      the first few loaded indexes, for the report.
// views            the section indexes the manager keeps as views.
/* global book, rendition */
// eslint-disable-next-line no-unused-vars -- hx.cjs injects this standalone probe by name.
function probe() {
  let out = {};
  try {
    out.href = String(location.href).slice(0, 80);
    out.book = typeof book;
    if (typeof book === 'undefined') return JSON.stringify(out);
    if (book.locations) {
      out.locationsLength =
        typeof book.locations.length === 'function' ? book.locations.length() : null;
      out.locationsTotal = typeof book.locations.total;
    }
    if (book.spine) {
      const items = book.spine.spineItems || [];
      out.spineTotal = items.length;
      let loaded = 0;
      const first = [];
      items.forEach(function (item, index) {
        if (item && item.document) {
          loaded++;
          if (first.length < 12) first.push(index);
        }
      });
      out.loadedSections = loaded;
      out.loadedFirst = first;
    }
    if (typeof rendition !== 'undefined' && rendition.manager && rendition.manager.views) {
      out.views = rendition.manager.views._views.map(function (v) {
        return v.section && v.section.index;
      });
    }
  } catch (e) {
    out.error = String(e).slice(0, 120);
  }
  return JSON.stringify(out);
}
