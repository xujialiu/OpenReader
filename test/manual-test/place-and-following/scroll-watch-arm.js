// #307 arm: wrap `rendition.manager.scrollTo` to record every scroll the
// manager makes through the method (time modulo 10^7, left, top), then clear
// the record. Sent before a Contents press by
// `node test/manual-test/kit/hx.cjs UDID '{}' --code-file THIS_FILE`.
//
// It hears only calls made through `manager.scrollTo`: the app's own page
// program and any direct `container.scrollTop =` assignment bypass it, so an
// empty record with the page moved means something else did the moving. Read
// the record with `scroll-watch-read.js`.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  let m = rendition.manager;
  if (!m) return JSON.stringify({ error: 'no manager' });
  if (!m.__owScrolls) {
    m.__owScrolls = [];
    let orig = m.scrollTo;
    m.scrollTo = function (x, y, silent) {
      m.__owScrolls.push([Date.now() % 10000000, Math.round(x), Math.round(y)]);
      return orig.apply(this, arguments);
    };
  }
  m.__owScrolls.length = 0;
  return JSON.stringify({ armed: true });
}
