// Issue #346: the DOM selection's exact boundaries for every displayed
// iframe — selection text plus anchor/focus node offsets — for the paired
// range-continuity checks. Sent with the harness `js` command
// (hx.cjs appends `return probe();`, so the file must define `probe`).
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const manager = rendition.manager;
  const out = [];
  manager.views._views.forEach((view) => {
    if (!(view.displayed && view.contents)) return;
    let sel = { text: '', anchorOffset: null, focusOffset: null, collapsed: null, section: view.section.index };
    try {
      const s = view.contents.window.getSelection();
      sel.text = s.toString().slice(0, 80);
      sel.collapsed = s.isCollapsed;
      if (s.rangeCount > 0) {
        const r = s.getRangeAt(0);
        sel.anchorOffset = s.anchorOffset;
        sel.focusOffset = s.focusOffset;
        sel.startContainerKind = r.startContainer.nodeType;
        sel.endContainerKind = r.endContainer.nodeType;
        sel.startText = String(r.startContainer.textContent || '').slice(Math.max(0, r.startOffset - 20), r.startOffset + 20);
      }
    } catch (e) { sel.err = String(e).slice(0, 40); }
    out.push(sel);
  });
  return JSON.stringify({ frames: out });
}
