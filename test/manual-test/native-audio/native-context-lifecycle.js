/* Run through kit/cdp.cjs on an explicitly selected, SILENCED owned simulator.
 * Uses actual app graph/pronunciation code and native nodes, generated silence,
 * and one intercepted .invalid URL. No Provider or external network request.
 * Read globalThis.__or333Lifecycle for completion; relaunch after measurement.
 */
(() => {
  function exportsWith(name) {
    for (const [id, module] of globalThis.__r.getModules()) {
      if (module.isInitialized && typeof module.publicModule?.exports?.[name] === 'function') return module.publicModule.exports;
      if (name === 'playPronunciation' && module.verboseName?.endsWith('src/translation/pronunciation-audio.ts')) return globalThis.__r(id);
    }
    throw new Error('Required app export not loaded: ' + name);
  }
  const api = exportsWith('AudioContext');
  const { createAudioGraph } = exportsWith('createAudioGraph');
  const { playPronunciation } = exportsWith('playPronunciation');
  const status = globalThis.__or333Lifecycle = { stage: 'starting', graphs: 0, pronunciations: 0, nativeContexts: 0, workerContexts: 0, errors: [], positions: 0, ended: 0 };
  const nativeCreate = globalThis.createAudioContext;
  const realFetch = globalThis.fetch;
  let graph = null;
  let pronunciationAbort = null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wav = new ArrayBuffer(44 + 4800 * 2);
  const view = new DataView(wav);
  function ascii(at, text) { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); }
  ascii(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, wav.byteLength - 44, true);
  globalThis.createAudioContext = function (rate, worker) {
    status.nativeContexts++;
    if (worker != null) status.workerContexts++;
    return nativeCreate(rate, worker);
  };
  // No fallback to a real request is permitted during this isolated test.
  globalThis.fetch = async url => {
    if (url !== 'https://openreader.invalid/native-test.wav') throw new Error('Unexpected test fetch');
    return { ok: true, arrayBuffer: async () => wav.slice(0) };
  };
  const deadline = setTimeout(() => {
    status.errors.push('30-second lifecycle deadline');
    graph?.pause(); pronunciationAbort?.abort();
  }, 30000);
  void (async () => {
    try {
      // Positive control: default upstream behavior really does pass a worker.
      status.stage = 'control';
      const control = new api.AudioContext({ sampleRate: 24000 });
      await control.close();
      if (status.workerContexts !== 1) throw new Error('Runtime-allocation counter control failed');
      status.nativeContexts = 0; status.workerContexts = 0;
      for (let i = 0; i < 10; i++) {
        status.stage = 'graph ' + i;
        const beforeEnded = status.ended;
        // First graph exceeds the app's 1 s position-report interval; later
        // half-second graphs only exercise allocation/scheduling/cleanup.
        const clip = { utterance: i, audio: 'samples', samples: new Float32Array(i === 0 ? 31200 : 12000), sampleRate: 24000, words: null };
        graph = await createAudioGraph(clip, {
          onPosition: () => { status.positions++; }, onBufferEnded: () => { status.ended++; },
          onOutputLost: () => { status.errors.push('output lost'); graph?.pause(); },
          onInterrupted: () => { status.errors.push('interrupted'); graph?.pause(); },
          onInterruptionEnded: () => {}, onError: error => { status.errors.push(String(error)); },
        });
        graph.enqueue(await graph.prepare(clip), 0);
        graph.setRate(i % 2 ? 1.25 : 1);
        graph.resume(); await wait(60); graph.pause(); await wait(30); graph.resume();
        const until = Date.now() + 2000;
        while (status.ended === beforeEnded && Date.now() < until) await wait(30);
        if (status.ended === beforeEnded) throw new Error('Native queue did not finish graph ' + i);
        graph.pause(); await graph.dispose(); graph = null; status.graphs++;
      }
      for (let i = 0; i < 3; i++) {
        status.stage = 'pronunciation ' + i;
        pronunciationAbort = new AbortController();
        await playPronunciation('https://openreader.invalid/native-test.wav', pronunciationAbort.signal,
          () => { status.errors.push('pronunciation output lost'); });
        pronunciationAbort = null; status.pronunciations++;
      }
      if (status.nativeContexts !== 13 || status.workerContexts !== 0 || status.positions === 0 || status.errors.length) {
        throw new Error('Native-only lifecycle postconditions failed');
      }
      status.stage = 'passed';
    } catch (error) { status.stage = 'failed'; status.errors.push(String(error)); }
    finally {
      clearTimeout(deadline); graph?.pause(); await graph?.dispose(); pronunciationAbort?.abort();
      globalThis.createAudioContext = nativeCreate; globalThis.fetch = realFetch;
    }
  })();
  return JSON.stringify(status);
})()
