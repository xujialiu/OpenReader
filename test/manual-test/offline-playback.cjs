#!/usr/bin/env node
// A persisted-download probe: restart the app first to empty all audio memory.
// Network requests are rejected and the selected provider is disabled temporarily.
// Real saved provider audio and its timings pass through the native decoder/clock.
const { execFileSync, execFile } = require('node:child_process');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
if (execFileSync('osascript', ['-e', 'output volume of (get volume settings)'], { encoding: 'utf8' }).trim() !== '0') throw Error('Mute host output first');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
// Overridable so a worktree whose Library was seeded with a differently-built
// copy of the fixture (a different manifest digest, same title/chapters) can
// still run this probe. Defaults to the id this file has always used.
const documentId = process.env.OPENREADER_DOCUMENT_ID || 'sha256:11a1ed5406589e23630c8ebba777e46e207342bfcdeb206c28aee732edefdd2d';
(async () => {
  const output = mkdtempSync(join(tmpdir(), 'openreader-offline-probe-'));
  let serial = 0;
  const evaluate = expression => new Promise((resolve, reject) => {
    const file = join(output, `${++serial}.js`);
    writeFileSync(file, expression);
    execFile(process.execPath, ['test/manual-test/cdp.cjs', '--eval', file], { timeout: 12000 }, (error, stdout, stderr) => {
      if (error) reject(Error(stderr || error.message));
      else { try { resolve(JSON.parse(stdout).value); } catch (e) { reject(e); } }
    });
  });
  try {
    await evaluate('true');
    console.log('Debugger connected; installing offline probe');
    await evaluate(`(() => {
      const module = name => { for (const [id,m] of __r.getModules()) if (m.verboseName === name) return __r(id); throw Error(name); };
      const fiber = predicate => {
        let found; function walk(f) { if(!f)return; if(predicate(f)) found=f; walk(f.child);walk(f.sibling); }
        for(const id of __REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.keys())for(const root of __REACT_DEVTOOLS_GLOBAL_HOOK__.getFiberRoots(id))walk(root.current);
        return found;
      };
      const props = name => fiber(f=>f.type?.name===name)?.memoizedProps;
      const shell = () => fiber(f=>f.memoizedProps?.value?.library && f.memoizedProps?.value?.setSettings)?.memoizedProps.value;
      const Base = module('node_modules/react-native-audio-api/src/core/BaseAudioContext.ts').default;
      const create = Base.prototype.createBufferQueueSource;
      const realFetch = globalThis.fetch;
      const original = shell().settings.enabledProviders;
      const state = { requests:0, gains:[], original, restore() {
        props('Player')?.onPause(); clearTimeout(this.watchdog);
        globalThis.fetch=realFetch; Base.prototype.createBufferQueueSource=create;
        shell().setSettings(s=>({...s,enabledProviders:original}));
      }, props, shell, fiber };
      globalThis.__offlineProbe=state;
      Base.prototype.createBufferQueueSource=function(...args) {
        const node=create.apply(this,args), gain=this.createGain(); gain.gain.value=0;
        state.gains.push(gain); gain.connect(this.destination);
        const connect=node.connect.bind(node), disconnect=node.disconnect.bind(node);
        node.connect=destination=>connect(destination===this.destination ? gain : destination);
        node.disconnect=destination=>disconnect(destination===this.destination ? gain : destination);
        return node;
      };
      globalThis.fetch=()=>{state.requests++;return Promise.reject(new TypeError('Offline test: network disabled'));};
      props('ReaderActions')?.onClose();
      module('src/app/routes.ts').navigationRef.navigate('Reader',{id:${JSON.stringify(documentId)}});
      shell().setSettings(s=>({...s,enabledProviders:s.enabledProviders.filter(id=>id!=='fish')}));
      return true;
    })()`);
    console.log('Offline probe installed');
    let ready = false;
    for (let i = 0; i < 100; i++) {
      ready = await evaluate(`(() => {
        let known=0;for(let h=__offlineProbe.fiber(f=>f.type?.name==='ReadingView')?.memoizedState;h;h=h.next)
          if(typeof h.memoizedState?.known==='number')known=h.memoizedState.known;
        return !!__offlineProbe.props('Player')?.enabled && known>0;
      })()`);
      if (ready) break;
      await delay(100);
    }
    if (!ready) throw Error('Saved narration was not playable with the provider disabled');
    const started = Date.now();
    await evaluate(`(() => { const p=__offlineProbe.props('Player'); p.onPlay(); __offlineProbe.watchdog=setTimeout(()=>__offlineProbe.props('Player')?.onPause(),5000); return true; })()`);
    let result;
    for (let i = 0; i < 40; i++) {
      await delay(100);
      result = await evaluate(`(() => {
        const values=[];for(let h=__offlineProbe.fiber(f=>f.type?.name==='ReadingView')?.memoizedState;h;h=h.next)values.push(h.memoizedState);
        const engine=values.find(v=>v?.current?.snapshot)?.current;
        const status=values.find(v=>v&&typeof v.known==='number'&&'buffering' in v);
        return {snapshot:engine?.snapshot(),level:status?.level,requests:__offlineProbe.requests,
          muted:__offlineProbe.gains.length>0&&__offlineProbe.gains.every(g=>g.gain.value===0),notes:__offlineProbe.props('Player')?.notes};
      })()`);
      if (result?.snapshot?.playing && result.snapshot.queued > 0 && result.level === 'word') break;
    }
    await evaluate(`__offlineProbe.props('Player').onPause(); true`);
    const milliseconds = Date.now() - started;
    if (!result?.snapshot?.playing || !result.snapshot.queued || result.level !== 'word' || result.requests !== 0 || !result.muted) throw Error(JSON.stringify(result));
    console.log(JSON.stringify({ ...result, milliseconds, established:'Persisted audio decoded and played with word timings, provider disabled and zero network calls; output gain zero before Play' }));
  } finally {
    await evaluate(`globalThis.__offlineProbe?.restore(); delete globalThis.__offlineProbe; true`).catch(error => console.error('Cleanup failed; stop playback:',error.message));
  }
})().catch(error => { console.error(error.message); process.exitCode=1; });
