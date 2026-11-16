// Passage anchor for no-jump checks (#366 audit): identity + screen rect of
// the first paragraph visible at the top of the reading viewport.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/kit/probes/passage-anchor.js
//
// The answer lands in the Debug Log as a `[probe]` line (collect with
// kit/probe-answers.py). In epub.js continuous mode each section is its own
// iframe inside the manager container, so the paragraph is located per view
// and its container-viewport y is iframeRect.top + paragraphRect.top (the
// section documents do not scroll internally in this mode). Reads only; it
// touches nothing and stays well under the Debug Log's 2,000-char budget.
/* global rendition */
/* eslint-disable no-unused-vars -- hx.cjs injects this standalone probe by name. */
// biome-ignore lint/correctness/noUnusedVariables: hx.cjs injects this standalone probe by name.
function probe() {
  try {
    const m = rendition.manager;
    const c = m.container;
    const out = {
      scrollTop: Math.round(c.scrollTop),
      clientH: c.clientHeight,
      scrollH: c.scrollHeight
    };
    const views = m.views?._views || [];
    let found = null;
    for (let i = 0; i < views.length && !found; i++) {
      const v = views[i];
      if (!v.iframe || !v.contents?.document) continue;
      const ir = v.iframe.getBoundingClientRect();
      if (ir.bottom < 0 || ir.top > c.clientHeight) continue;
      const paras = v.contents.document.querySelectorAll('p,h1,h2,h3,h4,blockquote');
      for (let k = 0; k < paras.length; k++) {
        const pr = paras[k].getBoundingClientRect();
        if (pr.height < 10) continue;
        const visTop = ir.top + pr.top;
        if (visTop >= -20 && visTop < c.clientHeight - 20) {
          const txt = (paras[k].textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt) continue;
          let h = 0;
          for (let j = 0; j < txt.length && j < 300; j++) {
            h = (h * 31 + txt.charCodeAt(j)) >>> 0;
          }
          found = {
            visTop: Math.round(visTop * 10) / 10,
            left: Math.round((ir.left + pr.left) * 10) / 10,
            hgt: Math.round(pr.height * 10) / 10,
            len: txt.length,
            head: txt.slice(0, 70),
            hash: h,
            view: v.section ? v.section.index : null
          };
          break;
        }
      }
    }
    if (!found) {
      out.err = 'no visible paragraph';
      return JSON.stringify(out);
    }
    out.p = found;
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ err: String(e).slice(0, 80) });
  }
}
