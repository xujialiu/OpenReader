// Read-only paragraph boxes versus visible text rectangles (#360).
// node test/manual-test/kit/hx.cjs UDID '{}' --code-file test/manual-test/settings/whitespace-probe.js
// Coordinates are CSS pixels relative to each iframe; add iframeLeft for the
// page coordinate. Pair with current native window/safe-area measurements.
// No book text is returned. Header/Player occlusion is not modelled here.
/* global rendition */
// biome-ignore lint/correctness/noUnusedVariables: Invoked by the external harness.
function probe() { // eslint-disable-line no-unused-vars
  const height = window.innerHeight;
  const views = rendition.manager.views._views.filter((view) => view.displayed && view.contents);
  const measured = views.map((view) => {
    const doc = view.contents.document;
    const frame = view.iframe.getBoundingClientRect();
    const body = doc.body.getBoundingClientRect();
    const css = doc.defaultView.getComputedStyle(doc.body);
    const paragraphs = [];
    for (const [index, paragraph] of Array.from(doc.querySelectorAll('p')).entries()) {
      const box = paragraph.getBoundingClientRect();
      if (box.width <= 0 || frame.top + box.bottom <= 0 || frame.top + box.top >= height) continue;
      const range = doc.createRange();
      range.selectNodeContents(paragraph);
      const rects = Array.from(range.getClientRects()).filter((rect) =>
        rect.width > 0 && frame.top + rect.bottom > 0 && frame.top + rect.top < height);
      if (!rects.length) continue;
      paragraphs.push({
        index, left: box.left, width: box.width, right: box.right,
        inkRight: Math.max(...rects.map((rect) => rect.right)), textRects: rects.length,
      });
    }
    const rightmost = paragraphs.reduce((best, paragraph) =>
      !best || paragraph.inkRight > best.inkRight ? paragraph : best, null);
    return {
      spine: view.section.index, iframeLeft: frame.left, iframeWidth: frame.width,
      body: { left: body.left, width: body.width, paddingLeft: css.paddingLeft,
        paddingRight: css.paddingRight, marginLeft: css.marginLeft, marginRight: css.marginRight },
      visibleParagraphs: paragraphs.length,
      paragraphEdges: paragraphs.length
        ? [Math.min(...paragraphs.map((p) => p.left)), Math.max(...paragraphs.map((p) => p.right))] : null,
      rightmost,
    };
  });
  return JSON.stringify({
    viewport: [window.innerWidth, height],
    stageWidth: rendition.manager.container.getBoundingClientRect().width,
    displayedViews: measured.length,
    iframeWidths: measured.length
      ? [Math.min(...measured.map((v) => v.iframeWidth)), Math.max(...measured.map((v) => v.iframeWidth))] : null,
    views: measured.slice(0, 3), omittedViews: Math.max(0, measured.length - 3),
  });
}
