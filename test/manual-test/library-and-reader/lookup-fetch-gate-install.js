(() => {
  const w = globalThis;
  if (w.__hopeGate && w.__hopeGate.installed) return 'gate already installed';
  const original = w.fetch;
  const gate = { installed: true, count: 0, waiting: false, aborted: false, release: () => {}, restore: () => { w.fetch = original; delete w.__hopeGate; } };
  w.__hopeGate = gate;
  w.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/entries/en/hope') < 0) return original(input, init);
    gate.count += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      if (init && init.signal) {
        try { init.signal.addEventListener('abort', () => { gate.aborted = true; if (!settled) { settled = true; reject(new Error('Aborted')); } }); } catch (e) {}
      }
      original(input, init).then((response) => {
        gate.waiting = true;
        gate.release = () => { if (settled) return; settled = true; gate.waiting = false; resolve(response); };
      }, (e) => { if (!settled) { settled = true; reject(e); } });
    });
  };
  return 'gate installed';
})()
