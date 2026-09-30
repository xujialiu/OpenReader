/**
 * What the reader's page says about epub.js in the Debug Log (#113, ADR 0054):
 * the `[renderer]` lines, and the `[probe]` lines the walkthrough harness's `js`
 * answers become.
 *
 * #112 showed what the Debug Log could not: a reading stuck waiting for section
 * 34, and nothing in the log to say that epub.js's queues had stopped, which view
 * had gone, or what the page looked like when the text ran out. Every fact had to
 * be probed out of the still-stuck app. These lines are those facts, written as
 * they happen.
 *
 * **Source, not functions**, as `glide.ts` is: `RENDERER_LOG_SOURCE` is the text
 * of one function, `installRendererLog`, in the WebView program's own dialect,
 * which `highlighter.ts` splices into the program **only in Debug Mode**. Without
 * it the program's text is what it was before this file existed, so a build
 * without Debug Mode cannot post a single one of these lines. The tests run the
 * same text in `node:vm`.
 *
 * **Every line is an event, never a word or a frame** (ADR 0005): a view added,
 * displayed, removed or cleared; `rendition.display()` asked for; the stage
 * resized; `renderAhead` asking, declining, done or failed; the page hidden or
 * shown; a queue that stops and starts again; a snapshot when the reading runs
 * out of text. The watchdog's timer is a `setInterval`, because epub.js's queues
 * wait on `requestAnimationFrame` and the watchdog must not stop with them, and
 * it writes a line only when a queue stalls and when it moves again.
 *
 * **Everything it hooks is epub.js 0.3 as `@epubjs-react-native/core` 1.4.8
 * bundles it** (`lib/commonjs/epubjs.js`, read for this, not from memory):
 *
 * - `Queue` (`rendition.q`, `rendition.manager.q`): `enqueue(task, …args)` pushes
 *   `{ task, args, deferred, promise }` onto `_q` and calls `run()`; `run()` sets
 *   `running` and waits for `tick`, which is `requestAnimationFrame`, then
 *   `dequeue()`s the first entry and runs the next only once the promise its task
 *   returned settles. A task whose promise never settles leaves `running` set for
 *   good, which is #112's queue. Both methods are wrapped on the instance: to
 *   label each task (its name, its first argument and the function that queued
 *   it) and to know which one is in flight.
 * - `Views` (`manager.views`): `append`, `prepend`, `destroy` (the removal of a
 *   view's element, which `remove` and `clear` call through `this`) and `clear`.
 * - `IframeView`: `display(request)` resolves once the section is loaded into
 *   its iframe; `destroy()` empties a displayed view and does nothing to one
 *   still displaying, whose display then never settles.
 * - The continuous manager's `resize()`, which clears every view whenever the
 *   stage's size really changed, and `rendition.display(target)`, which queues
 *   `_display` on the rendition's queue.
 *
 * Every wrapper calls what it wraps with the same `this` and arguments and hands
 * back its result, and every line is built inside a `try`: a line that cannot be
 * built is lost, and epub.js carries on exactly as it would have.
 */
import { debugLog } from '../debug/debug-log';

import { PROBE_MESSAGE, RENDERER_MESSAGE, type ProbeMessage, type RendererMessage } from './messages';

/** Awake seconds a queue may hold `running` with nothing started or finished before the watchdog says so. */
export const STALL_MS = 10_000;
/** The watchdog's tick. */
export const WATCH_MS = 1_000;
/**
 * The most one tick counts as awake time. A tick that comes later than this
 * after the last is a WebView iOS suspended in between, and a queue cannot move
 * while nothing runs, so the gap is not a stall.
 */
export const AWAKE_GAP_MS = 2_000;
/** How long a view's display may run before a line says it has not finished. */
export const SLOW_DISPLAY_MS = 10_000;
/** At most this many lines per `LINE_WINDOW_MS`; the rest are counted, and the count is written. */
export const LINES_PER_WINDOW = 200;
export const LINE_WINDOW_MS = 10_000;

