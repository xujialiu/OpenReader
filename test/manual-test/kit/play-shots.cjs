#!/usr/bin/env node
// Targeted React handler probe, NOT a physical touch test (reading.cjs's own
// note applies here too). Calls Player.onPlay()/onPause() through the same CDP
// React DevTools hook `reading.cjs` uses, taking a `xcrun simctl io screenshot`
// at each requested offset before the automatic pause. Built for a change in
// what gets *painted* during playback (a highlight's CSS, say) rather than in
// the transport controls themselves, where a handler probe exercises the same
// rendering code a real Play touch would.
//
//   node test/manual-test/kit/play-shots.cjs SIMULATOR_UDID OUT_DIR TOTAL_SECONDS SHOT_SECONDS[,SHOT_SECONDS...] [namePrefix]
//
// SHOT_SECONDS are offsets from the Play call, comma-separated, each producing
// OUT_DIR/PREFIX-N.Ns.png. TOTAL_SECONDS is when the automatic Pause fires (0 <
// seconds <= 10, matching reading.cjs's own cap). Reports no credentials.
const WebSocket = require('ws');
const { execFileSync } = require('node:child_process');
const [device, outDir, totalSecondsArg, shotsArg, ...rest] = process.argv.slice(2);
const totalMs = Number(totalSecondsArg) * 1000;
const shotOffsetsMs = (shotsArg || '').split(',').filter(Boolean).map((s) => Number(s) * 1000);
if (
  !device || !outDir || !Number.isFinite(totalMs) || totalMs <= 0 || totalMs > 10000 ||
  shotOffsetsMs.length === 0 || shotOffsetsMs.some((s) => !Number.isFinite(s) || s < 0 || s > totalMs)
) {
  console.error('Usage: play-shots.cjs SIMULATOR_UDID OUT_DIR TOTAL_SECONDS SHOT_SECONDS[,SHOT_SECONDS...] [namePrefix] (0 < TOTAL_SECONDS <= 10)');
  process.exit(2);
}
const prefix = rest[0] || 'shot';
// The simulator's own volume, not the Mac's.
try { execFileSync('bash', [require.resolve('./silence.sh'), 'check', device], { stdio: 'inherit' }); } catch { process.exit(2); }

(async () => {
  const targets = (await fetch(new URL('/json/list', process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081')).then((r) => r.json())).filter((p) => p.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error(`Expected one OpenReader target, found ${targets.length}`);
  const url = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(url.href, { origin: `http://${url.host}` });
  const pending = new Map();
  let sequence = 0;
  socket.on('message', (bytes) => {
    const reply = JSON.parse(bytes.toString());
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger request timed out')); }, 5000);
    pending.set(id, (reply) => {
      clearTimeout(timer);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error('Reading handler evaluation failed: ' + JSON.stringify(reply.error ?? reply.result.exceptionDetails)));
      else resolve(reply.result.result.value);
    });
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  const find = `globalThis.__manualReadingPlayer = () => {
    let found;
    function walk(f) { if (!f) return; if (f.type?.name === 'Player') found = f.memoizedProps; walk(f.child); walk(f.sibling); }
    const hook = __REACT_DEVTOOLS_GLOBAL_HOOK__;
    for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) walk(root.current);
    if (!found) throw new Error('Open a Document first'); return found;
  };`;
  let started = false;
  let t0 = 0;
  const shot = (name) => {
    execFileSync('xcrun', ['simctl', 'io', device, 'screenshot', `${outDir}/${name}.png`], { stdio: 'ignore' });
    console.log(`shot ${name} at t=${Date.now() - t0}ms`);
  };
  try {
    await evaluate(find);
    const state = await evaluate('({playing:__manualReadingPlayer().playing, enabled:__manualReadingPlayer().enabled})');
    if (state.playing || !state.enabled) throw new Error('Start with an enabled, paused reader');
    started = true;
    t0 = Date.now();
    // An in-app watchdog backs up the host's finally block if CDP disconnects.
    await evaluate(`(() => { const player = __manualReadingPlayer(); player.onPlay(); setTimeout(player.onPause, ${totalMs}); return true; })()`);
    for (const offset of shotOffsetsMs) {
      const wait = offset - (Date.now() - t0);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      shot(`${prefix}-${Math.round(offset / 100) / 10}s`);
    }
    const remaining = totalMs - (Date.now() - t0);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    console.log(JSON.stringify(await evaluate('({playing:__manualReadingPlayer().playing, enabled:__manualReadingPlayer().enabled, notes:__manualReadingPlayer().notes})')));
  } finally {
    if (started) await evaluate('__manualReadingPlayer().onPause(); true').catch(() => console.error('Automatic pause was not confirmed; stop playback in the app'));
    await evaluate('delete globalThis.__manualReadingPlayer').catch(() => {});
    socket.close();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
