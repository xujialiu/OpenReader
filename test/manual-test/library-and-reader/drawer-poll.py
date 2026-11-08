#!/usr/bin/env python3
"""Poll the shared Drawer boundary through CDP for a bounded window.

Usage: drawer-poll.py SECONDS OUT.jsonl METRO DEVICE_NAME
Writes one JSON line per sample: {t, drawers, selection, guard, detents}.
Run it across a rotation/resize action to show the Drawer stayed presented
(without re-presentation) while its detents re-rendered to the new window.
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec3 = importlib.util.spec_from_file_location('drawer_interactions', ROOT / 'test/manual-test/library-and-reader/drawer-interactions.py')
di = importlib.util.module_from_spec(spec3)
spec3.loader.exec_module(di)

seconds = float(sys.argv[1])
out = Path(sys.argv[2])
metro = sys.argv[3]
device_name = sys.argv[4]
env = dict(os.environ, OPENREADER_DEVICE=device_name)
out.parent.mkdir(parents=True, exist_ok=True)
script = out.with_name(out.stem + '-state.js')
script.write_text(di.EXPRESSION)
start = time.monotonic()
with out.open('w') as stream:
    n = 0
    while time.monotonic() - start < seconds:
        t = round(time.monotonic() - start, 2)
        try:
            reply = subprocess.run(['node', str(ROOT / 'test/manual-test/kit/cdp.cjs'), '--eval',
                                    str(script), metro], capture_output=True, text=True,
                                   timeout=15, env=env)
            result = json.loads(json.loads(reply.stdout)['value'])
            mods = result['groups'][0] if result['groups'] else None
            if mods:
                detents = next(m['detents'] for m in mods if m['$type'] == 'presentationDetents')
                selection = next((m['selection'] for m in mods if m['$type'] == 'presentationDetents'), None)
                guard = next(m['isDisabled'] for m in mods if m['$type'] == 'interactiveDismissDisabled')
                sample = {'t': t, 'drawers': result['groups'] and 1, 'selection': selection,
                          'guard': guard, 'detents': detents}
            else:
                sample = {'t': t, 'drawers': 0}
        except Exception as error:  # a missed sample is recorded, not fatal
            sample = {'t': t, 'error': str(error)[:160]}
        stream.write(json.dumps(sample) + '\n')
        stream.flush()
        n += 1
        time.sleep(0.4)
print(f'poller wrote {n} samples to {out}')
