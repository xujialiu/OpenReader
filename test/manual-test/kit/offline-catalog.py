#!/usr/bin/env python3
"""Read offline metadata without playing, navigating, or changing the phone (#322).

  python3 offline-catalog.py IPHONE_UDID /tmp/or-offline
  python3 offline-catalog.py --local /path/catalog.sqlite /tmp/or-offline

OUT must not exist. Phone mode copies the database, WAL and SHM, then opens a
working copy and uses SQLite backup to make snapshot.sqlite. A three-file phone
copy is NOT an atomic snapshot: integrity_check verifies structure only, not that
all three files came from one instant. The report marks that limitation, even on
success. For decisive comparisons use a quiescent app or an in-app online backup.
Local mode takes a consistent online backup of a local database. Neither mode
checks audio payloads, changes the source database, nor reads credentials.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

BUNDLE = 'top.xujialiu.openreader'
FOLDER = 'Documents/offline-narration-v2'


def digest(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def voice_key(voice):
    # The original free Fish identity stays unchanged (narration-voice.ts).
    parts = [voice['provider'], voice['voice']]
    if voice['provider'] == 'fish' and voice.get('model', 's2.1-pro-free') != 's2.1-pro-free':
        parts.insert(1, voice['model'])
    return digest(json.dumps(parts, ensure_ascii=False, separators=(',', ':')))


def copy_from_phone(device, relative, destination, optional=False):
    command = ['xcrun', 'devicectl', 'device', 'copy', 'from', '--device', device,
               '--domain-type', 'appDataContainer', '--domain-identifier', BUNDLE,
               '--source', relative, '--destination', str(destination)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=300)
    if result.returncode:
        message = result.stdout + result.stderr
        if optional and any(word in message.lower() for word in ('no such file', 'does not exist', 'file not found')):
            return False
        raise RuntimeError(f'Could not copy {relative}; devicectl exited {result.returncode}. No summary is credited.')
    return True


def snapshot(source, destination):
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as db:
        with sqlite3.connect(destination) as target:
            db.backup(target)
    with sqlite3.connect(destination) as db:
        results = [row[0] for row in db.execute('PRAGMA integrity_check')]
    if results != ['ok']:
        raise RuntimeError('Catalogue integrity_check failed: ' + '; '.join(results[:5]))


def summarize(path, library=None):
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        state = dict(db.execute('SELECT name,value FROM state'))
        tasks = json.loads(state.get('tasks', '[]'))
        known = {digest(t['document']): {'id': t['document']} for t in tasks}
        if library:
            data = json.loads(Path(library).read_text())
            for entry in data.get('entries', []) if isinstance(data, dict) else data:
                if isinstance(entry, dict) and isinstance(entry.get('id'), str):
                    known[digest(entry['id'])] = {'id': entry['id'], 'title': entry.get('title', '')}
        columns = {row['name'] for row in db.execute('PRAGMA table_info(chapters)')}
        recheck = 'ch.recheck' if 'recheck' in columns else '0'
        voice_columns = {row['name'] for row in db.execute('PRAGMA table_info(voices)')}
        model = 'model' if 'model' in voice_columns else 'NULL AS model'
        rows = []
        for voice in db.execute(f'SELECT document,key,provider,voice_id,label,{model} FROM voices ORDER BY document,key').fetchall():
            document, key = voice['document'], voice['key']
            owned = set()
            for task in tasks:
                if digest(task['document']) == document and voice_key(task['voice']) == key:
                    owned.update(task['chapters'])
            progress = db.execute(f'''SELECT ch.id,ch.prepared,{recheck} AS recheck,ch.text_count AS total,COUNT(c.key) AS saved
                FROM chapters ch LEFT JOIN memberships m ON m.document=ch.document AND m.chapter=ch.id
                LEFT JOIN clips c ON c.document=m.document AND c.voice=? AND c.key=m.clip_key AND c.state='ready'
                WHERE ch.document=? GROUP BY ch.id ORDER BY ch.ordinal''', (key, document)).fetchall()
            owned_progress = [p for p in progress if p['id'] in owned]
            counts = {'chapters': len(owned_progress),
                      'downloaded': sum(p['prepared'] and p['total'] > 0 and p['saved'] == p['total'] for p in owned_progress),
                      'awaiting': sum(bool(p['recheck']) for p in owned_progress),
                      'partial': sum(0 < p['saved'] < p['total'] for p in owned_progress),
                      'unprepared': sum(not p['prepared'] for p in owned_progress),
                      'allSaved': sum(p['total'] > 0 and p['saved'] == p['total'] for p in owned_progress)}
            counts['clips'] = db.execute("SELECT COUNT(*) FROM clips WHERE document=? AND voice=? AND state='ready'", (document, key)).fetchone()[0]
            counts['orphans'] = db.execute('''SELECT COUNT(*) FROM clips c WHERE c.document=? AND c.voice=? AND c.state='ready'
                AND NOT EXISTS(SELECT 1 FROM memberships m WHERE m.document=c.document AND m.clip_key=c.key)''', (document, key)).fetchone()[0]
            counts['legacyAllSavedUnprepared'] = sum(not p['prepared'] and p['total'] > 0 and p['saved'] == p['total'] for p in owned_progress)
            rows.append({'documentKey': document, **known.get(document, {}), 'voice': dict(voice), **counts})
        return {'schema': db.execute('PRAGMA user_version').fetchone()[0],
                'revisions': {k: state.get(k) for k in ('walk', 'segmentation', 'speech')}, 'voices': rows,
                'tasks': [{'document': t['document'], 'voice': t['voice'], 'state': t['state'],
                           'chapters': len(t['chapters']), 'paused': len(t.get('paused', [])), 'failed': len(t.get('failed', []))}
                          for t in tasks]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--local', action='store_true')
    parser.add_argument('--library', type=Path, help='Optional local library.json for titles')
    parser.add_argument('source', help='IPHONE_UDID, or catalogue path with --local')
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    if args.local:
        source = Path(args.source)
        provenance = 'consistent local SQLite online backup; metadata only, not a payload audit'
    else:
        raw = args.out / 'raw'
        raw.mkdir()
        for suffix in ('', '-wal', '-shm'):
            name = 'catalog.sqlite' + suffix
            copy_from_phone(args.source, FOLDER + '/' + name, raw / name, optional=bool(suffix))
        work = args.out / 'replay'
        shutil.copytree(raw, work)
        source = work / 'catalog.sqlite'
        provenance = 'NON-ATOMIC phone copy: integrity is not proof of a single-instant snapshot; metadata only'
    target = args.out / 'snapshot.sqlite'
    snapshot(source, target)
    report = summarize(target, args.library)
    report['capture'] = provenance
    (args.out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(provenance)
    print('revisions:', json.dumps(report['revisions'], ensure_ascii=False))
    print('Document  Voice  Downloaded  Recheck  Partial  Unprepared  All-saved  Clips  Unmatched')
    for row in report['voices']:
        print(row.get('id', row['documentKey'])[:15], json.dumps(row['voice']['label'], ensure_ascii=False),
              *(row[k] for k in ('downloaded', 'awaiting', 'partial', 'unprepared', 'allSaved', 'clips', 'orphans')))
    print(f"{len(report['voices'])} Document/Voice rows; {len(report['tasks'])} Downloads; details: {args.out / 'summary.json'}")


if __name__ == '__main__':
    try:
        main()
    except (OSError, sqlite3.Error, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        sys.exit(1)
