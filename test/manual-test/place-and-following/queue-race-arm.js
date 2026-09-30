/*
 * #112's race, on demand (background-crossing.md): the manager's queue starts
 * displaying the section after the last view, as renderAhead does, and the
 * rendition is asked to display the section after that, whose view is not on
 * the page, so manager.display() clears every view while the first display is
 * under way. queue-race-read.js reads what came of it a few seconds later.
 * Run with `hx.cjs … --code-file`, which appends the call.
 */
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  const manager = rendition.manager;
  const next = manager.views.last().section.next();
  const away = next.next();
  window.__openreaderRace = 'pending';
  manager.q.enqueue(function () { return manager.append(next).display(manager.request); }).then(
    function () { window.__openreaderRace = 'displayed ' + next.index; },
    function (error) { window.__openreaderRace = 'rejected: ' + (error && error.message); });
  rendition.display(away.href);
  return 'armed: ' + next.index + ' displaying in the manager queue, ' + away.index + ' asked of the rendition';
}
