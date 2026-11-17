// Reader Locations state for the #255 manual checks: whether the page took the
// empty-Locations branch, and how much of the spine is loaded, at the moment
// of the call. Sent twice about twelve seconds apart, it shows the index
// staying empty and the loaded set staying bounded (no whole-spine scan on
// open, and none again after a page-process restart). It is a state read, not
// a performance measurement.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/kit/probes/locations-state.js
//
// The answer lands in the Debug Log as a `[probe]` line. Needs a Document
// open in the Reader (the reader view answers `js` commands). Reads only.
//
// initialLocationsIsEmptyArray  the page's actual `initialLocations` lexical
//                  binding — the const the template's init branch tests —
//                  read directly from the global lexical scope. `true` means
//                  the template's `if (initialLocations)` branch was fed the
//                  stable empty array and `locations.load([])` ran, so
//                  `locations.generate()` never started (#255). This, plus
//                  `locationsLength` staying 0, is the no-scan evidence.
//                  (The binding is declared `const` at the top level of the
//                  template's script: reachable by name from a later script,
//                  and deliberately NOT a `window` property —
//                  `initialLocationsIsWindowProperty` documents that, so a
//                  null window read cannot be mistaken for absence.)
// locationsLength  book.locations.length(): entries in the Locations index.
//                  0 from `locations.load([])`; growth towards spineTotal
//                  would mean a generate() scan is running or has run.
// spineTotal       how many spine items the document declares.
// loadedSections   spine items currently holding a loaded document.
//                  INFORMATIONAL ONLY, and not monotonic: the library's
//                  continuous manager loads and UNLOADS views as the page
//                  moves (and epub.js may retain documents for views it
//                  destroyed), so a bounded set alone does not prove that no
//                  scan ran. The proof is the empty lexical input above plus
//                  locationsLength staying 0; use loadedSections only as a
//                  sanity bound, never as the no-scan claim.
// loadedFirst      the first few loaded indexes, for the report.
// views            the section indexes the manager keeps as views.
/* global book, rendition, initialLocations */
// eslint-disable-next-line no-unused-vars -- hx.cjs injects this standalone probe by name.
function probe() {
  let out = {};
  try {
    out.href = String(location.href).slice(0, 80);
    out.book = typeof book;
    // The template's own init input, read by its declared name. `typeof`
    // guards the ReferenceError an undeclared lexical binding would throw.
    out.initialLocationsTypeof = typeof initialLocations;
    out.initialLocationsIsEmptyArray =
      typeof initialLocations !== 'undefined' &&
      Array.isArray(initialLocations) &&
      initialLocations.length === 0;
    // A top-level `const` is a global LEXICAL binding, not a window property;
    // reading it off window answers undefined even while the binding exists.
    out.initialLocationsIsWindowProperty =
      typeof window !== 'undefined' && 'initialLocations' in window;
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
