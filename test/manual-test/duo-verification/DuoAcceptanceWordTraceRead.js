// Full raw export goes to the owned Metro log's uncut `HX PROBE` line. The
// device Debug Log truncates it at 2KB and MUST NOT be used for this export.
// See duo-acceptance.md for extraction by the exact startedAt receipt.
// eslint-disable-next-line no-unused-vars
function probe() {
  const trace = window.__duoAcceptanceWordTrace;
  if (!trace) throw new Error('No DuoAcceptance word trace');
  if (!trace.stopped) throw new Error('Trace still collecting; stop playback first and wait for its 10s deadline');
  const { startedAt, stoppedAt, timeOrigin, frames, messages, errors, overflow } = trace;
  return JSON.stringify({ marker: 'DuoAcceptanceWordTrace-v1', startedAt, stoppedAt, timeOrigin, frames, messages, errors, overflow });
}
