#!/usr/bin/env node
// Stage a #321 "old cut" chapter for device verification: rewrite one chapter's
// prepared texts and memberships to an older sentence cut, clone audio for the
// old Speech Texts from an existing Clip, drop this Voice's current-cut rows,
// and record older catalogue revisions — the pre-fix owner state — so the next
// launch runs prepareAgain (checks kept) and the Recheck finds the holes.
//
//   node recheck-stage-321.cjs CONTAINER DOCUMENT_KEY VOICE_KEY spec.json
//
// CONTAINER is the app data container of the TARGET simulator
// (`xcrun simctl get_app_container UDID top.xujialiu.openreader data`), from
// which this script resolves that one simulator's UDID; it checks the app on
// THAT simulator only, and refuses — without touching or advising about any
// other device or session — unless the target can be validated and its app is
// not running. DOCUMENT_KEY / VOICE_KEY are the digests already in the
// catalogue rows (`SELECT DISTINCT document FROM clips` / `… voice …`).
// spec.json:
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
// The script backs the catalogue up beside itself first and writes one
// transaction. Memberships are shared across Voices: staging one Voice's clips
// leaves the other Voice complete, which is how the per-Voice isolation is
// shown at the Recheck. Snapshot the fake's journal (`grep -c 'text='
// fake.log`) before the relaunch — the whole revision change and Recheck must
// add zero lines.
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const crypto = require('node:crypto');

const speechKey = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/** The simulator UDID a container path belongs to: `…/Devices/<UDID>/data/…`.
 * Returns null when the path does not name a CoreSimulator device. */
function resolveDeviceFromContainer(container) {
  const match = String(container).match(/[/\\]Library[/\\]Developer[/\\]CoreSimulator[/\\]Devices[/\\]([0-9A-Fa-f-]{36})[/\\]/);
  return match ? match[1] : null;
}

/** Whether the target simulator's OpenReader is running, or null when the
 * check cannot be answered (device unknown/offline) — callers must fail closed
 * on null. Reads only that UDID's launchd. */
