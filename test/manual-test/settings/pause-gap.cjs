#!/usr/bin/env node
// Targeted handler probe for #60/ADR 0047's differential pause timing, NOT a
// physical touch test. Drives the same handlers a touch would (Play, seek,
// rate) through the walkthrough harness and CDP, and polls the reader's own
// `status().utterance` at CDP speed (not the harness file's 250 ms poll, and
// not the reader's own 500 ms on-screen log) so a ~1000 ms gap difference is
// well inside the sampling resolution.
//
// Usage: pause-gap.cjs SIMULATOR_UDID CONTAINER_DATA_DIR DOC_ID SENTENCE_MS PARAGRAPH_MS START_UTTERANCE [TRANSITIONS=1]
//
// CONTAINER_DATA_DIR is `xcrun simctl get_app_container UDID top.xujialiu.openreader data`.
// Prints one `SAMPLE` line per poll and one `TRANSITION` line per Utterance
// change, then a `RUN` summary. Reads the pair between START_UTTERANCE and
// START_UTTERANCE+1 (etc. for TRANSITIONS>1) under the given pauses; run it
// twice with different SENTENCE_MS/PARAGRAPH_MS and diff the TRANSITION
// timestamps to isolate the gap (the Utterance's own speech duration is
// identical both times once its Clip is cached).
//
// Applies `settings.pauses` and opens the Document through the file-based
// harness (`shell.tsx`), from the Library, exactly as ADR 0047 requires for a
// fresh engine build — then switches to CDP alone for seek/rate/play/pause and
// all timing, which the harness's own 250 ms file poll is too coarse for.
const fs = require('node:fs');
const WebSocket = require('ws');
const { execFileSync } = require('node:child_process');

