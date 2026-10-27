#!/usr/bin/env node
// #331: the first Document opening, not only the collapse/reopen cycles of
// player-opening.cjs. Run inside kit/ios_guard.py; see tap-lock-and-sleep-timer.md.
// Closes the reader with the walkthrough harness's own `shut` (navigation
// back to the Library), records the native screen while `open` re-enters the
// Document, and measures with player-opening-measure.py. Never plays audio.
// Same shape prerequisites as player-opening.cjs: a 402x874-point, 3x
// simulator at default text size, dark Theme, an open Document with the Player
// expanded, paused, without notes, Sleep Timer off. Output: nonzero on a
// displaced or missing moon while the lock is visible, or on any navigation
// failure. This is the app's own navigation, not a physical-touch test.
//
//   OPENREADER_METRO=http://127.0.0.1:PORT OPENREADER_DEVICE='NAME' \
//     node player-first-open.cjs SIMULATOR_UDID OUTPUT_DIR sha256:DOCUMENT_ID
const fs = require('node:fs');
const {spawn, spawnSync} = require('node:child_process');
const path = require('node:path');
const WebSocket = require('ws');
const [sim, directory, documentId] = process.argv.slice(2);
if (!sim || !directory || !documentId || !documentId.startsWith('sha256:')) {
 console.error('Usage: player-first-open.cjs SIMULATOR_UDID OUTPUT_DIR sha256:DOCUMENT_ID');
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
 // The harness file's seq is carried; write atomically (README Pitfalls).
 const data=spawnSync('xcrun',['simctl','get_app_container',sim,'top.xujialiu.openreader','data'],{encoding:'utf8'}).stdout.trim();
 const harness=path.join(data,'Documents','harness.json');
 const send=command=>{
   let seq=0; try{seq=Number(JSON.parse(fs.readFileSync(harness,'utf8')).seq)||0}catch{}
   const body={seq:seq+1,...command};
   const tmp=`${harness}.tmp-first-open`;
   fs.writeFileSync(tmp,JSON.stringify(body));
   fs.renameSync(tmp,harness);
   console.log('harness <-',JSON.stringify(body));
 };
 const playerGone=async()=>ev(`(()=>{try{__timer331Player();return false}catch(e){return true}})()`);
 const playerOpen=async()=>ev(`(()=>{try{return !__timer331Player().collapsed}catch(e){return false}})()`);
 send({do:'shut'});
 let gone=false;
 for(let i=0;i<60 && !gone;i++){ await sleep(250); gone=await playerGone(); }
 if(!gone) throw new Error('The reader did not close');
 await sleep(2000);
 console.log('Recording the Document opening');
 rec=spawn('xcrun',['simctl','io',sim,'recordVideo','--codec=h264','--force',output],{stdio:['ignore','ignore','pipe']});
 rec.stderr.on('data', b=>process.stderr.write(b));
 await sleep(600);
 send({do:'open',id:documentId});
 let back=false;
 for(let i=0;i<120 && !back;i++){ await sleep(250); back=await playerOpen(); }
 if(!back) throw new Error('The Document did not reopen with an expanded Player');
 await sleep(1500);
 } finally {
 if(rec){const done=new Promise(r=>rec.once('exit',r));rec.kill('SIGINT');await done;}
 await ev('delete globalThis.__timer331Player').catch(()=>{}); ws.close();
 }
 const frames=path.join(directory,'frames','%04d.png');
 const extracted=spawnSync('ffmpeg',['-v','error','-i',output,'-vf','fps=60',frames],{stdio:'inherit',timeout:15000});
 if(extracted.status!==0) throw new Error('Frame extraction failed');
 const measured=spawnSync('python3',[require.resolve('./player-opening-measure.py'),path.join(directory,'frames','*.png')],{stdio:'inherit',timeout:15000});
 if(measured.status!==0 && measured.status!==1) throw new Error('Frame measurement did not complete');
 process.exitCode=measured.status;
})().catch(e=>{console.error(e);process.exitCode=2});
