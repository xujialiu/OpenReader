/**
 * Two things epub.js's queues need before a reading can cross a section with the
 * app away from the screen (#112).
 *
 * Reproduced on the simulator with the #113 Debug Log (the issue's comments):
 *
 * - **Away from the screen, both queues stop.** `rendition.q` and
 *   `rendition.manager.q` run each task on `requestAnimationFrame`, and a page
 *   the app has left draws no frames. `renderAhead`'s request for the next
 *   section, and every `display()` the reading's `follow()` asks for, waited
 *   there until the app came back: 5 of 5 chapter crossings on the owner's phone,
 *   and every one on the simulator.
 * - **Coming back could stop the manager's queue for good.** The queued
 *   `display()`s then ran. `manager.display()` found the voice's section
 *   unloaded and `clear()`ed every view, the next section's too, while the
 *   manager's queue was displaying it. An `IframeView` removed before its iframe
 *   loads never settles its `display()`: its element, iframe and all, is out of
 *   the page, so `onload` never fires, and `destroy()` does nothing to a view
 *   that is not displayed. The queue task waiting on that display never ended,
 *   and neither did anything queued after it.
 *
 * So:
 *
 * - `settleRemovedViews(manager)`: a display whose view is taken off the page
 *   before it finished ends then, rejected with `REMOVED_BEFORE_DISPLAYED`. The
 *   manager's `View.prototype.display` hands back a promise that the removal can
 *   reject, and `manager.views.destroy`, through which `remove()` and `clear()`
 *   take every view off the page, rejects it for a view that is not displayed.
 *   epub.js's own `check()` and `update()` already absorb a rejected display,
 *   and `renderAhead` forgets the section and asks again at the next cue.
 * - `tickWithoutFrames(queue)`: a queue's next task runs on the first of a
 *   frame and a `FRAMELESS_MS` timer. On the screen the frame comes first, as it
 *   did. Away from it, the timer runs whenever WebKit lets the page run.
 *
 * Source, not functions, as `glide.ts` and `renderer-log.ts` are:
 * `EPUB_GUARDS_SOURCE` is spliced into the WebView program, which installs both
 * guards on its rendition beside `holdStill`, and the tests run the same text in
 * `node:vm`. Everything adapted is epub.js 0.3 as `@epubjs-react-native/core`
 * 1.4.8 bundles it (`lib/commonjs/epubjs.js`, read for this).
 */

/** How long a queue waits for a frame before it runs its next task anyway. */
export const FRAMELESS_MS = 100;

/** The error a display ends with when its view was taken off the page first. */
export const REMOVED_BEFORE_DISPLAYED = 'removed before its display finished';

export const EPUB_GUARDS_SOURCE =
  '  var FRAMELESS_MS = ' + FRAMELESS_MS + ';\n' +
  '  var REMOVED_BEFORE_DISPLAYED = ' + JSON.stringify(REMOVED_BEFORE_DISPLAYED) + ';\n' +
  `
  /* A display() still under way when its view is taken off the page ends then
     (#112). Each call's promise is kept on the view until it settles, since
     update() may display a view the queue is already displaying. */
  function settleRemovedViews(manager) {
    var View = manager && manager.View;
    var views = manager && manager.views;
    if (!View || !View.prototype || !views || views.openreaderSettles) return;
    if (!View.prototype.openreaderSettles) {
      var display = View.prototype.display;
      View.prototype.display = function () {
        var view = this;
        var shown = display.apply(this, arguments);
        if (view.displayed || !shown || typeof shown.then !== 'function') return shown;
        return new Promise(function (resolve, reject) {
          var pending = view.openreaderDisplays || (view.openreaderDisplays = []);
          pending.push(reject);
          var done = function () {
            var at = pending.indexOf(reject);
            if (at > -1) pending.splice(at, 1);
          };
          shown.then(function (value) { done(); resolve(value); }, function (error) { done(); reject(error); });
        });
      };
      View.prototype.openreaderSettles = true;
    }
    var destroy = views.destroy;
    views.destroy = function (view) {
      if (view && !view.displayed && view.openreaderDisplays && view.openreaderDisplays.length) {
        var pending = view.openreaderDisplays.splice(0);
        var error = new Error(REMOVED_BEFORE_DISPLAYED);
        error.openreaderRemoved = true;
        for (var i = 0; i < pending.length; i++) pending[i](error);
      }
      return destroy.apply(this, arguments);
    };
    views.openreaderSettles = true;
  }

  /* The next task on the first of a frame and a timer, so that the queue goes
     on while no frame is drawn (#112). */
  function tickWithoutFrames(queue) {
    if (!queue || queue.openreaderTicks) return;
    queue.tick = function (next) {
      var ran = false;
      var once = function () {
        if (ran) return;
        ran = true;
        next();
      };
      window.requestAnimationFrame(once);
      window.setTimeout(once, FRAMELESS_MS);
    };
    queue.openreaderTicks = true;
  }
`;
