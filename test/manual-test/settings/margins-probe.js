// Read-only EPUB geometry, without book text or settings credentials.
// node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/settings/margins-probe.js
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const views = rendition.manager.views._views.filter((view) => view.displayed && view.contents);
  return JSON.stringify({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    views: views.map((view) => {
      const doc = view.contents.document;
      const box = view.iframe.getBoundingClientRect();
      const body = doc.body.getBoundingClientRect();
      const css = doc.defaultView.getComputedStyle(doc.body);
      const paragraphs = Array.from(doc.querySelectorAll('p')).filter((p) => {
        const r = p.getBoundingClientRect();
        return r.width > 0 && box.top + r.bottom > 0 && box.top + r.top < window.innerHeight;
      });
      return {
        spine: view.section.index, iframeWidth: box.width,
        body: { left: body.left, width: body.width, paddingLeft: css.paddingLeft, paddingRight: css.paddingRight,
          marginLeft: css.marginLeft, marginRight: css.marginRight },
        paragraphs: paragraphs.slice(0, 3).map((p) => {
          const r = p.getBoundingClientRect();
          const style = doc.defaultView.getComputedStyle(p);
          return { left: r.left, width: r.width, marginLeft: style.marginLeft, marginRight: style.marginRight };
        }),
      };
    }),
  });
}
