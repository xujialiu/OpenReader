// CDP expression, read-only. Do not confuse parsed React state with native visibility.
// OPENREADER_DEVICE=NAME node test/manual-test/kit/cdp.cjs --eval THIS_FILE METRO
(() => {
  const found = [];
  function walk(fiber) {
    if (!fiber) return;
    if (fiber.type?.name === 'LookupDrawer') found.push(fiber.memoizedProps.lookup);
    walk(fiber.child); walk(fiber.sibling);
  }
  const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) throw new Error('React DevTools unavailable');
  for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
  if (found.length !== 1) throw new Error(`Require one mounted LookupDrawer, got ${found.length}`);
  const lookup = found[0];
  const gate = globalThis.__hopeGate;
  const traffic = globalThis.__duoAcceptanceLookupTraffic;
  return {
    observedAt: Date.now(),
    selection: lookup.selection ? { ...lookup.selection } : null,
    loading: lookup.loading, error: lookup.error,
    result: lookup.result ? { text: lookup.result.text, source: lookup.result.source } : null,
    gate: gate ? { installed: gate.installed, count: gate.count, waiting: gate.waiting, aborted: gate.aborted, requests: gate.requests } : null,
    traffic: traffic ? { installed: traffic.installed, requests: traffic.requests } : null,
  };
})()
