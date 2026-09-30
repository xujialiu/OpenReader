// The reader's renderer as epub.js holds it, in one answer: for a reading that
// waits for text, a blank page, a section that never arrives (#112). Run with
// phone-hx.cjs --code-file, which appends the call. `probe()` returns one line,
// kept well under the Debug Log's 2,000 characters by counting the queues'
// tasks instead of listing them.
//
// views     spine index : d displayed : i iframe : L live document : height
// mq, rq    rendition.manager.q and rendition.q: length, running, tasks by name
// scroll    the manager's container: top + client against height, and its offset
// spine     spine items from two before the first view to two after the last:
//           C contents, D document, O output (loaded by section.render())
/* global rendition, book */
// eslint-disable-next-line no-unused-vars
function probe() {
  let out = {};
  function tasks(q) {
    let counts = {};
    q._q.forEach(function (t) {
      let name = t.task ? t.task.name || String(t.task).replace(/\s+/g, ' ').slice(0, 40) : 'promise';
      counts[name] = (counts[name] || 0) + 1;
    });
    return { len: q._q.length, running: q.running === undefined ? null : q.running, paused: q.paused, tasks: counts };
  }
  try {
    let m = rendition.manager;
    let views = (m.views && m.views._views) || [];
    out.views = views.map(function (v) {
      let d = null;
      try { d = v.contents && v.contents.document; } catch { /* a view without a live document */ }
      return [v.section && v.section.index, v.displayed ? 'd' : '-', v.iframe ? 'i' : '-', d && d.defaultView ? 'L' : '-', Math.round((v.element && v.element.offsetHeight) || 0)].join(':');
    });
    out.mq = tasks(m.q);
    out.rq = tasks(rendition.q);
    out.rqFirst = rendition.q._q.slice(0, 2).map(function (t) { return JSON.stringify(t.args).slice(0, 60); });
    let c = m.container;
    out.scroll = { top: c.scrollTop, client: c.clientHeight, height: c.scrollHeight, offset: m.settings.offset };
    let first = views.length ? views[0].section.index : 0;
    let last = views.length ? views[views.length - 1].section.index : 0;
    let spine = [];
    for (let i = Math.max(0, first - 2); i <= Math.min(book.spine.length - 1, last + 2); i++) {
      let s = book.spine.get(i);
      spine.push(i + ':' + (s ? (s.contents ? 'C' : '-') + (s.document ? 'D' : '-') + (s.output ? 'O' : '-') : 'none'));
    }
    out.spine = spine;
    out.length = book.spine.length;
    out.location = rendition.location && rendition.location.start ? [rendition.location.start.index, rendition.location.end.index] : null;
    out.visibility = document.visibilityState;
  } catch (e) {
    out.error = String(e);
  }
  return JSON.stringify(out);
}
