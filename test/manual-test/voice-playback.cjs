#!/usr/bin/env node
// Real simulator audio graph + deterministic provider replies. Handler probes,
// not touch tests; reader.sh exercises actual touches separately.
const WebSocket = require('ws');
const { execFileSync, execFile } = require('node:child_process');
const [device, output, mode] = process.argv.slice(2);
if (!device || !output) throw new Error('Usage: voice-playback.cjs SIMULATOR_UDID EXISTING_ARTIFACT_DIR');
if (execFileSync('osascript', ['-e', 'output volume of (get volume settings)'], { encoding: 'utf8' }).trim() !== '0') throw new Error('Mute machine and simulator before testing');

const fixture = probeMode => {
  function props(name) {
    let found;
    function walk(f) { if (!f) return; if (f.type?.name === name) found = f; walk(f.child); walk(f.sibling); }
    const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
    if (!found) throw new Error('Open a Document first: ' + name);
    return found;
  }
  const player = () => props('Player').memoizedProps;
  const sheet = () => props('VoiceSheet').memoizedProps;
  const refs = () => {
    const values = [];
    for (let hook = props('ReadingView').memoizedState; hook; hook = hook.next) values.push(hook.memoizedState);
    return values;
  };
  const engine = () => refs().find(v => v?.current?.snapshot && v.current.switchVoice)?.current;
  const status = () => refs().find(v => v && typeof v.known === 'number' && 'buffering' in v);
  const original = { voice: player().settings.voice, provider: player().settings.provider, rate: player().settings.rate };
  if (original.provider !== 'fish') throw new Error('This fixture requires an enabled Fish provider and a saved key');
  const voices = sheet().lists.voicesOf('fish')?.slice(0, 8).map(v => v.id);
  if (!voices || voices.length < 7) throw new Error('Open Voice once and wait for its list (at least seven choices)');
  const realFetch = globalThis.fetch;
  // Keep the first reply pending across the screenshot and Pause. Subsequent
  // scenarios use short delays and stop on the transition being asserted.
  const state = { delay: 2000, fail: null, noTimings: null, requests: 0, completed: 0, aborted: 0, player, sheet, engine, status, voices, original };
  function wav(seconds) {
    const hz = 24000, count = Math.ceil(seconds * hz), bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
    function label(offset, text) { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); }
    label(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, hz, true); view.setUint32(28, hz * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, 'data'); view.setUint32(40, count * 2, true);
    // Silence still advances the real native source clock; no sound is needed
    // to prove transport, queue replacement, and timing alignment.
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }
  globalThis.fetch = (input, init) => {
    if (!String(input).includes('/v1/tts/stream/with-timestamp')) return realFetch(input, init);
    const request = JSON.parse(init.body);
    const words = request.text.trim().split(/\s+/).filter(Boolean);
    const audio_base64 = wav(words.length * 0.3 + 0.12);
    const segments = words.map((text, i) => ({ text, start: i * 0.3, end: (i + 1) * 0.3 }));
    state.requests++;
    init.signal?.addEventListener('abort', () => { state.aborted++; });
    return new Promise(resolve => setTimeout(() => {
      state.completed++;
      if (state.fail === request.reference_id) return resolve(new Response('fixture failure', { status: 500 }));
      resolve(new Response('data: ' + JSON.stringify({ audio_base64, chunk_seq: 0,
        alignment: state.noTimings === request.reference_id ? null : { segments } }) + '\n\n', { status: 200 }));
    }, state.delay));
  };
  if (probeMode === 'paused-seek') {
    // Read the actual WebView highlight through the existing diagnostic channel.
    // The temporary receiver survives React updates, consumes only our response,
    // and is restored during cleanup.
    const bridge = () => refs().find(v => v?.current?.readerProps && v.current.show)?.current;
    const inject = script => {
      for (let hook = props('ReaderProvider').memoizedState; hook; hook = hook.next) {
        if (hook.memoizedState?.current?.injectJavaScript) return hook.memoizedState.current.injectJavaScript(script);
      }
      throw new Error('No reader WebView');
    };
    const options = refs().find(v => v?.current?.onBlocks && v.current.onTap);
    let rawOptions = options.current;
    const receive = message => {
      if (!message.detail.startsWith('paused-seek-probe:')) return rawOptions.onProblem?.(message);
      state.highlight = JSON.parse(message.detail.slice('paused-seek-probe:'.length));
    };
    let observedOptions = { ...rawOptions, onProblem: receive };
    Object.defineProperty(options, 'current', { configurable: true,
      get: () => observedOptions,
      set: value => { rawOptions = value; observedOptions = { ...value, onProblem: receive }; },
    });
    state.restoreReceiver = () => Object.defineProperty(options, 'current', { configurable: true, writable: true, value: rawOptions });
    state.sample = () => {
      state.highlight = null;
      inject(`(() => {
        const texts = name => rendition.getContents().flatMap(c => Array.from(c.window.CSS.highlights.get(name) ?? []).map(r => r.toString()));
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'openreader:problem', utterance: -1,
          detail: 'paused-seek-probe:' + JSON.stringify({ words: texts('openreader-word'), sentences: texts('openreader-utterance') }) }));
      })(); true;`);
    };
    state.tapSentence = index => {
      const list = refs().find(v => Array.isArray(v?.current) && v.current[0]?.spans)?.current;
      const blocks = refs().find(v => Array.isArray(v?.current) && v.current[0]?.id && v.current[0]?.text)?.current;
      const span = list?.[index]?.spans[0];
      if (!span || !blocks?.[span.block]) throw new Error('Missing tap target');
      // Same message the WebView posts for a text tap, in the middle of the sentence.
      bridge().readerProps.onWebViewMessage({ type: 'openreader:tap', block: blocks[span.block].id,
        offset: Math.min(span.end - 1, span.start + 8) });
      return list[index].text;
    };
  }
  state.longSentence = () => {
    const list = refs().find(v => Array.isArray(v?.current) && v.current[0]?.spans)?.current;
    if (!list) throw new Error('No rendered utterances');
    const index = list.findIndex(v => v.text.split(/\s+/).length >= 18);
    if (index < 0) throw new Error('Fixture document needs an 18-word sentence');
    engine().seek(index);
    return index;
  };
  state.choose = (index) => sheet().onChoose('fish', voices[index]);
  state.inspect = () => ({ playing: player().playing, buffering: player().buffering, voice: player().settings.voice,
    pending: sheet().pending?.voice ?? null, error: sheet().error, visible: sheet().visible,
    requests: state.requests, completed: state.completed, aborted: state.aborted,
    utterance: engine()?.snapshot().utterance, queued: engine()?.snapshot().queued, level: status()?.level });
  state.play = () => {
    state.playStarted = Date.now(); player().onPlay();
    state.watchdog = setTimeout(() => player().onPause(), 8000);
  };
  state.pause = () => { player().onPause(); clearTimeout(state.watchdog); return Date.now() - state.playStarted; };
  state.cleanup = () => { player().onPause(); clearTimeout(state.watchdog); clearInterval(state.touchWatchdog); globalThis.fetch = realFetch;
    state.restoreReceiver?.(); sheet().onChoose(original.provider, original.voice); player().onRate(original.rate); sheet().onClose(); };
  globalThis.__voiceProbe = state;
  player().onRate(1);
  return { voices };
};

