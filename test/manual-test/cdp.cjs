#!/usr/bin/env node
// Uses the ws installation shipped with Metro. Does not install or inject app code.
const { readFileSync } = require('node:fs');
const WebSocket = require('ws');
const [mode, input, metro = 'http://127.0.0.1:8081'] = process.argv.slice(2);
if (!['--eval', '--warnings'].includes(mode) || (mode === '--eval' && !input)) {
  console.error('Usage: cdp.cjs --eval FILE [METRO_URL] | --warnings [MILLISECONDS=1500] [METRO_URL]');
  process.exit(2);
}
(async () => {
  const pages = await fetch(new URL('/json/list', metro)).then(response => response.json());
  const targets = pages.filter(page => page.appId === 'top.xujialiu.openreader');
  if (targets.length !== 1) throw new Error(`Expected one OpenReader debug target; found ${targets.length}`);
  const endpoint = new URL(targets[0].webSocketDebuggerUrl);
  // Match the debugger endpoint's host. Mixing localhost and 127.0.0.1 caused
  // immediate 1006 closes with this Expo/Metro version.
  const origin = `${endpoint.protocol === 'wss:' ? 'https:' : 'http:'}//${endpoint.host}`;
  const socket = new WebSocket(endpoint.href, { origin });
  let completed = false;
  const deadline = setTimeout(() => { console.error('Debugger request timed out'); socket.terminate(); process.exitCode = 1; }, 10000);
  socket.on('error', error => { console.error(error.message); process.exitCode = 1; });
  socket.on('open', () => socket.send(JSON.stringify({
    id: 1,
    method: mode === '--eval' ? 'Runtime.evaluate' : 'Runtime.enable',
    params: mode === '--eval' ? { expression: readFileSync(input, 'utf8'), returnByValue: true } : {},
  })));
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (mode === '--warnings' && message.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(message.params.type)) {
      console.log(JSON.stringify({ type: message.params.type, messages: message.params.args.map(arg => arg.value ?? arg.description) }));
    }
    if (message.id !== 1) return;
    if (message.error || message.result?.exceptionDetails) {
      console.error(JSON.stringify(message.error ?? message.result.exceptionDetails));
      process.exitCode = 1; completed = true; socket.close(); return;
    }
    if (mode === '--eval') {
      console.log(JSON.stringify(message.result.result)); completed = true; socket.close();
    } else {
      const milliseconds = Number(input ?? 1500);
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 8000) {
        console.error('Warning capture must be between 0 and 8000 ms'); process.exitCode = 2;
        completed = true; socket.close(); return;
      }
      setTimeout(() => { completed = true; socket.close(); }, milliseconds);
    }
  });
  socket.on('close', (code, reason) => {
    clearTimeout(deadline);
    if (!completed) { console.error(`Debugger disconnected before completion: ${code} ${reason}`); process.exitCode = 1; }
  });
})().catch(error => { console.error(error.message); process.exitCode = 1; });