const [device, container, docId, sentenceMsArg, paragraphMsArg, startArg, transitionsArg] = process.argv.slice(2);
if (!device || !container || !docId || sentenceMsArg === undefined || paragraphMsArg === undefined || startArg === undefined) {
  console.error('Usage: pause-gap.cjs SIMULATOR_UDID CONTAINER_DATA_DIR DOC_ID SENTENCE_MS PARAGRAPH_MS START_UTTERANCE [TRANSITIONS=1]');
  process.exit(2);
}
const sentenceMs = Number(sentenceMsArg), paragraphMs = Number(paragraphMsArg), start = Number(startArg);
const wantTransitions = Number(transitionsArg ?? 1);
const harnessPath = `${container}/Documents/harness.json`;
let seq = Math.floor(Date.now() / 1000);
function send(cmd) {
  seq += 1;
  fs.writeFileSync(harnessPath, JSON.stringify({ seq, ...cmd }));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const HELPERS = `
  globalThis.__pauseProbe = (() => {
    function props(name) {
      let found;
      function walk(f) { if (!f) return; if (f.type?.name === name) found = f; walk(f.child); walk(f.sibling); }
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
      return found;
    }
    const refs = () => { const f = props('ReadingView'); if (!f) return []; const values = []; for (let h = f.memoizedState; h; h = h.next) values.push(h.memoizedState); return values; };
    const player = () => props('Player')?.memoizedProps;
    const status = () => refs().find(v => v && typeof v.known === 'number' && 'buffering' in v);
    const engine = () => refs().find(v => v?.current?.snapshot && v.current.switchVoice)?.current;
    return { player, status, engine };
  })();
  true;
`;

(async () => {
  // Shell-level commands only, one at a time: the file harness has one
  // `seenRef` per mounted listener and reads whatever the file holds at its
  // own 250 ms poll, so two commands written inside one poll window can lose
  // the first. 600 ms clears that window with margin.
  send({ do: 'shut' });
  await sleep(600);
  send({ do: 'settings', patch: { pauses: { sentenceMs, paragraphMs } } });
  await sleep(600);
  send({ do: 'open', id: docId });
  await sleep(600);

  const targets = (await fetch(new URL('/json/list', process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081')).then((r) => r.json()))
    .filter((p) => p.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error(`Expected one OpenReader target, found ${targets.length}`);
  const url = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(url.href, { origin: `http://${url.host}` });
  const pending = new Map();
  let cdpSeq = 0;
  socket.on('message', (bytes) => {
    const reply = JSON.parse(bytes.toString());
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++cdpSeq;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout')); }, 5000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails)));
      else resolve(reply.result.result.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });

  try {
    await evaluate(HELPERS);

    const readyDeadline = Date.now() + 20000;
    let known = -1;
    while (Date.now() < readyDeadline) {
      known = await evaluate('__pauseProbe.status()?.known ?? -1');
      if (known > start) break;
      await sleep(150);
    }
    if (known <= start) throw new Error(`Fixture never rendered past Utterance ${start} (known=${known})`);

    if (await evaluate('__pauseProbe.player()?.playing === true')) {
      await evaluate('__pauseProbe.player().onPause(); true');
      await sleep(300);
    }
    // `engine().seek()` needs a built engine, and the engine is built lazily on
    // the first Play (`use-reading.ts`'s `build()`), never on open. Before that
    // first Play, the harness's own file-based 'seek' is `reading.seekTo`, which
    // sets `atRef`/`status.utterance` synchronously with no engine at all — "the
    // engine that gets built will be loaded there" (`use-reading.ts`, `seekTo`).
    // Rate is a persistent setting (untouched by the `settings` patch above,
    // which only replaces `pauses`), so it is set once for the whole session
    // rather than replayed into every run.
    send({ do: 'seek', utterance: start });
    await sleep(600);
    const seekDeadline = Date.now() + 3000;
    let seeked = false;
    while (Date.now() < seekDeadline) {
      if ((await evaluate('__pauseProbe.status()?.utterance ?? null')) === start) { seeked = true; break; }
      await sleep(150);
    }
    if (!seeked) console.error(`Warning: status().utterance did not confirm seek to ${start} before Play`);

    // `set` immediately before `check`, not only once at the start of the
    // session: a reconnecting output device (Bluetooth, headphones) can put a
    // booted simulator back to 60 at any moment, independent of anything this
    // script does (README, Pitfalls, "A new output device on the Mac puts
    // booted simulators back to volume 60"). Measured in this run: two `set`s
    // several seconds apart, each followed by a `check` moments later, both
    // still found it at 60 — the reconnect was recurring faster than the
    // per-run setup (shut/settings/open/seek) took. `set` right here, with
    // `check` immediately after and `onPlay()` immediately after that, is the
    // tightest gap this script can offer.
    execFileSync('bash', [require.resolve('../kit/silence.sh'), 'set', device], { stdio: 'inherit' });
    execFileSync('bash', [require.resolve('../kit/silence.sh'), 'check', device], { stdio: 'inherit' });

    const samples = [];
    await evaluate('__pauseProbe.player().onPlay(); true');
    // Long enough for every transition asked for, and no longer: the loop
    // leaves the moment the last one is seen. A fixed 12 s cut a three-
    // transition run (about 11 s of speech and pauses) short.
    const runDeadline = Date.now() + 6000 + 5000 * wantTransitions;
    let seenTransitions = 0;
    let lastU = null;
    while (Date.now() < runDeadline) {
      const raw = await evaluate(
        "(() => { const s = __pauseProbe.status(); return JSON.stringify({ t: Date.now(), u: s?.utterance ?? null, playing: __pauseProbe.player()?.playing ?? null, level: s?.level ?? null }); })()",
      );
      const sample = JSON.parse(raw);
      samples.push(sample);
      console.log(`SAMPLE t=${sample.t} u=${sample.u} playing=${sample.playing} level=${sample.level}`);
      if (lastU !== null && sample.u !== lastU) {
        seenTransitions += 1;
        console.log(`TRANSITION ${lastU} -> ${sample.u} at t=${sample.t}`);
        if (seenTransitions >= wantTransitions) break;
      }
      if (sample.u !== null) lastU = sample.u;
      if (sample.playing === false && seenTransitions === 0 && samples.length > 1 && sample.t - samples[0].t > 3000) break;
      // A local CDP round trip alone answered in ~1 ms, which turned a few
      // seconds of playback into thousands of near-duplicate SAMPLE lines
      // (measured: 5222 lines over 5857 ms). 25 ms is still far finer than the
      // ~1000 ms gaps this script measures, at a log size worth reading.
      await sleep(25);
    }
    await evaluate('__pauseProbe.player().onPause(); true');
    console.log(
      `RUN sentenceMs=${sentenceMs} paragraphMs=${paragraphMs} start=${start} transitions=${seenTransitions} samples=${samples.length} elapsedMs=${samples.length ? samples[samples.length - 1].t - samples[0].t : 0}`,
    );
  } finally {
    socket.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
