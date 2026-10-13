// Disarm the preparation-deadline probe: restore the manager's real View
// constructor. Answers with whether the probe had been armed.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file THIS_FILE
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  if (typeof rendition === 'undefined' || !rendition.manager) return 'no manager';
  if (!globalThis.__openreaderRealView) return 'was not armed';
  rendition.manager.View = globalThis.__openreaderRealView;
  globalThis.__openreaderRealView = null;
  return 'disarmed';
}
