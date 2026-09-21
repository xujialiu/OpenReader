#!/usr/bin/env node
// Targeted React handler probe, NOT a physical touch test. Reports no credentials.
const WebSocket = require('ws');
const { execFileSync } = require('node:child_process');
const [action, duration, device = process.env.SIMULATOR_UDID] = process.argv.slice(2);
const milliseconds = Number(duration) * 1000;
if (!['state', 'pause', 'play-for'].includes(action) || (action === 'play-for' && (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 10000))) {
  console.error('Usage: reading.cjs state|pause | play-for SECONDS [SIMULATOR_UDID] (0 < seconds <= 10)'); process.exit(2);
}
// The simulator's own volume, not the Mac's.
if (action === 'play-for') {
  try { execFileSync('bash', [require.resolve('./silence.sh'), 'check', ...(device ? [device] : [])], { stdio: 'inherit' }); } catch { process.exit(2); }
}
(async () => {
  const targets = (await fetch('http://127.0.0.1:8081/json/list').then(r => r.json())).filter(p => p.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error(`Expected one OpenReader target, found ${targets.length}`);
  const url = new URL(targets[0].webSocketDebuggerUrl);
  const socket = new WebSocket(url.href, { origin: `http://${url.host}` });
  const pending = new Map(); let sequence = 0;
  socket.on('message', bytes => {
    const reply = JSON.parse(bytes.toString());
    pending.get(reply.id)?.(reply); pending.delete(reply.id);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Debugger request timed out')); }, 5000);
    pending.set(id, reply => {
      clearTimeout(timer);
      if (reply.error || reply.result?.exceptionDetails) reject(new Error('Reading handler evaluation failed'));
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
  try {
    await evaluate(find);
    if (action === 'play-for') {
      const state = await evaluate('({playing:__manualReadingPlayer().playing, enabled:__manualReadingPlayer().enabled})');
      if (state.playing || !state.enabled) throw new Error('Start with an enabled, paused reader');
      started = true;
      // An in-app watchdog backs up the host's finally block if CDP disconnects.
      await evaluate(`(() => { const player = __manualReadingPlayer(); player.onPlay(); setTimeout(player.onPause, ${milliseconds}); return true; })()`);
      await new Promise(resolve => setTimeout(resolve, milliseconds));
    }
    if (action === 'pause' || started) await evaluate('__manualReadingPlayer().onPause(); true');
    console.log(JSON.stringify(await evaluate('({playing:__manualReadingPlayer().playing, enabled:__manualReadingPlayer().enabled, notes:__manualReadingPlayer().notes})')));
  } finally {
    if (started) await evaluate('__manualReadingPlayer().onPause(); true').catch(() => console.error('Automatic pause was not confirmed; stop playback in the app'));
    await evaluate('delete globalThis.__manualReadingPlayer').catch(() => {});
    socket.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
