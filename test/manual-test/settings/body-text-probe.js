// Read-only computed typography, without book text or settings credentials.
// node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/settings/body-text-probe.js
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  return JSON.stringify(rendition.getContents().map((contents) => {
    const doc = contents.document;
    const win = doc.defaultView;
    if (!doc.body || !win) return { section: contents.sectionIndex, live: false };
    const counts = new Map();
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let scanned = 0;
    let node;
    while (scanned < 5000 && (node = walker.nextNode())) {
      const element = node.parentElement;
      if (!element || /^(SCRIPT|STYLE)$/.test(element.tagName)) continue;
      const characters = node.data.replace(/\s+/g, '').length;
      if (!characters) continue;
      scanned += characters;
      const style = win.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const px = Number.parseFloat(style.fontSize);
      if (px > 0) counts.set(px, (counts.get(px) ?? 0) + characters);
    }
    const sizes = [...counts].sort((a, b) => b[1] - a[1]);
    return {
      section: contents.sectionIndex,
      adjust: win.getComputedStyle(doc.documentElement).getPropertyValue('-webkit-text-size-adjust'),
      dominant: sizes[0] ?? null,
      smallest: sizes.length ? Math.min(...sizes.map(([px]) => px)) : null,
      headings: [...new Set(Array.from(doc.querySelectorAll('h1,h2,h3')).map((h) => Number.parseFloat(win.getComputedStyle(h).fontSize)))].slice(0, 3),
    };
  }));
}
