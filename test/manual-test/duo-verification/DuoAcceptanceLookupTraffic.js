// #350 only: passthrough request counter. No response replacement, body reads,
// header capture or credentials. Do NOT stack with the held gate/watchfetch.
// Evaluate once through kit/cdp.cjs. Restore through the expression in the recipe.
(() => {
  const runtime = globalThis;
  if (runtime.__hopeGate || runtime.__duoAcceptanceLookupTraffic) throw new Error('Restore the existing lookup observer first');
  const original = runtime.fetch;
  const observer = { installed: true, requests: [], restore: null };
  function intercepted(input, init) {
    const raw = typeof input === 'string' ? input : String(input?.url ?? input);
    let url;
    try { url = new URL(raw); } catch { return original(input, init); }
    const lookup = (url.hostname === 'api.dictionaryapi.dev' && url.pathname.startsWith('/api/v2/entries/en/')) ||
      (url.hostname === 'www.youdao.com' && url.pathname.startsWith('/w/')) ||
      (url.hostname === 'aidemo.youdao.com' && url.pathname === '/trans') ||
      (url.hostname === 'translate.googleapis.com' && url.pathname === '/translate_a/single') ||
      (url.hostname === 'api.cognitive.microsofttranslator.com' && url.pathname === '/translate');
    if (!lookup) return original(input, init);
    // Deliberately omit query strings, POST bodies and headers. Correlate text
    // with selection snapshots and the app's own lookup log, not credentials.
    const record = { service: url.hostname, startedAt: Date.now(), responseAt: null, status: null, abortedAt: null, failedAt: null };
    observer.requests.push(record);
    const signal = init?.signal ?? input?.signal;
    const abort = () => { record.abortedAt = Date.now(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    try {
      return original(input, init).then(response => {
        record.responseAt = Date.now(); record.status = response.status; cleanup(); return response;
      }, error => { record.failedAt = Date.now(); cleanup(); throw error; });
    } catch (error) { record.failedAt = Date.now(); cleanup(); throw error; }
  }
  observer.restore = () => {
    if (runtime.fetch !== intercepted) throw new Error('Another fetch wrapper replaced this observer; do not overwrite it');
    runtime.fetch = original; observer.installed = false;
    delete runtime.__duoAcceptanceLookupTraffic;
    return 'DuoAcceptance lookup traffic restored';
  };
  runtime.__duoAcceptanceLookupTraffic = observer;
  runtime.fetch = intercepted;
  return 'DuoAcceptance lookup traffic armed; restore after the paired counts';
})()
