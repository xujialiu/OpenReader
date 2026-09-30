/*
 * What queue-race-arm.js's display came to, and both queues (background-crossing.md).
 * Before #112's fix: `pending`, the manager queue `running` with a task waiting,
 * for good. After: `rejected: removed before its display finished`, both idle.
 */
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const state = function (q) { return { len: q._q.length, running: q.running === undefined ? null : q.running }; };
  const manager = rendition.manager;
  return JSON.stringify({
    race: window.__openreaderRace,
    manager: state(manager.q),
    rendition: state(rendition.q),
    views: manager.views._views.map(function (view) { return view.section.index + (view.displayed ? 'd' : '-'); }),
  });
}
