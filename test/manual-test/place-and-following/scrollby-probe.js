// Instruments the continuous drift's whole-pixel scroll requests (#196) in the
// running reader's page, through the same call the highlighter's `nudge` makes:
// `rendition.manager.scrollBy`. Run with the kit's harness,
//
//   node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{}' \
//     --code-file test/manual-test/place-and-following/scrollby-probe.js
//
// The answer is the newest `HX PROBE` line in Metro's log (or `[probe]` in the
// Debug Log), a JSON summary since the previous call; the first call only arms.
//
//   first call  — wraps `rendition.manager.scrollBy` (recording
//                 [t, by, scrollTopBefore, scrollTopAfter] into
//                 `window.__scrollby.log`) and samples the container's
//                 scrollTop once per drawn frame into `window.__scrollby.frames`.
//   later calls — one summary over the calls and frames since the last call,
//                 trimming both series, so consecutive calls are consecutive
//                 windows.
//
// What each shape means (see the #196 fix in src/renderer/highlighter.ts).
// The pre-fix shape is the host test's construction and design intent — it was
// NOT measured on a device here:
//   - A healthy drift calls scrollBy sparsely (about one 1 px step per 100 ms,
//     measured on #71) and the sampled scrollTop actually moves.
//   - Expected pre-fix drift at an unreachable boundary: a call every drawn
//     frame (rate ~= frame rate), zero movement, never resting.
//   - AFTER the fix (measured 2026-10-18): the first whole-pixel call that
//     fails to move an edge rests the drift — the call rate collapses (14
//     failed calls in the approach, then zero) and a paused boundary page
//     requests no scroll work at all.
//
// The wrapper sits on the app's own production path and adds one array push per
// call; the RAF sampler is the same convention as continuous-follow.cjs. Neither
// changes the page's layout or the drift's arithmetic. A read only trims.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  let C = window.__scrollby;
  if (!C) {
    const now = performance.now();
    C = window.__scrollby = { log: [], frames: [], on: true, t0: now, lastRead: now };
    const m = rendition.manager;
    const raw = m.scrollBy.bind(m);
    m.scrollBy = function (x, y, smooth) {
      const stage = m.container;
      const before = stage ? stage.scrollTop : null;
      raw(x, y, smooth);
      const after = stage ? stage.scrollTop : null;
      C.log.push([Math.round(performance.now() - C.t0), y, before, after]);
    };
    const sample = function () {
      if (!C.on) return;
      const stage = m.container;
      C.frames.push([Math.round(performance.now() - C.t0), stage ? stage.scrollTop : null]);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return JSON.stringify({ armed: true, scroller: !!m.container });
  }
  const log = C.log.splice(0, C.log.length);
  const frames = C.frames.splice(0, C.frames.length);
  const now = performance.now();
  const windowMs = Math.round(now - C.lastRead);
  C.lastRead = now;
  const span = log.length ? log[log.length - 1][0] - log[0][0] : 0;
  let asked = 0, moved = 0, failed = 0, upFailed = 0, downFailed = 0;
  for (let i = 0; i < log.length; i++) {
    asked += Math.abs(log[i][1]);
    if (log[i][3] !== null && log[i][2] !== null && log[i][3] === log[i][2]) {
      failed++;
      if (log[i][1] < 0) upFailed++;
      if (log[i][1] > 0) downFailed++;
    } else if (log[i][3] !== null && log[i][2] !== null) {
      moved += Math.abs(log[i][3] - log[i][2]);
    }
  }
  let fMoved = 0, fStill = 0;
  for (let j = 1; j < frames.length; j++) {
    if (frames[j][1] === null || frames[j - 1][1] === null) continue;
    if (frames[j][1] !== frames[j - 1][1]) fMoved++; else fStill++;
  }
  const stage = rendition.manager.container;
  const geom = stage
    ? { scrollTop: stage.scrollTop, scrollHeight: stage.scrollHeight, clientHeight: stage.clientHeight,
        atTop: stage.scrollTop <= 0, atBottom: stage.scrollTop >= stage.scrollHeight - stage.clientHeight }
    : null;
  const frameMs = frames.length > 1 ? frames[frames.length - 1][0] - frames[0][0] : 0;
  const rate = frameMs > 0 ? Math.round((frames.length - 1) * 1000 / frameMs) : null;
  return JSON.stringify({
    windowMs: windowMs, scrollSpanMs: span,
    scrollByCalls: log.length,
    pxRequested: asked,
    pxActuallyMoved: moved,
    failedCalls: failed, upFailed: upFailed, downFailed: downFailed,
    frames: frames.length, framesPerSecond: rate, framesMoved: fMoved, framesStill: fStill,
    geometry: geom,
  });
}
