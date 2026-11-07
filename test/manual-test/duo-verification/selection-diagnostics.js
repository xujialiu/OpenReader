// #350/#355: fixture-only H1/H4/H5 observations, NOT native paint/handle proof.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe(marker = 'selection-' + Date.now()) {
  const base = { tag: 'DEBUG-SELECTION', schema: 1, section: 0, at: Date.now(), marker: null };
  let reason = 'unavailable-field';
  const block = (why) => { reason = why; throw new Error(); };
  const small = (value, max = 64) => {
    if (typeof value !== 'string' || value.length > max || /[^\x20-\x7e]/.test(value)) block('field-limit');
    return value;
  };
  const tag = (element) => element ? small(element.tagName, 20) : null;
  const id = (element) => {
    if (!element) return null;
    const value = small(element.id);
    if (!/^epubjs-view-[a-f0-9-]{1,40}$/.test(value)) block('non-fixture-id');
    return value;
  };
  try {
    if (typeof marker !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(marker)) block('invalid-marker');
    base.marker = marker;
    const views = rendition.manager.views._views;
    if (views.length > 16) block('view-limit');
    const matching = views.filter(view => view.section.index === 0);
    if (!matching.length || matching.length > 2) block('instance-limit');
    const outer = document;
    const instances = matching.map(view => {
      const frame = view.iframe, doc = view.contents?.document, win = doc?.defaultView;
      const item = { view: id(view), frame: id(frame), displayed: !!view.displayed,
        connected: !!frame?.isConnected, available: !!win };
      if (!win) return item;
      if (doc.querySelector('h1')?.textContent !== 'Boundary Examples' ||
          doc.querySelector('p')?.textContent !== 'Even with punctuation, the word "hope," stays a single word here.') block('wrong-fixture');
      const frameStyle = window.getComputedStyle(frame), viewStyle = window.getComputedStyle(view.element);
      Object.assign(item, { frameDocument: frame.contentDocument === doc, contextFrame: win.frameElement === frame,
        visibility: [small(viewStyle.visibility), small(frameStyle.visibility)],
        display: [small(viewStyle.display), small(frameStyle.display)],
        focus: doc.hasFocus(), active: tag(doc.activeElement), outerActiveIsFrame: outer.activeElement === frame,
        highlightStyle: !!doc.getElementById('openreader-highlight'), selected: null });
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return item;
      if (selection.rangeCount !== 1) block('range-limit');
      const range = selection.getRangeAt(0), text = String(range), cfi = small(view.contents.cfiFromRange(range), 128);
      if (!['Even', 'hope'].includes(text) || !/^epubcfi\([0-9/!,:]+\)$/.test(cfi)) block('non-fixture-selection');
      const ancestors = [];
      for (let element = range.startContainer.parentElement; element; element = element.parentElement) {
        if (ancestors.length === 4) block('ancestor-limit');
        const style = win.getComputedStyle(element);
        ancestors.push([tag(element), small(style.getPropertyValue('user-select')), small(style.getPropertyValue('-webkit-user-select'))]);
      }
      let pseudo = null;
      try { pseudo = win.getComputedStyle(range.startContainer.parentElement, '::selection'); }
      catch (_) { /* Unsupported pseudo-style reads remain unknown, not a paint verdict. */ }
      const selectionStyle = pseudo?.backgroundColor ? [small(pseudo.backgroundColor), small(pseudo.color)] : null;
      item.selected = { text, cfi, start: range.startOffset, end: range.endOffset,
        anchor: selection.anchorOffset, focus: selection.focusOffset,
        backward: selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset,
        ownerDocument: range.startContainer.ownerDocument === doc && range.endContainer.ownerDocument === doc,
        ancestors, selectionStyle };
      return item;
    });
    if (!instances.some(item => item.available)) block('fixture-unavailable');
    const result = JSON.stringify({ ...base, status: 'OBSERVED', outerFocus: outer.hasFocus(), outerActive: tag(outer.activeElement), instances });
    // ASCII fields make length a byte bound; reserve room for Debug Log prefix.
    if (result.length > 1800) block('payload-limit');
    return result;
  } catch (_) {
    return JSON.stringify({ ...base, status: 'BLOCKED', reason });
  }
}
