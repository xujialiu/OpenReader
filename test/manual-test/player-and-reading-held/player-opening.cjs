#!/usr/bin/env node
// #331. Run inside kit/ios_guard.py; see tap-lock-and-sleep-timer.md.
// Requires a 402x874-point, 3x simulator at default text size, dark Theme.
// Uses existing Player handlers, never Play; captures the actual native layout.
// Output: nonzero on a displaced or missing moon while the lock is visible.
// Targeted handler repro on the real native Player, not a physical-tap test.
const fs = require('node:fs');
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const [sim, directory, cyclesArg='3'] = process.argv.slice(2);
if (!sim || !directory || !/^[1-9]$/.test(cyclesArg)) {
 console.error('Usage: player-opening.cjs SIMULATOR_UDID OUTPUT_DIR [CYCLES=3 (1-9)]');
 process.exit(2);
}
fs.mkdirSync(path.join(directory, 'frames'), {recursive:true});
if (fs.readdirSync(path.join(directory, 'frames')).length) {
 console.error('Use a fresh output directory: old frames cannot be verdict evidence');
 process.exit(2);
}
const output=path.join(directory,'open.mp4');
const sleep = ms => new Promise(r=>setTimeout(r, ms));
(async()=>{
 const pages=await fetch(new URL('/json/list', process.env.OPENREADER_METRO ?? 'http://127.0.0.1:8081')).then(r=>r.json());
 const targets=pages.filter(p=>p.appId==='top.xujialiu.openreader' && (!process.env.OPENREADER_DEVICE || p.deviceName===process.env.OPENREADER_DEVICE));
 if(targets.length!==1) throw new Error('Need exactly one debug app');
 const url=new URL(targets[0].webSocketDebuggerUrl);
 const ws=new WebSocket(url.href,{origin:`http://${url.host}`});
 await new Promise((res,rej)=>{ws.once('open',res);ws.once('error',rej)});
 let id=0; const pending=new Map();
 ws.on('message', data=>{const m=JSON.parse(data); if(pending.has(m.id)) pending.get(m.id)(m)});
 const ev=expression=>new Promise((res,rej)=>{
   const n=++id; const timer=setTimeout(()=>{pending.delete(n);rej(new Error('CDP deadline'))},5000);
   pending.set(n,m=>{clearTimeout(timer);pending.delete(n); if(m.error||m.result?.exceptionDetails) rej(new Error(JSON.stringify(m))); else res(m.result.result.value)});
   ws.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
 });
 let rec;
 try {
 await ev(`globalThis.__timer331Player=()=>{let found;function walk(f){if(!f)return;if(f.type?.name==='Player')found=f.memoizedProps;walk(f.child);walk(f.sibling)}const h=__REACT_DEVTOOLS_GLOBAL_HOOK__;for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);if(!found)throw Error('Open a Document');return found}; true`);
 const state=await ev(`({playing:__timer331Player().playing,collapsed:__timer331Player().collapsed,notes:__timer331Player().notes.length,sleep:__timer331Player().sleep.choice})`);
 if(state.playing || state.collapsed || state.notes || state.sleep!==null) throw new Error('Need the open Player, paused, without notes, Sleep Timer off');
 console.log('Initial',JSON.stringify(state));
 rec=spawn('xcrun',['simctl','io',sim,'recordVideo','--codec=h264','--force',output],{stdio:['ignore','ignore','pipe']});
 rec.stderr.on('data', b=>process.stderr.write(b));
 await sleep(600);
 for(let i=0;i<Number(cyclesArg);i++){
   await ev('__timer331Player().onCollapsed(true); true');
   await sleep(500);
   if(!await ev('__timer331Player().collapsed')) throw new Error('Collapse did not land');
   await ev('__timer331Player().onCollapsed(false); true');
   await sleep(1000);
   if(await ev('__timer331Player().collapsed')) throw new Error('Open did not land');
 }
 await sleep(200);
 } finally {
 if(rec){const done=new Promise(r=>rec.once('exit',r));rec.kill('SIGINT');await done;}
 await ev('delete globalThis.__timer331Player').catch(()=>{}); ws.close();
 }
 const frames=path.join(directory,'frames','%04d.png');
 const extracted=spawnSync('ffmpeg',['-v','error','-i',output,'-vf','fps=60',frames],{stdio:'inherit',timeout:15000});
 if(extracted.status!==0) throw new Error('Frame extraction failed');
 // OPENREADER_MEASURE (with OPENREADER_MEASURE_ARGS, space-separated) swaps in
 // another analyser for shapes player-opening-measure.py cannot take — any
 // width or text size (player-jump-check.py). The default is unchanged.
 const measurer=process.env.OPENREADER_MEASURE ?? require.resolve('./player-opening-measure.py');
 const measureArgs=(process.env.OPENREADER_MEASURE_ARGS ?? '').split(' ').filter(Boolean);
 const measured=spawnSync('python3',[measurer,path.join(directory,'frames','*.png'),...measureArgs],{stdio:'inherit',timeout:15000});
 if(measured.status!==0 && measured.status!==1) throw new Error('Frame measurement did not complete');
 process.exitCode=measured.status;
})().catch(e=>{console.error(e);process.exitCode=2});