(async () => {
  const targets = (await fetch('http://127.0.0.1:8081/json/list').then(r => r.json())).filter(p => p.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error('Expected one OpenReader debugger');
  const url = new URL(targets[0].webSocketDebuggerUrl), socket = new WebSocket(url.href, { origin: `http://${url.host}` });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0;
  const pending = new Map();
  socket.on('message', bytes => { const reply = JSON.parse(bytes); pending.get(reply.id)?.(reply); });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence;
    const deadline = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout')); }, 5000);
    pending.set(id, reply => { pending.delete(id); clearTimeout(deadline);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails)));
      else resolve(reply.result.result.value); });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  const wait = async (expression, label, timeout = 4000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(label + ': ' + JSON.stringify(await evaluate('__voiceProbe.inspect()')));
  };
  const shot = name => execFileSync('xcrun', ['simctl', 'io', device, 'screenshot', `${output}/${name}.png`], { stdio: 'ignore' });
  const assert = async (expression, label) => { if (!await evaluate(expression)) throw new Error(label + ': ' + JSON.stringify(await evaluate('__voiceProbe.inspect()'))); };
  let installed = false;
  try {
    await evaluate(`(${fixture})(${JSON.stringify(mode ?? "handover")})`); installed = true;
    await evaluate('__voiceProbe.player().onVoices(); __voiceProbe.choose(1); true');
    await wait('__voiceProbe.player().settings.voice === __voiceProbe.voices[1]', 'paused choice');
    if (mode === 'touch') {
      await evaluate(`__voiceProbe.delay = 5000; __voiceProbe.sheet().onClose();
        __voiceProbe.touchWatchdog = setInterval(() => {
          if (__voiceProbe.player().playing) {
            __voiceProbe.touchStarted ??= Date.now();
            if (Date.now() - __voiceProbe.touchStarted > 8000) __voiceProbe.player().onPause();
          } else if (__voiceProbe.touchStarted && !__voiceProbe.touchEnded) {
            __voiceProbe.touchEnded = Date.now();
            __voiceProbe.touchCompletedAtPause = __voiceProbe.completed;
          }
        }, 50); true`);
      await new Promise((resolve, reject) => execFile('bash', ['test/manual-test/reader.sh', device, output, 'loading'],
        { timeout: 90000 }, (error, stdout) => { if (error) reject(error); else { console.log(stdout); resolve(); } }));
      await assert('__voiceProbe.touchCompletedAtPause === 0', 'Physical pause must happen before audio arrives');
      await wait('__voiceProbe.completed >= 2 && __voiceProbe.engine()?.snapshot().queued > 0', 'background receipt after physical pause');
      await assert('!__voiceProbe.player().playing && !__voiceProbe.player().buffering && !__voiceProbe.aborted', 'physical pause did not preserve pending audio');
      console.log('PASS: physical spinner tap, paused receipt; intent interval ms=' + await evaluate('__voiceProbe.touchEnded - __voiceProbe.touchStarted'));
      return;
    }
    await evaluate('__voiceProbe.sheet().onClose(); true');
    if (mode === 'paused-seek') {
      await evaluate('__voiceProbe.tapSentence(1); true');
      await new Promise(resolve => setTimeout(resolve, 650));
    }
    await evaluate('__voiceProbe.play(); true');
    await wait('__voiceProbe.player().playing && __voiceProbe.player().buffering', 'initial spinner');
    shot('player-loading');
    await assert('__voiceProbe.player().buffering && __voiceProbe.completed === 0', 'Pause must precede receipt of the first audio');
    console.log('initial loading paused after ms=' + await evaluate('__voiceProbe.pause()'));
    await wait('__voiceProbe.engine()?.snapshot().queued > 0', 'download continues while paused');
    await assert('!__voiceProbe.player().playing && !__voiceProbe.player().buffering && __voiceProbe.aborted === 0', 'late audio resumed or aborted');
    console.log('paused receipt ' + JSON.stringify(await evaluate('__voiceProbe.inspect()')));
    if (mode === 'paused-seek') {
      const sample = async () => {
        await evaluate('__voiceProbe.sample(); true');
        await wait('__voiceProbe.highlight !== null', 'WebView highlight sample');
        return evaluate('__voiceProbe.highlight');
      };
      const at = await evaluate('__voiceProbe.engine().snapshot().utterance');
      for (const target of [at, at + 1]) {
        const sentence = await evaluate(`__voiceProbe.tapSentence(${target})`);
        await wait(`__voiceProbe.engine().snapshot().utterance === ${target} && __voiceProbe.engine().snapshot().queued > 0`, 'paused seek prepared');
        // Debounce is 600 ms. Wait through it even when tapping the current sentence.
        await new Promise(resolve => setTimeout(resolve, 700));
        const before = await sample();
        // Fixture words are 300 ms apart: two intervals expose unwanted motion.
        await new Promise(resolve => setTimeout(resolve, 600));
        const after = await sample();
        await assert('!__voiceProbe.player().playing', 'paused tap resumed playback');
        console.log('paused seek ' + JSON.stringify({ target, sentence, before, after }));
        if (before.words.length || after.words.length || !after.sentences.length ||
          JSON.stringify(before.sentences) !== JSON.stringify(after.sentences)) throw new Error('Paused selection must show a static whole sentence');
        shot('paused-seek-' + target);
        await evaluate('__voiceProbe.play(); true');
        try {
          const started = Date.now();
          let playing;
          do { playing = await sample(); } while (!playing.words.length && Date.now() - started < 1000);
          if (!playing.words.length || !sentence.startsWith(playing.words[0])) throw new Error('Play did not start at the selected sentence first word: ' + JSON.stringify(playing));
        } finally { console.log('selected sentence playback ms=' + await evaluate('__voiceProbe.pause()')); }
      }
      console.log('PASS: paused current/next sentence remains static; Play starts at each sentence first word');
      return;
    }
    await evaluate('__voiceProbe.delay = 100; __voiceProbe.longSentence(); true');
    await wait('__voiceProbe.engine().snapshot().queued > 0', 'long sentence prepared');
    await evaluate('__voiceProbe.player().onVoices(); __voiceProbe.play(); __voiceProbe.choose(2); true');
    await wait('__voiceProbe.sheet().pending?.voice === __voiceProbe.voices[2]', 'voice spinner');
    await assert('__voiceProbe.player().playing && !__voiceProbe.player().buffering && __voiceProbe.sheet().visible', 'old voice did not continue');
    const before = await evaluate('__voiceProbe.inspect()');
    shot('voice-loading');
    await wait('__voiceProbe.player().settings.voice === __voiceProbe.voices[2] && !__voiceProbe.sheet().pending', 'word handover');
    const after = await evaluate('__voiceProbe.inspect()');
    console.log('word handover ' + JSON.stringify({ before, after, ms: await evaluate('__voiceProbe.pause()') }));
    if (before.utterance !== after.utterance) throw new Error('Expected a word handover in the same utterance');
    shot('voice-selected');
    await evaluate('__voiceProbe.delay = 180; __voiceProbe.play(); __voiceProbe.choose(3); __voiceProbe.choose(0); true');
    await wait('__voiceProbe.player().settings.voice === __voiceProbe.voices[0] && !__voiceProbe.sheet().pending', 'last choice wins');
    console.log('rapid handover paused after ms=' + await evaluate('__voiceProbe.pause()'));
    await evaluate('__voiceProbe.fail = __voiceProbe.voices[4].split("/").slice(1).join("/"); __voiceProbe.play(); __voiceProbe.choose(4); __voiceProbe.sheet().onClose(); true');
    await wait('!!__voiceProbe.sheet().error && !__voiceProbe.sheet().pending', 'failure reported');
    await assert('__voiceProbe.player().settings.voice === __voiceProbe.voices[0] && __voiceProbe.player().playing', 'failure replaced or stopped old voice');
    await assert('__voiceProbe.player().notes.some(note => note.said === __voiceProbe.sheet().error)', 'failure must remain visible after closing Voice');
    console.log('failed handover paused after ms=' + await evaluate('__voiceProbe.pause()'));
    await evaluate('__voiceProbe.player().onVoices(); true');
    await evaluate('__voiceProbe.fail = null; __voiceProbe.noTimings = __voiceProbe.voices[5].split("/").slice(1).join("/"); __voiceProbe.engine().seek(1); true');
    await wait('__voiceProbe.engine().snapshot().queued > 0', 'short sentence prepared');
    await evaluate('__voiceProbe.play(); __voiceProbe.choose(5); true');
    await wait('__voiceProbe.player().settings.voice === __voiceProbe.voices[5] && !__voiceProbe.sheet().pending', 'sentence fallback');
    await assert('__voiceProbe.engine().snapshot().utterance === 2 && __voiceProbe.status().level === "utterance"', 'fallback did not land at next sentence');
    console.log('sentence fallback paused after ms=' + await evaluate('__voiceProbe.pause()'));
    await evaluate('__voiceProbe.delay = 600; __voiceProbe.play(); __voiceProbe.choose(6); true');
    await wait('__voiceProbe.sheet().pending?.voice === __voiceProbe.voices[6]', 'pending pause scenario');
    console.log('pending switch paused after ms=' + await evaluate('__voiceProbe.pause()'));
    const completed = await evaluate('__voiceProbe.completed');
    await wait(`__voiceProbe.completed >= ${completed + 2}`, 'replacement received while paused');
    await assert('!__voiceProbe.player().playing && __voiceProbe.player().settings.voice === __voiceProbe.voices[5] && !!__voiceProbe.sheet().pending', 'replacement resumed or selected itself while paused');
    await evaluate('__voiceProbe.play(); true');
    await wait('__voiceProbe.player().settings.voice === __voiceProbe.voices[6] && !__voiceProbe.sheet().pending', 'paused switch resumes only on Play', 6000);
    console.log('pending switch resumed then paused after ms=' + await evaluate('__voiceProbe.pause()'));
    console.log('PASS: loading pause, retained audio, word handover, rapid selection, failure rollback, sentence fallback, paused handover');
  } finally {
    if (installed) await evaluate('__voiceProbe.cleanup(); delete globalThis.__voiceProbe; true').catch(error => console.error('Cleanup failed: ' + error.message));
    socket.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
