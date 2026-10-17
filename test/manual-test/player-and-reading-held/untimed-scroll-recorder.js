// Scroll recorder for the #197 device check: samples the manager container's
// scrollTop and the utterance highlight's box (the program's own boxOf
// arithmetic) every 50 ms into window.__scrollRec, so a cue's move can be
// attributed after the fact. Install with the harness's `js`; dump with the
// dump file. Both run in the manager window.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  clearInterval(window.__scrollRecTimer);
  let d = window.__scrollRec = { t0: Date.now(), samples: [] };
  let frameOf = function () {
    let content = rendition.getContents()[0];
    if (!content) return null;
    let win = content.window;
    let frame = win.frameElement;
    if (!frame) return null;
    return { frame: frame, win: win };
  };
  window.__scrollRecTimer = setInterval(function () {
    try {
      let view = rendition.manager.container;
      let pair = frameOf();
      let boxTop = null, boxBottom = null;
      if (pair) {
        let origin = pair.frame.getBoundingClientRect().top;
        let u = pair.win.CSS.highlights.get('openreader-utterance');
        let ranges = u ? Array.from(u) : [];
        ranges.forEach(function (r) {
          let rect = r.getBoundingClientRect();
          if (boxTop === null || origin + rect.top < boxTop) boxTop = +(origin + rect.top).toFixed(1);
          if (boxBottom === null || origin + rect.bottom > boxBottom) boxBottom = +(origin + rect.bottom).toFixed(1);
        });
      }
      d.samples.push([Date.now() - d.t0, +view.scrollTop.toFixed(1), boxTop, boxBottom]);
      if (d.samples.length > 3000) d.samples.shift();
    } catch {}
  }, 50);
  return 'scroll recorder installed';
}
