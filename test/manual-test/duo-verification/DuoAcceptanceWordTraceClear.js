// Always run after exporting, also on a failed measurement. No audio action.
// eslint-disable-next-line no-unused-vars
function probe() {
  const trace = window.__duoAcceptanceWordTrace;
  if (!trace) return 'DuoAcceptance word trace absent';
  trace.stop();
  delete window.__duoAcceptanceWordTrace;
  return 'DuoAcceptance word trace stopped and cleared';
}
