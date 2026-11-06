(() => {
  const runtime = globalThis;
  if (runtime.__hopeGate?.installed) throw new Error('Restore the existing lookup gate before another attempt');
  const original = runtime.fetch;
  const pending = [];
  const gate = {
    installed: true, count: 0, waiting: false, aborted: false, requests: [],
    release() {
      let released = 0;
      for (const entry of pending) if (entry.release()) released++;
      return released;
    },
    restore() {
      // Do not leave a response withheld after diagnostic teardown.
      for (const entry of pending) entry.restore();
      if (runtime.fetch === intercepted) runtime.fetch = original;
      gate.installed = false;
      delete runtime.__hopeGate;
    },
  };
  const refresh = () => { gate.waiting = gate.requests.some((request) => request.state === 'held'); };
  function intercepted(input, init) {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (url !== 'https://api.dictionaryapi.dev/api/v2/entries/en/hope') return original(input, init);
    gate.count++;
    const record = { state: 'requested', startedAt: Date.now(), heldAt: null, releasedAt: null, abortedAt: null };
    gate.requests.push(record);
    return new Promise((resolve, reject) => {
      let settled = false;
      let restoring = false;
      let response;
      const signal = init?.signal ?? input?.signal;
      const cleanup = () => signal?.removeEventListener('abort', abort);
      const abort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        record.state = 'aborted';
        record.abortedAt = Date.now();
        gate.aborted = true;
        refresh();
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      };
      const release = () => {
        if (settled || record.state !== 'held') return false;
        settled = true;
        cleanup();
        record.state = 'released';
        record.releasedAt = Date.now();
        refresh();
        resolve(response);
        return true;
      };
      pending.push({ release, restore: () => { restoring = true; release(); } });
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort);
      original(input, init).then((answer) => {
        if (settled) return;
        response = answer;
        record.state = 'held';
        record.heldAt = Date.now();
        refresh();
        if (restoring) release();
      }, (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        record.state = 'failed';
        refresh();
        reject(error);
      });
    });
  }
  runtime.__hopeGate = gate;
  runtime.fetch = intercepted;
  return 'gate installed; timestamps are in the app runtime clock';
})()
