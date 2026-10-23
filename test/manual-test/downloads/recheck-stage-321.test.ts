import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildStageSql, cloneSidecarIdentity, resolveDeviceFromContainer, speechKey, stageAudioFiles } from '../../manual-test/downloads/recheck-stage-321.cjs';

// Targeted host checks for the #321 staging helper: the SQL it writes, the
// sidecar identity it clones, and the container→device resolution it fails
// closed on. Not a rerun of the accepted runtime cases; no simulator involved.
const DOC = 'b3dc3a7976c41ba22596eb6b09e059bb9438b9db449ed0ee70b18a58d096269a';
const VOICE = 'da522836e95505213331428674e534e3bb20b831b73feee5609e0c12292e1b32';
const MODEL = { format: 'alac', size: 12577, timestamps: [{ start: 0, end: 2.25, charStart: 0, charEnd: 2 }], sampleRate: 24000 };

describe('recheck-stage-321', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  it('resolves the device UDID from a container path and null on anything else', () => {
    const udid = '85DF490D-2213-41FE-9EEA-7851B66357B6';
    expect(resolveDeviceFromContainer(`/Users/x/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Data/Application/ABC/Documents`)).toBe(udid.toLowerCase() === udid ? udid : udid);
    expect(resolveDeviceFromContainer('/tmp/or321-ios-01')).toBeNull();
    expect(resolveDeviceFromContainer('')).toBeNull();
    expect(resolveDeviceFromContainer('/Library/Developer/CoreSimulator/Devices/not-a-udid/data')).toBeNull();
  });

  it('writes the old cut into chapters and memberships, keyed by the Speech Text digest', () => {
    const texts = ['分句', '这是第一句。2024年发生了很多事。'];
    const sql = buildStageSql({ documentKey: DOC, voiceKey: VOICE, chapter: 'nav.0', texts, modelJson: MODEL });
    expect(sql).toContain(`text_count=${texts.length}`);
    expect(sql).toContain(speechKey('这是第一句。2024年发生了很多事。'));
    expect(sql).toContain(`INSERT INTO memberships VALUES('${DOC}','nav.0',1,'${speechKey('这是第一句。2024年发生了很多事。')}')`);
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.endsWith('COMMIT;')).toBe(true);
  });

  it('drops only the named Voice/current keys and records revision rows', () => {
    const sql = buildStageSql({
      documentKey: DOC, voiceKey: VOICE, chapter: 'nav.0', texts: ['分句'], modelJson: MODEL,
      dropKeys: ['470bbdad'], revisions: { walk: '1' }, dropRevisions: ['segmentation'],
    });
    expect(sql).toContain(`DELETE FROM clips WHERE document='${DOC}' AND voice='${VOICE}' AND key='470bbdad'`);
    expect(sql).toContain(`DELETE FROM writes WHERE document='${DOC}' AND voice='${VOICE}' AND key='470bbdad'`);
    expect(sql).toContain("INSERT OR REPLACE INTO state VALUES('walk','1')");
    expect(sql).toContain("DELETE FROM state WHERE name='segmentation'");
  });

  it('escapes quotes so a text cannot break the SQL or the metadata JSON', () => {
    const sql = buildStageSql({ documentKey: DOC, voiceKey: VOICE, chapter: 'nav.0', texts: ["He said 'no'."], modelJson: MODEL });
    expect(sql).toContain('He said \'\'no\'\'.');
    let parsed: unknown;
    expect(() => { parsed = JSON.parse(/INSERT OR REPLACE INTO clips.*?VALUES.*?'(\{.*?\})','ready'\)/.exec(sql)![1].replace(/''/g, "'")); }).not.toThrow();
    expect((parsed as { document: string }).document).toBe(DOC);
  });

  it('gives the cloned sidecar the NEW key/path and never the model identity', () => {
    const k = speechKey('这是第一句。2024年发生了很多事。');
    const fresh = cloneSidecarIdentity(MODEL, { documentKey: DOC, voiceKey: VOICE, key: k });
    expect(fresh.key).toBe(k);
    expect(fresh.path).toBe(`${k}.m4a`);
    expect(fresh.size).toBe(MODEL.size);
    expect(fresh.timestamps).toEqual(MODEL.timestamps);
    expect(JSON.stringify(fresh)).not.toContain('96ae5c11');
    // A sidecar that carries identity fields gets them rewritten, not kept.
    const withIdentity = cloneSidecarIdentity({ ...MODEL, document: 'OLD', voice: 'OLD', key: 'OLD', path: 'OLD.m4a' }, { documentKey: DOC, voiceKey: VOICE, key: k });
    expect(withIdentity.document).toBe(DOC);
    expect(withIdentity.voice).toBe(VOICE);
    expect(withIdentity.key).toBe(k);
    expect(withIdentity.path).toBe(`${k}.m4a`);
  });

  it('applies the SQL to a real SQLite catalogue shaped like the app\u2019s and rewrites the sidecar file', () => {
    dir = mkdtempSync(join(tmpdir(), 'recheck-stage-321-'));
    const root = join(dir, 'Documents/offline-narration-v2');
    const audioDir = join(root, DOC, VOICE);
    mkdirSync(audioDir, { recursive: true });
    const catalogue = join(root, 'catalog.sqlite');
    const modelKey = '96ae5c1137af29f35032fd57eb9ce99d8fa573d1a336da97b8343c2fb1e8c356';
    writeFileSync(join(audioDir, `${modelKey}.m4a`), Buffer.alloc(MODEL.size, 7));
    writeFileSync(join(audioDir, `${modelKey}.json`), JSON.stringify(MODEL));
    execFileSync('sqlite3', [catalogue], {
      input: `CREATE TABLE chapters(document TEXT NOT NULL, id TEXT NOT NULL, ordinal INTEGER NOT NULL, title TEXT NOT NULL, parent TEXT, depth INTEGER NOT NULL, section INTEGER, fragment TEXT, prepared INTEGER NOT NULL, texts TEXT NOT NULL, text_count INTEGER NOT NULL, PRIMARY KEY(document,id));
        CREATE TABLE memberships(document TEXT NOT NULL, chapter TEXT NOT NULL, ordinal INTEGER NOT NULL, clip_key TEXT NOT NULL, PRIMARY KEY(document,chapter,ordinal));
        CREATE TABLE clips(document TEXT NOT NULL, voice TEXT NOT NULL, key TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL, metadata TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ready', PRIMARY KEY(document,voice,key));
        CREATE TABLE writes(document TEXT NOT NULL, voice TEXT NOT NULL, key TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(document,voice,key));
        CREATE TABLE state(name TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO chapters VALUES('${DOC}','nav.0',0,'分句',NULL,0,0,NULL,1,'["分句","这是第一句。"]',2);
        INSERT INTO memberships VALUES('${DOC}','nav.0',0,'${modelKey}');
        INSERT INTO state VALUES('segmentation','1');`,
    });
    const texts = ['分句', '这是第一句。2024年发生了很多事。'];
    const spec = JSON.stringify({ chapter: 'nav.0', texts, modelClip: `${modelKey}.m4a`, dropKeys: [speechKey('这是第一句。')], revisions: { walk: '1' }, dropRevisions: ['segmentation'] });
    const specPath = join(dir, 'spec.json');
    writeFileSync(specPath, spec);

    // The real CLI against this fixture: the container does not name a
    // CoreSimulator device, so the run must FAIL CLOSED without writing.
    const script = join(__dirname, 'recheck-stage-321.cjs');
    let refused = '';
    try {
      execFileSync('node', [script, dir, DOC, VOICE, specPath], { encoding: 'utf8' });
    } catch (error) {
      refused = String((error as { stderr?: string }).stderr ?? error);
    }
    expect(refused).toContain('FAIL CLOSED');
    const seg = execFileSync('sqlite3', [catalogue, "SELECT COUNT(*) FROM state WHERE name='segmentation'"], { encoding: 'utf8' }).trim();
    expect(seg).toBe('1'); // nothing written on the refused run

    // The same stage SQL applied directly (what a validated target would run):
    execFileSync('sqlite3', [catalogue], { input: buildStageSql({ documentKey: DOC, voiceKey: VOICE, chapter: 'nav.0', texts, dropKeys: [modelKey], revisions: { walk: '1' }, dropRevisions: ['segmentation'], modelJson: MODEL }) });
    const q = (q2: string) => execFileSync('sqlite3', [catalogue, q2], { encoding: 'utf8' }).trim();
    expect(q(`SELECT texts FROM chapters WHERE document='${DOC}' AND id='nav.0'`)).toBe(JSON.stringify(texts));
    expect(q(`SELECT COUNT(*) FROM memberships WHERE document='${DOC}' AND chapter='nav.0'`)).toBe('2');
    expect(q(`SELECT metadata FROM clips WHERE key='${speechKey(texts[1])}'`)).toContain(`"key":"${speechKey(texts[1])}"`);
    expect(q(`SELECT COUNT(*) FROM clips WHERE key='${speechKey('这是第一句。')}'`)).toBe('0');
    expect(q(`SELECT COUNT(*) FROM clips WHERE key='${modelKey}'`)).toBe('1'); // 分句 survives: same digest as the model clip
    expect(q("SELECT value FROM state WHERE name='walk'")).toBe('1');
    expect(q("SELECT COUNT(*) FROM state WHERE name='segmentation'")).toBe('0');
    stageAudioFiles({ audioDir, documentKey: DOC, voiceKey: VOICE, texts, modelPath: join(audioDir, `${modelKey}.m4a`) });
    const newKey = speechKey(texts[1]);
    const sidecar = JSON.parse(readFileSync(join(audioDir, `${newKey}.json`), 'utf8'));
    expect(sidecar.key).toBe(newKey);
    expect(sidecar.size).toBe(MODEL.size);
    expect(existsSync(join(audioDir, `${newKey}.m4a`))).toBe(true);
    expect(readFileSync(join(audioDir, `${newKey}.m4a`)).length).toBe(MODEL.size);
  });
});