function targetAppIsRunning(udid) {
  const probe = spawnSync('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return null;
  return /(?:^|\t|:)top\.xujialiu\.openreader(\[|\t|$)/m.test(probe.stdout);
}

/** The one transaction's SQL for the staged old cut. */
/** @param {{documentKey: string, voiceKey: string, chapter: string, texts: string[],
 *   dropKeys?: string[], revisions?: Record<string,string>, dropRevisions?: string[],
 *   modelJson: {format: string, size: number, sampleRate?: number}}} params */
function buildStageSql({ documentKey, voiceKey, chapter, texts, dropKeys, revisions, dropRevisions, modelJson }) {
  const q = (s) => String(s).replace(/'/g, "''");
  const rows = [
    `UPDATE chapters SET texts='${q(JSON.stringify(texts))}', text_count=${texts.length} WHERE document='${documentKey}' AND id='${chapter}';`,
    `DELETE FROM memberships WHERE document='${documentKey}' AND chapter='${chapter}';`,
    ...texts.map((text, ordinal) =>
      `INSERT INTO memberships VALUES('${documentKey}','${chapter}',${ordinal},'${speechKey(text)}');`),
    ...(dropKeys ?? []).flatMap((k) => [
      `DELETE FROM clips WHERE document='${documentKey}' AND voice='${voiceKey}' AND key='${k}';`,
      `DELETE FROM writes WHERE document='${documentKey}' AND voice='${voiceKey}' AND key='${k}';`,
    ]),
    ...texts.map((text) => {
      const k = speechKey(text);
      const metadata = JSON.stringify({
        document: documentKey, voice: voiceKey, key: k, path: `${k}.m4a`,
        format: modelJson.format, size: modelJson.size, sampleRate: modelJson.sampleRate,
      });
      return `INSERT OR REPLACE INTO clips(document,voice,key,path,size,metadata,state) VALUES('${documentKey}','${voiceKey}','${k}','${k}.m4a',${modelJson.size},'${q(metadata)}','ready');`;
    }),
    ...Object.entries(revisions ?? {}).map(([name, value]) => `INSERT OR REPLACE INTO state VALUES('${name}','${value}');`),
    ...(dropRevisions ?? []).map((name) => `DELETE FROM state WHERE name='${name}';`),
  ];
  return `BEGIN;\n${rows.join('\n')}\nCOMMIT;`;
}

/** A fresh sidecar for the cloned clip: identity rewritten to the NEW
 * document/voice/key/path, every other field (timestamps, format, size)
 * carried over from the model's sidecar. */
function cloneSidecarIdentity(modelSidecar, { documentKey, voiceKey, key }) {
  const fresh = { ...modelSidecar };
  if ('document' in fresh || modelSidecar.document !== undefined) fresh.document = documentKey;
  if ('voice' in fresh || modelSidecar.voice !== undefined) fresh.voice = voiceKey;
  fresh.key = key;
  fresh.path = `${key}.m4a`;
  return fresh;
}

/** Clone the model payload once per old text and write a fresh identity sidecar. */
function stageAudioFiles({ audioDir, documentKey, voiceKey, texts, modelPath }) {
  if (!existsSync(modelPath)) { console.error(`no model clip: ${modelPath}`); process.exit(1); }
  const modelJson = JSON.parse(readFileSync(modelPath.replace(/\.m4a$/, '.json'), 'utf8'));
  const sidecarPath = modelPath.replace(/\.m4a$/, '.json');
  const sidecar = existsSync(sidecarPath) ? JSON.parse(readFileSync(sidecarPath, 'utf8')) : {};
  for (const text of texts) {
    const k = speechKey(text);
    copyFileSync(modelPath, join(audioDir, `${k}.m4a`));
    // Identity comes from the file's address; the sidecar must not carry the
    // model's identity fields, and its size must match the copied payload.
    const fresh = cloneSidecarIdentity(sidecar, { documentKey, voiceKey, key: k });
    writeFileSync(join(audioDir, `${k}.json`), JSON.stringify(fresh));
  }
  return modelJson;
}

module.exports = { resolveDeviceFromContainer, targetAppIsRunning, buildStageSql, cloneSidecarIdentity, stageAudioFiles, speechKey };

function main() {
const [container, documentKey, voiceKey, specPath] = process.argv.slice(2);
if (!container || !documentKey || !voiceKey || !specPath) {
  console.error('Usage: recheck-stage-321.cjs CONTAINER DOCUMENT_KEY VOICE_KEY spec.json');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const udid = resolveDeviceFromContainer(container);
if (!udid) {
  console.error(`FAIL CLOSED: the container path does not name a CoreSimulator device: ${container}`);
  process.exit(1);
}
const listed = spawnSync('xcrun', ['simctl', 'list', 'devices'], { encoding: 'utf8' });
if (listed.error || listed.status !== 0 || !listed.stdout.includes(udid)) {
  console.error(`FAIL CLOSED: simulator ${udid} (from the container path) is not a known device on this Mac; refusing without writing.`);
  process.exit(1);
}
const running = targetAppIsRunning(udid);
if (running === null) {
  console.error(`FAIL CLOSED: could not read simulator ${udid}'s runtime state; refusing without writing.`);
  process.exit(1);
}
if (running) {
  console.error(`The target simulator ${udid} has OpenReader running; terminate it on THAT simulator — the catalogue must be quiescent.`);
  process.exit(1);
}

const root = join(container, 'Documents/offline-narration-v2');
const audioDir = join(root, documentKey, voiceKey);
const catalogue = join(root, 'catalog.sqlite');
const modelJson = stageAudioFiles({ audioDir, documentKey, voiceKey, texts: spec.texts, modelPath: join(audioDir, spec.modelClip) });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
copyFileSync(catalogue, `${catalogue}.backup-${stamp}`);
for (const suffix of ['-wal', '-shm'])
  if (existsSync(catalogue + suffix)) copyFileSync(catalogue + suffix, `${catalogue}.backup-${stamp}${suffix}`);
console.log(`backup: ${catalogue}.backup-${stamp}`);

execFileSync('sqlite3', [catalogue], {
  input: buildStageSql({ documentKey, voiceKey, chapter: spec.chapter, texts: spec.texts, dropKeys: spec.dropKeys, revisions: spec.revisions, dropRevisions: spec.dropRevisions, modelJson }),
  stdio: 'inherit',
});
console.log('staged. Before relaunch: snapshot the fake journal; after the launch and its'
  + ' Recheck: the delta must be zero, and `[offline] Recheck <doc> <chapter>: <voice> k / n;'
  + ' needs Download selected` names every chapter that lost its check.');
}
if (require.main === module) main();
