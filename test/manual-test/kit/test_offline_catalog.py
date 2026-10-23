import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('offline-catalog.py')
spec = importlib.util.spec_from_file_location('offline_catalog', SCRIPT)
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


class OfflineCatalogueTest(unittest.TestCase):
    def make(self, path, modern=False):
        self.voice = {'provider': 'fish', 'voice': 'en/dax', 'label': 'Dax'}
        self.document = 'sha256:' + 'a' * 64
        doc, voice = kit.digest(self.document), kit.voice_key(self.voice)
        with sqlite3.connect(path) as db:
            db.executescript('''CREATE TABLE state(name TEXT PRIMARY KEY,value TEXT);
              CREATE TABLE voices(document TEXT,key TEXT,provider TEXT,voice_id TEXT,label TEXT,model TEXT);
              CREATE TABLE chapters(document TEXT,id TEXT,ordinal INTEGER,prepared INTEGER,text_count INTEGER);
              CREATE TABLE memberships(document TEXT,chapter TEXT,clip_key TEXT);
              CREATE TABLE clips(document TEXT,voice TEXT,key TEXT,state TEXT);
              PRAGMA user_version=2;''')
            db.execute('INSERT INTO state VALUES(?,?)', ('tasks', json.dumps([{'document': self.document, 'voice': self.voice, 'state': 'done', 'chapters': ['a'], 'failed': []}])))
            db.execute('INSERT INTO voices VALUES(?,?,?,?,?,?)', (doc, voice, 'fish', 'en/dax', 'Dax', None))
            for i, name in enumerate(['a', 'unowned']):
                db.execute('INSERT INTO chapters VALUES(?,?,?,?,?)', (doc, name, i, 0, 2))
                for key in ['one', 'two']:
                    db.execute('INSERT INTO memberships VALUES(?,?,?)', (doc, name, key))
            for key in ['one', 'two', 'orphan']:
                db.execute('INSERT INTO clips VALUES(?,?,?,?)', (doc, voice, key, 'ready'))
            if modern:
                db.executescript('ALTER TABLE chapters ADD COLUMN recheck INTEGER DEFAULT 1; UPDATE chapters SET prepared=1; PRAGMA user_version=3;')

    def test_legacy_counts_do_not_confuse_all_saved_with_downloaded_or_unowned(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'catalog.sqlite'
            self.make(db)
            row = kit.summarize(db)['voices'][0]
            self.assertEqual((row['chapters'], row['allSaved'], row['downloaded'], row['legacyAllSavedUnprepared']), (1, 1, 0, 1))
            self.assertEqual((row['clips'], row['orphans']), (3, 1))
            self.assertEqual(row['id'], self.document)

    def test_current_checks_can_coexist_with_pending_recheck(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / 'catalog.sqlite'
            self.make(db, modern=True)
            row = kit.summarize(db)['voices'][0]
            self.assertEqual((row['downloaded'], row['awaiting'], row['partial']), (1, 1, 0))

    def test_models_keep_the_apps_exact_key_order(self):
        value = {'provider': 'fish', 'voice': 'en/dax', 'model': 's2-pro'}
        expected = hashlib.sha256(b'["fish","s2-pro","en/dax"]').hexdigest()
        self.assertEqual(kit.voice_key(value), expected)
        self.assertEqual(kit.voice_key({**value, 'model': 's2.1-pro-free'}), kit.voice_key({'provider': 'fish', 'voice': 'en/dax'}))

    def test_local_cli_keeps_source_and_refuses_reused_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, out = Path(tmp) / 'catalog.sqlite', Path(tmp) / 'out'
            self.make(db)
            before = db.read_bytes()
            run = subprocess.run([sys.executable, str(SCRIPT), '--local', str(db), str(out)], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(db.read_bytes(), before)
            self.assertIn('consistent local SQLite online backup', run.stdout)
            self.assertTrue((out / 'summary.json').exists())
            again = subprocess.run([sys.executable, str(SCRIPT), '--local', str(db), str(out)], capture_output=True, text=True)
            self.assertNotEqual(again.returncode, 0)

    def test_corrupt_catalogue_has_no_success_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            db, out = Path(tmp) / 'catalog.sqlite', Path(tmp) / 'out'
            db.write_text('not sqlite')
            run = subprocess.run([sys.executable, str(SCRIPT), '--local', str(db), str(out)], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertFalse((out / 'summary.json').exists())


if __name__ == '__main__':
    unittest.main()
