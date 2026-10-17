#!/usr/bin/env node
// Real app handlers/runtime/catalogue over CDP, NOT touch or audio-fidelity QA.
// Requires the local fixture server, selected Voice and actual Consent first.
// Run under ios_guard.py; every failed prerequisite aborts the remaining cases.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function assertPreflight(s, document) {
  assert(s.document === document && s.provider === 'compatible' && s.voice && s.endpoint && s.consent &&
    s.access === 'unlocked' && !s.playing && s.enabled && !s.busyDownloads,
  'BLOCKED: require the intended Document, local endpoint, selected Voice, actual Consent, Unlock and paused work');
}
function assertControl(before, after, s) {
  assert(after > before && s.playing && !s.buffering, 'BLOCKED: normal playback did not send a fresh request and leave buffering');
}
function assertRetries(requests) {
  const counts = new Map();
  for (const r of requests) counts.set(r.text, (counts.get(r.text) ?? 0) + 1);
  assert(counts.size && [...counts.values()].some(n => n === 3) && [...counts.values()].every(n => n <= 3),
    'Expected bounded retries of the same speech text, at most three requests');
}
function countSaved(inventory, key) {
  assert(typeof key === 'string' && Array.isArray(inventory) && inventory.every(row => typeof row.voice === 'string' && Number.isSafeInteger(row.count) && row.count >= 0), 'Unexpected repository inventory schema');
  return inventory.filter(row => row.voice === key).reduce((n,row) => n + row.count, 0);
}
module.exports = { assertPreflight, assertControl, assertRetries, countSaved };

