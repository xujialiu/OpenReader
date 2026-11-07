// #353: bounded WebView observation only. No play, seek, geometry or position
// writes. kit/hx.cjs --code-file. Arm just before a <=8s measured Reading;
// collection stops/restores the dispatcher after 10s even if the host vanishes.
// Timings/corrections are the real bridge's, NOT independently captured audio.
/* global rendition */
// eslint-disable-next-line no-unused-vars
function probe() {
  if (window.__duoAcceptanceWordTrace) throw new Error('Clear the previous DuoAcceptance word trace first');
  const original = window.__openReaderHighlighter;
  if (typeof original !== 'function') throw new Error('Reader dispatcher missing');
  const trace = { startedAt: Date.now(), timeOrigin: performance.timeOrigin, frames: [], messages: [], errors: [], stopped: false, overflow: false };
  let frameID, deadline;
  function stop() {
    if (trace.stopped) return;
    trace.stopped = true; trace.stoppedAt = Date.now();
    window.cancelAnimationFrame(frameID); window.clearTimeout(deadline);
    if (window.__openReaderHighlighter === dispatch) window.__openReaderHighlighter = original;
    else trace.errors.push('Dispatcher replaced while observing; original not overwritten');
  }
  function dispatch(message) {
    // Never make app delivery depend on observation/serialization succeeding.
    try {
      if (['speak', 'correct', 'hold', 'following', 'bar', 'inset', 'browse', 'return'].includes(message.kind)) {
        if (trace.messages.length < 200) trace.messages.push({ at: performance.now(), ...JSON.parse(JSON.stringify(message)) });
        else trace.overflow = true;
      }
    } catch (error) { trace.errors.push(String(error)); }
    return original.apply(this, arguments);
  }
  let last = -Infinity;
  function sample(now) {
    if (trace.stopped) return;
    try {
      if (now - last >= 50) {
        last = now;
        const stage = rendition.manager.container;
        const bounds = stage.getBoundingClientRect();
        const frame = { at: now, viewport: [window.innerWidth, window.innerHeight], stage: [bounds.left, bounds.top, stage.clientWidth, stage.clientHeight], scrollTop: stage.scrollTop, words: [] };
        for (const view of rendition.manager.views._views) {
          if (!view.displayed || !view.contents?.document?.defaultView) continue;
          const highlight = view.contents.window.CSS?.highlights?.get('openreader-word');
          if (!highlight) continue;
          const iframe = view.iframe.getBoundingClientRect();
          for (const range of highlight) {
            const rect = Array.from(range.getClientRects()).find(r => r.width > 0 && r.height > 0);
            if (rect) frame.words.push({ section: view.section.index, text: String(range),
              cfi: view.contents.cfiFromRange(range),
              rect: [iframe.left + rect.left, iframe.top + rect.top, rect.width, rect.height] });
          }
        }
        if (trace.frames.length < 220) trace.frames.push(frame);
        else { trace.overflow = true; stop(); return; }
      }
    } catch (error) { trace.errors.push(String(error)); stop(); return; }
    frameID = window.requestAnimationFrame(sample);
  }
  trace.stop = stop;
  window.__duoAcceptanceWordTrace = trace;
  window.__openReaderHighlighter = dispatch;
  frameID = window.requestAnimationFrame(sample);
  deadline = window.setTimeout(stop, 10000);
  return JSON.stringify({ armed: true, startedAt: trace.startedAt, maximumMs: 10000, limit: 'Word/bridge observation, not rendered PCM or native painting proof' });
}
