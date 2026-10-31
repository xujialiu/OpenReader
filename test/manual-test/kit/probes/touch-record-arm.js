// Arms a recorder in the reader's page before a touch: what every section
// document hears (touchstart, touchend, mousedown, mouseup, click, captured
// before the page's own handlers, with the element hit, the point in that
// document and whether the event was already default-prevented) and every tap
// the page program posts to the app (`openreader:tap`, with its block and
// offset). Read it with touch-record-read.js after the touch.
//
// It tells "the touch never arrived" from "the page got it and did nothing":
// a tap the Tap Lock keeps from acting on blank space writes no line at all
// (#336), so its silence alone proves nothing. Events heard and no tap posted
// is the page deciding; no events is the touch being lost on the way.
//
// Run it with hx.cjs --code-file (or library-and-reader/recorded-touch.sh,
// which also takes the touch and prints both reads). It may be run again
// before each touch: it clears the log and listens to the sections laid out
// since. It listens to the sections that exist now, so run it after the page
// has moved to the text that will be touched. It changes nothing the page
// does: the wrapped postMessage passes every message on.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const bridge = window.ReactNativeWebView;
  const record = window.__touchRecord || (window.__touchRecord = { events: [], taps: [], wrapped: false });
  if (!record.wrapped) {
    const original = bridge.postMessage.bind(bridge);
    bridge.postMessage = function (data) {
      try {
        const message = JSON.parse(data);
        if (message.type === 'openreader:tap') record.taps.push({ block: message.block, offset: message.offset });
      } catch (_notOurs) { /* a message that is not JSON */ }
      return original(data);
    };
    record.wrapped = true;
  }
  let armed = 0;
  rendition.manager.views.all().forEach(function (view) {
    const doc = view.contents && view.contents.document;
    if (!doc || doc.__touchRecorded) return;
    doc.__touchRecorded = true;
    armed += 1;
    ['touchstart', 'touchend', 'mousedown', 'mouseup', 'click'].forEach(function (type) {
      doc.addEventListener(type, function (event) {
        const at = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : event;
        const hit = event.target;
        record.events.push([
          view.section.index, type, hit && hit.nodeName + '.' + (hit.className || ''),
          Math.round(at.clientX || 0), Math.round(at.clientY || 0), event.defaultPrevented,
        ].join(':'));
      }, true);
    });
  });
  record.events.length = 0;
  record.taps.length = 0;
  return 'armed ' + armed + ' new section documents; views ' + rendition.manager.views.all().map(function (view) { return view.section.index; }).join(',');
}