/** Where a `[renderer]` or `[probe]` line from the page goes: the Debug Log, and a probe answer to the console as well, as `HX PROBE …`. */
export function logFromPage(message: RendererMessage | ProbeMessage): void {
  if (message.type === RENDERER_MESSAGE) {
    debugLog('renderer', String(message.line));
    return;
  }
  const answer = String(message.answer);
  console.log(`HX PROBE ${answer}`);
  debugLog('probe', answer);
}

/** Whether a message from the page is one of the two this file writes. */
export function isPageLine(message: { type?: unknown }): message is RendererMessage | ProbeMessage {
  return message.type === RENDERER_MESSAGE || message.type === PROBE_MESSAGE;
}

/**
 * The program's half. `env` is `{ rendition, asked, bySection, post(line) }`:
 * epub.js's rendition, the program's own sets of sections `renderAhead` has
 * asked for and sections whose Blocks were reported, and where a finished line
 * goes. It answers `{ snapshot(why), traceRenderAhead(renderAhead), watch() }`.
 */
export const RENDERER_LOG_SOURCE =
  'var RLOG_STALL_MS = ' + STALL_MS + ';\n' +
  'var RLOG_WATCH_MS = ' + WATCH_MS + ';\n' +
  'var RLOG_AWAKE_GAP_MS = ' + AWAKE_GAP_MS + ';\n' +
  'var RLOG_SLOW_DISPLAY_MS = ' + SLOW_DISPLAY_MS + ';\n' +
  'var RLOG_LINES = ' + LINES_PER_WINDOW + ';\n' +
  'var RLOG_WINDOW_MS = ' + LINE_WINDOW_MS + ';\n' +
  String.raw`
function installRendererLog(env) {
  var rendition = env.rendition;
  var now = env.now || function () { return Date.now(); };
  /* The Debug Log's own limits (debug-log.ts): a line under LINE_CHARS, and
     document-ish text — a target, an error — cut to about TEXT_CHARS. */
  var LINE_CHARS = 1990;
  var TEXT_CHARS = 80;

  var budget = { since: now(), lines: 0, dropped: 0 };
  function rlogFlushDropped(at) {
    if (at - budget.since < RLOG_WINDOW_MS) return;
    var dropped = budget.dropped;
    budget.since = at;
    budget.lines = 0;
    budget.dropped = 0;
    if (dropped) env.post(dropped + ' renderer lines dropped: more than ' + RLOG_LINES + ' in ' + (RLOG_WINDOW_MS / 1000) + ' s');
  }
  function line(text) {
    try {
      rlogFlushDropped(now());
      if (budget.lines >= RLOG_LINES) {
        budget.dropped += 1;
        return;
      }
      budget.lines += 1;
      env.post(shorten(String(text), LINE_CHARS));
    } catch (error) {
      /* A line that cannot be posted is lost; the page goes on. */
    }
  }
  function shorten(text, limit) {
    if (text.length <= limit) return text;
    var end = limit - 1;
    var last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    return text.slice(0, end) + '…';
  }
  function cut(value) {
    return JSON.stringify(shorten(String(value), TEXT_CHARS));
  }
  function seconds(ms) {
    return String(Math.round(ms / 100) / 10);
  }
  function safely(build) {
    try {
      build();
    } catch (error) {
      /* Never epub.js's problem. */
    }
  }

  /* Who called: the first few named frames of the stack, past this file's own
     wrappers (every one of them is called rlog…). WebKit writes a frame as
     name@place, an anonymous one as @place and injected code as
     "global code@…"; V8, which the tests run in, as "at name (place)". */
  function rlogCallers() {
    var stack = '';
    try {
      stack = String(new Error().stack || '');
    } catch (error) {
      return '?';
    }
    var names = [];
    var frames = stack.split('\n');
    for (var i = 0; i < frames.length && names.length < 3; i++) {
      var frame = frames[i].trim();
      var name = null;
      if (frame.indexOf('at ') === 0) {
        var rest = frame.slice(3);
        var open = rest.indexOf(' (');
        name = open > 0 ? rest.slice(0, open) : '(anonymous)';
        var dot = name.lastIndexOf('.');
        if (dot >= 0 && name.indexOf('new ') !== 0) name = name.slice(dot + 1);
      } else if (frame.indexOf('@') >= 0) {
        name = frame.slice(0, frame.indexOf('@')) || '(anonymous)';
      }
      if (name === null || name.indexOf('rlog') === 0) continue;
      if (name === 'global code' || name === 'eval code') name = 'injected code';
      names.push(name);
    }
    return names.length ? names.join(' ← ') : '?';
  }

  /* ---- the queues ---- */

  var tracing = null;

  function rlogLabel(task, args, caller) {
    var name = '?';
    if (typeof task === 'function') {
      name = task.name ? task.name.replace(/^bound /, '') : '';
      /* One of this file's own pass-through wrappers, by the name of what it wraps. */
      if (name.indexOf('rlog') === 0) name = name.charAt(4).toLowerCase() + name.slice(5);
      if (!name) {
        var text = String(task);
        name = text.indexOf('[native code]') >= 0 ? '(anonymous)' : text.replace(/\s+/g, ' ').slice(0, 30);
      }
    } else if (!task) {
      name = 'promise';
    }
    var first = args && args.length ? args[0] : undefined;
    var argument = first === undefined ? '' : '(' + (typeof first === 'string' ? cut(first) : typeof first === 'number' ? String(first) : typeof first) + ')';
    return name + argument + (caller ? '@' + caller : '');
  }

  function hookQueue(name, q) {
    if (!q || q.rlogWatch || typeof q.enqueue !== 'function' || typeof q.dequeue !== 'function') return;
    var watch = { name: name, q: q, started: 0, settled: 0, flight: null, token: '', awake: 0, since: now(), reported: false };
    q.rlogWatch = watch;
    var enqueue = q.enqueue;
    q.enqueue = function rlogEnqueue(task) {
      var before = this._q ? this._q.length : 0;
      var label = null;
      var trace = tracing;
      var rest = [].slice.call(arguments, 1);
      var by = trace && name === 'manager' ? null : rlogCallers().split(' ← ')[0];
      safely(function () {
        label = trace && name === 'manager' ? trace.label : rlogLabel(task, rest, by);
      });
      var result = enqueue.apply(this, arguments);
      var queue = this;
      safely(function () {
        if (queue._q && queue._q.length > before) queue._q[queue._q.length - 1].rlogLabel = label;
        if (trace && name === 'manager' && !trace.enqueued) trace.enqueued = result;
      });
      return result;
    };
    var dequeue = q.dequeue;
    q.dequeue = function rlogDequeue() {
      var entry = this._q && this._q.length && !this.paused ? this._q[0] : null;
      var result = dequeue.apply(this, arguments);
      safely(function () {
        if (!entry) return;
        watch.started += 1;
        var flight = { label: entry.rlogLabel || rlogLabel(entry.task, entry.args, null), since: now() };
        watch.flight = flight;
        var landed = function () {
          watch.settled += 1;
          if (watch.flight === flight) watch.flight = null;
        };
        if (result && typeof result.then === 'function') result.then(landed, landed);
        else landed();
      });
      return result;
    };
  }

  function groups(entries) {
    var out = [];
    var last = null;
    var count = 0;
    function close() {
      if (last !== null) out.push(count > 1 ? last + ' ×' + count : last);
    }
    for (var i = 0; i < entries.length; i++) {
      var label = entries[i].rlogLabel || rlogLabel(entries[i].task, entries[i].args, null);
      if (label === last) {
        count += 1;
        continue;
      }
      close();
      last = label;
      count = 1;
    }
    close();
    return out.length > 8 ? out.slice(0, 8).join(', ') + ', … ' + (out.length - 8) + ' more kinds' : out.join(', ');
  }

  function queueState(q) {
    if (!q) return 'none';
    var watch = q.rlogWatch;
    var waiting = q._q ? q._q.length : 0;
    var flight = watch && watch.flight;
    return (q.running ? 'running' : 'idle') + (q.paused ? ' paused' : '') +
      (flight ? ', in flight ' + flight.label + ' for ' + seconds(now() - flight.since) + ' s' : q.running ? ', nothing in flight (waiting for a frame)' : '') +
      ', ' + waiting + ' waiting' + (waiting ? ': ' + groups(q._q) : '');
  }

  function queueBrief(q) {
    if (!q) return 'none';
    return (q.running ? 'running' : 'idle') + ', ' + (q._q ? q._q.length : 0) + ' waiting';
  }

  /* ---- the views ---- */

  var meta = new WeakMap();
  var clearing = false;
  var removing = false;
  var resizing = false;

  function viewMeta(view) {
    var found = meta.get(view);
    if (!found) {
      found = { started: null, removed: null };
      meta.set(view, found);
    }
    return found;
  }
  function indexOf(view) {
    return view && view.section && typeof view.section.index === 'number' ? view.section.index : '?';
  }
  function live(view) {
    try {
      var doc = view.contents && view.contents.document;
      return !!(doc && doc.defaultView);
    } catch (error) {
      return false;
    }
  }
  function stateOf(view) {
    var found = meta.get(view);
    var height = view.element ? view.element.offsetHeight : 0;
    if (view.displayed) return indexOf(view) + ' displayed' + (live(view) ? '' : ' dead document') + ' ' + height + 'px';
    if (found && found.started !== null) return indexOf(view) + ' displaying for ' + seconds(now() - found.started) + ' s' + (view.iframe ? '' : ' no iframe');
    return indexOf(view) + ' not displayed ' + height + 'px';
  }
  function viewsOf(manager) {
    var list = manager && manager.views && manager.views._views ? manager.views._views : [];
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(stateOf(list[i]));
    return '[' + out.join(', ') + ']';
  }
  function indexes(manager) {
    var list = manager && manager.views && manager.views._views ? manager.views._views : [];
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(indexOf(list[i]));
    return '[' + out.join(', ') + ']';
  }

  function hookView(view) {
    if (!view || view.rlogHooked) return;
    view.rlogHooked = true;
    var display = view.display;
    if (typeof display === 'function') {
      view.display = function rlogViewDisplay() {
        var found = viewMeta(view);
        var fresh = !view.displayed && found.started === null;
        if (fresh) {
          found.started = now();
          found.removed = null;
          var started = found.started;
          window.setTimeout(function () {
            safely(function () {
              if (found.started !== started || view.displayed) return;
              line('view ' + indexOf(view) + ' has not finished displaying ' + seconds(now() - started) + ' s after it started' +
                (found.removed !== null ? ' (removed from the page ' + seconds(found.removed - started) + ' s after it started)' : ', and is still on the page'));
            });
          }, RLOG_SLOW_DISPLAY_MS);
        }
        var result = display.apply(this, arguments);
        if (fresh && result && typeof result.then === 'function') {
          result.then(function () {
            safely(function () {
              if (found.started === null) return;
              line('view ' + indexOf(view) + ' displayed in ' + (now() - found.started) + ' ms' + (found.removed !== null ? ', after it was removed' : ''));
              found.started = null;
            });
          }, function (error) {
            safely(function () {
              line('view ' + indexOf(view) + ' display failed after ' + (now() - found.started) + ' ms: ' + cut(error));
              found.started = null;
            });
          });
        }
        return result;
      };
    }
    var destroy = view.destroy;
    if (typeof destroy === 'function') {
      view.destroy = function rlogViewDestroy() {
        if (!removing && view.displayed) {
          var by = rlogCallers();
          safely(function () { line('view ' + indexOf(view) + ' unloaded, out of reach (' + by + ')'); });
        }
        return destroy.apply(this, arguments);
      };
    }
  }

  function removal(view) {
    var found = viewMeta(view);
    if (view.displayed) return 'view ' + indexOf(view) + ' removed';
    if (found.started !== null) {
      found.removed = now();
      return 'view ' + indexOf(view) + ' removed before its display finished, ' + (found.removed - found.started) + ' ms after it started';
    }
    return 'view ' + indexOf(view) + ' removed, never displayed';
  }

  function hookViews(views, manager) {
    if (!views || views.rlogHooked) return;
    views.rlogHooked = true;
    var list = views._views || [];
    for (var i = 0; i < list.length; i++) hookView(list[i]);
    ['append', 'prepend'].forEach(function (verb) {
      var original = views[verb];
      if (typeof original !== 'function') return;
      views[verb] = function rlogAdd(view) {
        var result = original.apply(this, arguments);
        var by = rlogCallers();
        safely(function () {
          hookView(view);
          line('view ' + indexOf(view) + ' ' + verb + 'ed, views ' + indexes(manager) + ' (' + by + ')');
        });
        return result;
      };
    });
    var destroy = views.destroy;
    if (typeof destroy === 'function') {
      views.destroy = function rlogRemove(view) {
        var by = clearing ? null : rlogCallers();
        safely(function () {
          if (clearing) {
            if (!view.displayed && viewMeta(view).started !== null) viewMeta(view).removed = now();
            return;
          }
          line(removal(view) + ' (' + by + ')');
        });
        removing = true;
        try {
          return destroy.apply(this, arguments);
        } finally {
          removing = false;
        }
      };
    }
    var clear = views.clear;
    if (typeof clear === 'function') {
      views.clear = function rlogClear() {
        if (!resizing && this.length) {
          var by = rlogCallers();
          safely(function () { line('views cleared: ' + viewsOf(manager) + ' (' + by + ')'); });
        }
        clearing = true;
        try {
          return clear.apply(this, arguments);
        } finally {
          clearing = false;
        }
      };
    }
  }

  function hookManager(manager) {
    if (!manager || manager.rlogHooked) return;
    manager.rlogHooked = true;
    /* Pass-throughs, for their names alone: the manager's queue holds trim and
       check bound (the program's own holdStill wrappers, which are anonymous),
       and a bound function is labelled by the name of what it binds. */
    var trim = manager.trim;
    if (typeof trim === 'function') manager.trim = function rlogTrim() { return trim.apply(this, arguments); };
    var check = manager.check;
    if (typeof check === 'function') manager.check = function rlogCheck() { return check.apply(this, arguments); };
    var resize = manager.resize;
    if (typeof resize === 'function') {
      manager.resize = function rlogResize() {
        var before = this._stageSize;
        var shown = viewsOf(this);
        resizing = true;
        try {
          return resize.apply(this, arguments);
        } finally {
          resizing = false;
          var after = this._stageSize;
          if (after && after !== before) {
            safely(function () {
              line('stage resized from ' + (before ? before.width + '×' + before.height : 'nothing') + ' to ' + after.width + '×' + after.height + ', every view cleared: ' + shown);
            });
          }
        }
      };
    }
  }

  function hookAll() {
    var manager = rendition.manager;
    hookQueue('rendition', rendition.q);
    if (!manager) return;
    hookQueue('manager', manager.q);
    hookManager(manager);
    hookViews(manager.views, manager);
  }

  /* ---- the page ---- */

  function sorted(values) {
    var list = [];
    values.forEach(function (value) { list.push(value); });
    return list.filter(function (value) { return typeof value === 'number'; }).sort(function (a, b) { return a - b; });
  }
  function ranges(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var start = list[i];
      while (i + 1 < list.length && list[i + 1] === list[i] + 1) i++;
      out.push(start === list[i] ? String(start) : start + '–' + list[i]);
    }
    return '[' + out.join(', ') + ']';
  }
  function scrollState(manager) {
    var container = manager && manager.container;
    if (!container) return 'no scroll container';
    var offset = manager.settings && manager.settings.offset || 0;
    var bounds = manager._bounds && manager._bounds.height;
    var top = manager.scrollTop;
    return 'scroll top ' + Math.round(container.scrollTop) + ' + client ' + container.clientHeight + ' of ' + container.scrollHeight +
      ', manager top ' + Math.round(top) + ' bounds ' + Math.round(bounds || 0) + ' offset ' + offset +
      ' (check() would ' + (top + (bounds || 0) + offset >= container.scrollHeight ? '' : 'not ') + 'append)';
  }
  function locationState() {
    var location = rendition.location;
    if (!location || !location.start) return 'none';
    return location.start.index + (location.end ? '–' + location.end.index : '') + ' at ' + cut(location.start.cfi);
  }
  function snapshot() {
    var manager = rendition.manager;
    var reported = [];
    env.bySection.forEach(function (value, key) { reported.push(key); });
    return 'views ' + viewsOf(manager) +
      '; manager queue ' + queueState(manager && manager.q) +
      '; rendition queue ' + queueState(rendition.q) +
      '; ' + scrollState(manager) +
      '; asked ' + ranges(sorted(env.asked)) + ', reported ' + ranges(sorted(reported)) +
      '; location ' + locationState() +
      '; page ' + document.visibilityState;
  }

  /* ---- rendition.display ---- */

  function target(value) {
    if (value === undefined || value === null) return '(the start)';
    if (typeof value === 'number') return 'section ' + value;
    var text = String(value);
    if (text === 'about:srcdoc') return cut(text) + " (the library's answer to an iframe's about:srcdoc load)";
    if (/^\d+$/.test(text)) return 'section ' + text;
    return cut(text);
  }

  var displayPlain = rendition.display;
  if (typeof displayPlain === 'function') {
    rendition.display = function rlogDisplay(value) {
      var asked = arguments.length;
      var by = rlogCallers();
      safely(function () {
        line('display ' + (asked ? target(value) : '(the start)') + ' asked by ' + by + (resizing ? ', inside a stage resize' : '') +
          '; rendition queue ' + queueBrief(rendition.q));
      });
      return displayPlain.apply(this, arguments);
    };
  }
  if (typeof rendition.on === 'function') {
    rendition.on('displayed', function (section) {
      safely(function () { line('display finished: section ' + (section && typeof section.index === 'number' ? section.index : '?')); });
    });
    rendition.on('displayerror', function (error) {
      safely(function () { line('display failed: ' + cut(error)); });
    });
  }

  /* ---- renderAhead ---- */

  var lastSkip = '';

  /* The guard renderAhead's own code stopped at, read the same way and in the
     same order. What it did is not decided here: whether it asked is whether it
     queued a task on the manager's queue while it ran. */
  function aheadState(section) {
    if (section === null || section === undefined) return { next: null, reason: "the Utterance's section is not known" };
    var manager = rendition.manager;
    if (!manager || !manager.views || !manager.q) return { next: null, reason: 'epub.js has no manager' };
    var last = manager.views.last();
    if (!last || !last.section) return { next: null, reason: 'no view is on the page' };
    if (last.section.index !== section) return { next: null, reason: 'the last view is section ' + last.section.index + ', not the voice’s' };
    var next = last.section.next();
    if (!next) return { next: null, reason: 'there is no section after it' };
    if (env.bySection.has(next.index)) return { next: next.index, reason: 'section ' + next.index + ' has reported already' };
    if (env.asked.has(next.index)) return { next: next.index, reason: 'section ' + next.index + ' was asked for already and has not reported' };
    return { next: next.index, reason: null };
  }

  function traceRenderAhead(original) {
    return function rlogRenderAhead(section) {
      var before = { next: null, reason: null };
      safely(function () { before = aheadState(section); });
      var trace = { label: 'renderAhead(' + (before.next === null ? '?' : before.next) + ')', enqueued: null };
      tracing = trace;
      var result;
      try {
        result = original.apply(this, arguments);
      } finally {
        tracing = null;
      }
      safely(function () {
        if (trace.enqueued) {
          lastSkip = '';
          var since = now();
          var next = before.next;
          line('renderAhead: section ' + next + ' asked for, the voice is in section ' + section + ', the last view');
          trace.enqueued.then(function () {
            safely(function () { line('renderAhead: section ' + next + ' done in ' + (now() - since) + ' ms, views ' + indexes(rendition.manager)); });
          }, function (error) {
            safely(function () { line('renderAhead: section ' + next + ' failed after ' + (now() - since) + ' ms: ' + cut(error)); });
          });
          return;
        }
        var reason = before.reason || 'it asked for nothing';
        var key = section + '|' + reason;
        if (key === lastSkip) return;
        lastSkip = key;
        line('renderAhead: the voice is in section ' + section + ', nothing asked: ' + reason);
      });
      return result;
    };
  }

  /* ---- the watchdog ---- */

  var lastTick = now();
  function watchQueue(q, at, awake) {
    var watch = q && q.rlogWatch;
    if (!watch) return;
    var token = watch.started + ':' + watch.settled;
    if (!q.running || token !== watch.token) {
      if (watch.reported) {
        line(watch.name + ' queue moving again after ' + seconds(watch.awake) + ' s awake, ' + seconds(at - watch.since) + ' s on the clock' +
          (q.running ? '' : ', and idle') + '; ' + watch.name + ' queue ' + queueBrief(q));
      }
      watch.token = token;
      watch.awake = 0;
      watch.since = at;
      watch.reported = false;
      return;
    }
    /* Waiting for a frame while the page is hidden is what a hidden page does,
       and not a stall: WebKit draws no frames for it. */
    if (!watch.flight && document.visibilityState === 'hidden') return;
    watch.awake += awake;
    if (watch.reported || watch.awake < RLOG_STALL_MS) return;
    watch.reported = true;
    line(watch.name + ' queue stalled: running, and nothing started or finished for ' + seconds(watch.awake) + ' s awake, ' +
      seconds(at - watch.since) + ' s on the clock; ' + snapshot());
  }
  function rlogTick() {
    safely(function () {
      var at = now();
      var awake = Math.min(Math.max(at - lastTick, 0), RLOG_AWAKE_GAP_MS);
      lastTick = at;
      rlogFlushDropped(at);
      hookAll();
      watchQueue(rendition.manager && rendition.manager.q, at, awake);
      watchQueue(rendition.q, at, awake);
    });
  }

  safely(hookAll);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function () {
      safely(function () {
        line('page ' + document.visibilityState + '; manager queue ' + queueBrief(rendition.manager && rendition.manager.q) + '; rendition queue ' + queueBrief(rendition.q));
      });
    });
  }
  window.setInterval(rlogTick, RLOG_WATCH_MS);
  safely(function () { line('installed: ' + snapshot()); });

  return {
    snapshot: function (why) {
      safely(function () { line('snapshot, ' + String(why).slice(0, TEXT_CHARS) + ': ' + snapshot()); });
    },
    traceRenderAhead: traceRenderAhead,
    /* The watchdog's look, taken again whenever a Clip cue arrives: in the
       background iOS lets the WebView run only while the app hands it something,
       and a timer may not come round in that moment. */
    watch: rlogTick
  };
}
`;
