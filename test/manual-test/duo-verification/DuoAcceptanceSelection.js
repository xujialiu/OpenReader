// #350: exact native Selection range, not proof of painting or usable handles.
// kit/hx.cjs --code-file; only selected live iframes are returned (bounded log).
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const ranges = [];
  for (const view of rendition.manager.views._views) {
    if (!view.displayed || !view.contents?.document?.defaultView) continue;
    const selection = view.contents.window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) continue;
    const range = selection.getRangeAt(0);
    const frame = view.iframe.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
    const box = r => [r.left + frame.left, r.top + frame.top, r.width, r.height].map(n => Math.round(n * 10) / 10);
    ranges.push({
      section: view.section.index, text: String(range).slice(0, 160),
      cfi: view.contents.cfiFromRange(range),
      start: range.startOffset, end: range.endOffset,
      anchor: selection.anchorOffset, focus: selection.focusOffset,
      backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset,
      rects: rects.slice(0, 4).map(box), rectCount: rects.length,
    });
  }
  if (ranges.length > 1) throw new Error('More than one selected live iframe; retain and investigate separately');
  return JSON.stringify({ at: Date.now(), viewport: [window.innerWidth, window.innerHeight], ranges });
}
