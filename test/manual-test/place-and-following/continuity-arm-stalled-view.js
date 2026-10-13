// Arm the preparation-deadline probe: replace the manager's View constructor
// with one whose display() never settles, so the next offscreen preparation
// (#153) hits both 15-second deadlines instead of finishing. The real
// constructor is kept on the answer holder for the disarming probe.
//
//   node test/manual-test/kit/hx.cjs UDID '{}' --code-file THIS_FILE
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  if (typeof rendition === 'undefined' || !rendition.manager || !rendition.manager.View) {
    return 'no manager';
  }
  const manager = rendition.manager;
  if (globalThis.__openreaderRealView) return 'already armed';
  globalThis.__openreaderRealView = manager.View;
  manager.View = function (section, settings) {
    this.section = section;
    this.settings = settings;
    this.element = document.createElement('div');
    this.displayed = false;
    this.display = function () { return new Promise(function () {}); };
    this.destroy = function () {};
  };
  return 'armed';
}
