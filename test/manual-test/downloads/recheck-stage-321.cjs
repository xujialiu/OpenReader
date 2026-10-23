#!/usr/bin/env node
// Stage a #321 "old cut" chapter for device verification: rewrite one chapter's
// prepared texts and memberships to an older sentence cut, clone audio for the
// old Speech Texts from an existing Clip, drop this Voice's current-cut rows,
// and record older catalogue revisions — the pre-fix owner state — so the next
// launch runs prepareAgain (checks kept) and the Recheck finds the holes.
//
//   node recheck-stage-321.cjs CONTAINER CATALOGUE_DOCUMENT_KEY VOICE_KEY spec.json
//
// CONTAINER is the app data container
// (`xcrun simctl get_app_container UDID top.xujialiu.openreader data`);
// DOCUMENT_KEY / VOICE_KEY are the digests already in the catalogue rows
// (`SELECT DISTINCT document FROM clips` / `… voice …`). spec.json:
//
// {
//   "chapter": "nav.0",
//   "texts": ["分句", "这是第一句。2024年发生了很多事。"],  // the OLD cut, in order
//   "modelClip": "96ae5c11….m4a basename in the Voice directory",  // a ready Clip to clone
//   "dropKeys": ["470bbdad…"],                  // this Voice's current-cut keys to remove
//   "revisions": {"walk": "1"},                 // older state rows to record
//   "dropRevisions": ["segmentation"]           // missing = older rules
// }
//
// The app MUST be terminated; the script refuses a running one, backs the
// catalogue up beside itself first, and writes one transaction. Memberships are
// shared across Voices: staging one Voice's clips leaves the other Voice
// complete, which is how the per-Voice isolation is shown at the Recheck.
// Snapshot the fake's journal (`grep -c 'text=' fake.log`) before the relaunch —
// the whole revision change and Recheck must add zero lines.
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const crypto = require('node:crypto');

const [container, documentKey, voiceKey, specPath] = process.argv.slice(2);
if (!container || !documentKey || !voiceKey || !specPath) {
  console.error('Usage: recheck-stage-321.cjs CONTAINER DOCUMENT_KEY VOICE_KEY spec.json');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const root = join(container, 'Documents/offline-narration-v2');
const audioDir = join(root, documentKey, voiceKey);
const catalogue = join(root, 'catalog.sqlite');
const key = (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

const devices = spawnSync('xcrun', ['simctl', 'list', 'devices'], { encoding: 'utf8' }).stdout;
if (/\(Booted\)/.test(devices)) {
  const running = spawnSync('bash', ['-c',
    "ps ax -o command | grep 'CoreSimulator/Devices/.*/Containers/Bundle/Application/.*/OpenReader.app/OpenReader' | grep -v grep | wc -l"],
    { encoding: 'utf8' }).stdout.trim();
  if (Number(running) > 0) {
    console.error(`An OpenReader process is running (${running}); terminate it — the catalogue must be quiescent.`);
    process.exit(1);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
copyFileSync(catalogue, `${catalogue}.backup-${stamp}`);
for (const suffix of ['-wal', '-shm'])
  if (existsSync(catalogue + suffix)) copyFileSync(catalogue + suffix, `${catalogue}.backup-${stamp}${suffix}`);
console.log(`backup: ${catalogue}.backup-${stamp}`);

const model = join(audioDir, spec.modelClip);
if (!existsSync(model)) { console.error(`no model clip: ${model}`); process.exit(1); }
const modelJson = JSON.parse(readFileSync(model.replace(/\.m4a$/, '.json'), 'utf8'));
for (const text of spec.texts) {
  const k = key(text);
  copyFileSync(model, join(audioDir, `${k}.m4a`));
  copyFileSync(model.replace(/\.m4a$/, '.json'), join(audioDir, `${k}.json`));
}

const q = (s) => String(s).replace(/'/g, "''");
const rows = [
  `UPDATE chapters SET texts='${q(JSON.stringify(spec.texts))}', text_count=${spec.texts.length} WHERE document='${documentKey}' AND id='${spec.chapter}';`,
  `DELETE FROM memberships WHERE document='${documentKey}' AND chapter='${spec.chapter}';`,
  ...spec.texts.map((text, ordinal) =>
    `INSERT INTO memberships VALUES('${documentKey}','${spec.chapter}',${ordinal},'${key(text)}');`),
  ...(spec.dropKeys ?? []).flatMap((k) => [
    `DELETE FROM clips WHERE document='${documentKey}' AND voice='${voiceKey}' AND key='${k}';`,
    `DELETE FROM writes WHERE document='${documentKey}' AND voice='${voiceKey}' AND key='${k}';`,
  ]),
  ...spec.texts.map((text) => {
    const k = key(text);
    const metadata = JSON.stringify({
      document: documentKey, voice: voiceKey, key: k, path: `${k}.m4a`,
      format: modelJson.format, size: modelJson.size, sampleRate: modelJson.sampleRate,
    });
    return `INSERT OR REPLACE INTO clips(document,voice,key,path,size,metadata,state) VALUES('${documentKey}','${voiceKey}','${k}','${k}.m4a',${modelJson.size},'${q(metadata)}','ready');`;
  }),
  ...Object.entries(spec.revisions ?? {}).map(([name, value]) => `INSERT OR REPLACE INTO state VALUES('${name}','${value}');`),
  ...(spec.dropRevisions ?? []).map((name) => `DELETE FROM state WHERE name='${name}';`),
];
execFileSync('sqlite3', [catalogue], { input: `BEGIN;\n${rows.join('\n')}\nCOMMIT;`, stdio: 'inherit' });
console.log('staged. Before relaunch: snapshot the fake journal; after the launch and its'
  + ' Recheck: the delta must be zero, and `[offline] Recheck <doc> <chapter>: <voice> k / n;'
  + ' needs Download selected` names every chapter that lost its check.');
