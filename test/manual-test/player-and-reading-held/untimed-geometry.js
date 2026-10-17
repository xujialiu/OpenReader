// #197 measurement probe (runs in the reader's WebView through the harness's
// `js`, answered as one `HX PROBE` line in Metro's log).
//
// Returns the utterance highlight's line boxes, the scroll container's
// geometry, and where the container's visible bottom is (the Player's top
// edge, as the program itself sees it through the 'inset' message's covered),
// so the last highlighted line can be compared with the Player's top.
function probe() {
  var content = rendition.getContents()[0];
  if (!content) return 'no content';
  var doc = content.document, win = content.window;
  var out = {};
  var u = win.CSS.highlights.get('openreader-utterance');
  var ranges = u ? Array.from(u) : [];
  out.ranges = ranges.length;
  var boxes = [];
  ranges.forEach(function (r) {
    Array.from(r.getClientRects()).forEach(function (x) {
      boxes.push({ top: +x.top.toFixed(1), bottom: +x.bottom.toFixed(1), left: +x.left.toFixed(1), right: +x.right.toFixed(1) });
    });
  });
  out.boxes = boxes;
  out.firstText = ranges.length ? ranges[0].toString().slice(0, 40) : null;
  out.lastText = ranges.length ? ranges[ranges.length - 1].toString().slice(-40) : null;
  var container = rendition.manager.container;
  var cr = container.getBoundingClientRect();
  out.container = { top: +cr.top.toFixed(1), bottom: +cr.bottom.toFixed(1), height: +cr.height.toFixed(1), scrollTop: container.scrollTop };
  // The section's own box in content coordinates, for the height of the sentence.
  var bodyRect = doc.body.getBoundingClientRect();
  out.bodyTop = +bodyRect.top.toFixed(1);
  out.viewport = { w: win.innerWidth, h: win.innerHeight, dpr: win.devicePixelRatio };
  // What the program itself was told: the messages replay only forward, so
  // read the painted result instead — the visible bottom is where the page's
  // own background ends and the player's begins. The scroll container's
  // visible bottom in viewport coordinates is what `covered` subtracts from;
  // report the raw numbers and let the caller compare with the native frame.
  return JSON.stringify(out);
}