async function main() {
  const args = process.argv.slice(2);
  const preflightAt = args.indexOf('--preflight-only');
  const preflightOnly = preflightAt >= 0;
  if (preflightOnly) args.splice(preflightAt, 1);
  const finishAt = args.indexOf('--finish-saved-run');
  const savedPrefix = finishAt >= 0 ? args.splice(finishAt, 2)[1] : null;
  if (finishAt >= 0) assert(/^fixture-check-[a-z0-9]+$/.test(savedPrefix ?? ''), 'A recorded fixture run prefix is required');
  const [device, readingId, downloadId, output, server = 'http://127.0.0.1:8765'] = args;
  assert(device && readingId && downloadId && output && readingId !== downloadId,
    'Usage: provider-app-check.cjs UDID READING_DOCUMENT_ID DOWNLOAD_DOCUMENT_ID OUTPUT [LOCAL_SERVER]');
  assert(new URL(server).hostname === '127.0.0.1', 'Only the authorized loopback fixture server is allowed');
  const kit = path.dirname(require.resolve('../kit/cdp.cjs'));
  fs.mkdirSync(output, { recursive: true });
  let serial = 0;
  const results = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const run = (program, args) => execFileSync(program, args, { encoding: 'utf8', timeout: 12_000 });
  function evaluate(expression) {
    const file = path.join(output, `eval-${++serial}.js`);
    fs.writeFileSync(file, expression);
    return JSON.parse(run(process.execPath, [path.join(kit, 'cdp.cjs'), '--eval', file])).value;
  }
  async function until(check, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await check(); if (value) return value; await sleep(150); }
    throw Error(`Condition not established within ${timeout}ms; no subsequent scenario will run`);
  }
  const http = async route => {
    const response = await fetch(server + route, { signal: AbortSignal.timeout(3000) });
    assert(response.ok, `Fixture HTTP ${response.status}`);
    return response.json();
  };
  const mode = speech => http('/__mode?speech=' + speech + '&voices=ok');
  const requests = () => http('/__speech');
  function record(name, facts) {
    const item = { name, ...facts };
    results.push(item);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(item));
  }
  const snapshot = () => evaluate('__providerCheck.snapshot()');
  const pause = () => evaluate('__providerCheck.pause(); true');
  function play() {
    run('bash', [path.join(kit, 'silence.sh'), 'check', device]);
    evaluate(`(() => { const b=__providerCheck; clearTimeout(b.timer); b.player().onPlay(); b.timer=setTimeout(()=>b.player().onPause(),5000); return true; })()`);
  }
  async function voice(id) {
    pause();
    run(process.execPath, [path.join(kit, 'hx.cjs'), device, JSON.stringify({ do: 'voice', provider: 'compatible', voice: id })]);
    await until(() => snapshot().voice === id);
  }
  async function appPromise(expression) {
    evaluate(`(() => { const job={done:false}; __providerCheck.job=job; Promise.resolve().then(()=>(${expression})).then(value=>Object.assign(job,{done:true,value}),error=>Object.assign(job,{done:true,error:String(error)})); return true; })()`);
    const job = await until(() => { const j=evaluate('__providerCheck.job'); return j.done && j; });
    assert(!job.error, job.error);
    return job.value;
  }
  const expected = JSON.stringify({ readingId, downloadId, server });
  evaluate(`(() => {
    const expected=${expected};
    function mod(name) { let found; __r.getModules().forEach((m,id)=>{if(m.verboseName===name)found=__r(id);}); if(!found)throw Error(name); return found; }
    function find(name) { let found; function walk(f){if(!f)return;if(f.type?.name===name)found=f.memoizedProps;walk(f.child);walk(f.sibling);} const h=__REACT_DEVTOOLS_GLOBAL_HOOK__; for(const id of h.renderers.keys())for(const root of h.getFiberRoots(id))walk(root.current); if(!found)throw Error('Missing '+name);return found; }
    const b={r:mod('src/offline/runtime.ts'), db:mod('src/offline/database.ts'), voiceKey:mod('src/offline/catalog-keys.ts').voiceKey, lists:mod('src/app/use-voices.ts').voiceLists, player:()=>find('Player'), timers:[], voices:[]};
    b.pause=()=>{clearTimeout(b.timer);b.player().onPause();};
    b.snapshot=()=>{const p=b.player(),v=find('ReadingView'),key=mod('src/app/consent.ts').providerRecipient(p.settings,'compatible',false).key;return {
      document:v.document.identity.id,provider:p.settings.provider,voice:p.settings.voice,endpoint:p.settings.compatible.baseURL===expected.server,
      consent:p.settings.consent.includes(key),access:mod('src/app/purchase.ts').purchases.access().kind,playing:p.playing,buffering:!!p.buffering,enabled:p.enabled,
      notes:(p.notes||[]).map(n=>typeof n==='string'?n:n.said).join(' | '),
      busyDownloads:[...b.r.downloadTasks(expected.readingId),...b.r.downloadTasks(expected.downloadId)].some(t=>b.r.goesOn(t))};};
    b.stopDownloads=()=>b.r.downloadTasks(expected.downloadId).filter(t=>b.voices.includes(t.voice.voice)&&b.r.goesOn(t)).forEach(t=>b.r.toggleTask(t));
    globalThis.__providerCheck=b; return true;
  })()`);
  let accepted = false;
  let originalVoice;
  try {
    const initial = snapshot();
    assertPreflight(initial, readingId);
    originalVoice = initial.voice;
    record('preflight', initial);
    if (preflightOnly) return;
    const readingVoice = savedPrefix ?? ('fixture-check-' + Date.now().toString(36));
    if (!savedPrefix) {
      await voice(readingVoice);
      await mode('ok-pcm');
      const before = (await requests()).length;
      play();
      const control = await until(async () => {
        const s=snapshot(), n=(await requests()).length;
        return n>before && s.playing && !s.buffering && {s,n};
      });
      assertControl(before, control.n, control.s);
      pause();
      record('normal-reading-control', { posts: control.n-before, playing: control.s.playing, buffering: control.s.buffering });

      // Fresh Voice for fault cases; errors must never enter either Clip cache.
      await voice(readingVoice + '-fault');
      for (const [name, message] of [['cut', 'connection'], ['json-error', 'Insufficient balance'], ['html-error', 'text/html'], ['text-error', 'text/plain']]) {
        await mode(name);
        const mark = (await requests()).length, started = Date.now();
        play();
        const state = await until(async () => {
          const s=snapshot();
          return (await requests()).length>mark && !s.playing && s.notes.includes(message) && s;
        });
        pause();
        record('reading-' + name, { ms: Date.now()-started, posts: (await requests()).length-mark, note: state.notes });
      }
      await mode('ok-wav');
      const recoveryBefore = (await requests()).length;
      play();
      await until(async () => {const s=snapshot(); return (await requests()).length>recoveryBefore && s.playing && !s.buffering;});
      pause();
      record('reading-wav-recovery', { freshPosts: (await requests()).length-recoveryBefore });

    }

    evaluate(`__providerCheck.r.requestPlan(${JSON.stringify(downloadId)}, 'Boundary Fixture'); true`);
    const chapter = await until(() => evaluate(`__providerCheck.r.planOf(${JSON.stringify(downloadId)})?.chapters[0]?.id`));
    async function downloadCase(name, id, shouldSave) {
      await mode(name);
      const mark = (await requests()).length, started = Date.now();
      const args = JSON.stringify({ document: downloadId, voice: { provider: 'compatible', voice: id, label: id }, chapters: [chapter] });
      evaluate(`(() => { const b=__providerCheck,a=${args}; b.voices.push(a.voice.voice); b.r.enqueue(a.document,a.voice,a.chapters); b.timers.push(setTimeout(()=>{ const t=b.r.downloadTasks(a.document).find(t=>t.voice.voice===a.voice.voice); if(t&&b.r.goesOn(t))b.r.toggleTask(t); },15000)); return true; })()`);
      const task = await until(() => evaluate(`(() => { const t=__providerCheck.r.downloadTasks(${JSON.stringify(downloadId)}).find(t=>t.voice.voice===${JSON.stringify(id)});return t&&['done','blocked','paused'].includes(t.state)?{state:t.state,error:t.error,failed:t.failed}:null;})()`), 14000);
      evaluate('__providerCheck.timers.forEach(clearTimeout); true');
      const sent = (await requests()).slice(mark).filter(r => r.voice === id);
      assert(sent.length > 0, 'No request reached the fixture; this is not a Download test');
      const inventory = await appPromise(`__providerCheck.db.offlineRepository().then(r=>r.inventory(${JSON.stringify(downloadId)}))`);
      const key = evaluate(`__providerCheck.voiceKey({provider:"compatible",voice:${JSON.stringify(id)}})`);
      const saved = countSaved(inventory, key);
      if (shouldSave) assert(task.state === 'done' && task.failed.length === 0 && saved > 0, 'Valid recovery was not saved');
      else assert(task.state === 'done' && task.failed.length > 0 && saved === 0, 'Failed response was saved or did not finish as a failed chapter');
      if (name === 'cut') assertRetries(sent);
      if (name.endsWith('-error')) assert(new Set(sent.map(r=>r.text)).size === sent.length, 'A non-retriable error was retried');
      record('download-' + name, { ms:Date.now()-started, posts:sent.length, saved, task });
    }
    const jsonVoice = readingVoice + '-download-json';
    if (!savedPrefix) {
      await downloadCase('cut', readingVoice + '-download-cut', false);
      await downloadCase('json-error', jsonVoice, false);
      await downloadCase('html-error', readingVoice + '-download-html', false);
      await downloadCase('text-error', readingVoice + '-download-text', false);
      await downloadCase('ok-pcm', jsonVoice, true);
    } else {
      // Recheck existing evidence with the corrected inventory schema. Do not
      // resynthesize cases already run, especially the successful PCM recovery.
      const inventory = await appPromise(`__providerCheck.db.offlineRepository().then(r=>r.inventory(${JSON.stringify(downloadId)}))`);
      const history = await requests();
      const key = id => evaluate(`__providerCheck.voiceKey({provider:"compatible",voice:${JSON.stringify(id)}})`);
      const task = id => evaluate(`(() => {const t=__providerCheck.r.downloadTasks(${JSON.stringify(downloadId)}).find(t=>t.voice.voice===${JSON.stringify(id)});return t&&{state:t.state,failed:t.failed};})()`);
      for (const [name, suffix] of [['cut', 'cut'], ['html-error', 'html'], ['text-error', 'text']]) {
        const id = readingVoice + '-download-' + suffix;
        const sent = history.filter(r => r.voice === id && r.mode === name);
        const current = task(id), saved = countSaved(inventory, key(id));
        assert(sent.length && current?.state === 'done' && current.failed.length && saved === 0, 'Recorded failed Download is not empty');
        if (name === 'cut') assertRetries(sent);
        record('rechecked-download-' + name, { posts: sent.length, saved, task: current });
      }
      const refused = history.filter(r => r.voice === jsonVoice && r.mode === 'json-error');
      const recovered = history.filter(r => r.voice === jsonVoice && r.mode === 'ok-pcm');
      assert(refused.length && refused.every(bad => recovered.some(good => good.text === bad.text && good.at > bad.at)),
        'Same-text fresh requests must prove the JSON error was not reused as saved audio');
      const current = task(jsonVoice), saved = countSaved(inventory, key(jsonVoice));
      assert(current?.state === 'done' && current.failed.length === 0 && saved === new Set(recovered.map(r=>r.text)).size && saved > 0,
        'The recorded PCM recovery is not complete');
      const readable = await appPromise(`__providerCheck.db.offlineRepository().then(async r=>{const c=await r.chapter(${JSON.stringify(downloadId)},${JSON.stringify(chapter)});const clips=await Promise.all(c.texts.map(text=>r.readClip(${JSON.stringify(downloadId)},{provider:"compatible",voice:${JSON.stringify(jsonVoice)},label:${JSON.stringify(jsonVoice)}},text)));return clips.filter(x=>x.clip!==null).length;})`);
      assert(readable === saved, 'Saved inventory has missing payloads');
      record('rechecked-json-refusal-and-pcm-recovery', { refusedPosts:refused.length, freshRecoveryPosts:recovered.length, saved, readable });
    }
    const wavVoice = readingVoice + '-download-wav';
    const existing = await appPromise(`__providerCheck.db.offlineRepository().then(r=>r.inventory(${JSON.stringify(downloadId)}))`);
    assert(countSaved(existing, evaluate(`__providerCheck.voiceKey({provider:"compatible",voice:${JSON.stringify(wavVoice)}})`)) === 0,
      'WAV case already has saved audio; do not replay completed work');
    await downloadCase('ok-wav', wavVoice, true);
    // The core Drawer touch already has separate evidence. These are the
    // remaining app-loader fallback controls, not additional touch claims.
    try {
      for (const failure of ['404', 'junk']) {
        await http('/__mode?voices=' + failure);
        const list = await appPromise('__providerCheck.lists.load(__providerCheck.player().settings, "compatible")');
        const ids = list.map(v => v.id);
        assert(ids.includes('alloy') && ids.includes('verse') && !ids.includes('fixture-willow'), 'Documented Voice fallback changed');
        record('voice-fallback-' + failure, { ids });
      }
    } finally {
      await http('/__mode?voices=ok');
      await appPromise('__providerCheck.lists.load(__providerCheck.player().settings, "compatible")');
    }
    accepted = true;
  } finally {
    try {
      evaluate('(() => {const b=__providerCheck;b.pause();b.stopDownloads();b.timers.forEach(clearTimeout);return true;})()');
      if (originalVoice) await voice(originalVoice);
      const final = snapshot();
      assert(!final.playing && !final.busyDownloads, 'Paused cleanup not confirmed');
      record('cleanup', { playing: final.playing, voice: final.voice, busyDownloads: final.busyDownloads });
      evaluate('delete globalThis.__providerCheck; true');
    } catch (error) { console.error('Cleanup not confirmed: ' + error.message); process.exitCode=1; }
    await mode('ok-pcm').catch(() => {});
  }
  if (accepted && process.exitCode !== 1) record('acceptance', { verdict: 'PASS', readingId, downloadId });
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
