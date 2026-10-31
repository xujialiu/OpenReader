// What touch-record-arm.js recorded since it ran, as JSON: `events` are
// `section:type:Element.class:x:y:defaultPrevented` in the order the section
// documents heard them, `taps` the `openreader:tap` messages the page program
// posted to the app. Run it with hx.cjs --code-file after the touch.
// eslint-disable-next-line no-unused-vars
function probe() {
  const record = window.__touchRecord;
  return record ? JSON.stringify({ events: record.events, taps: record.taps }) : 'not armed: run touch-record-arm.js first';
}
