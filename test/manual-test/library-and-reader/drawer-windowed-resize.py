#!/usr/bin/env python3
"""Windowed-desk Drawer resize verification for #361 (iPadOS 26 windowing).

Written for the drawer-361-pad-01 final verification; keep as the record of
what the windowed contract needs. Findings baked into this driver:
- AXe describe-ui and mobilebuildmcp snapshot_ui are BLIND to an app window
  while the desk (home) surface fronts it; real touches still land, and CDP
  (Metro) reads the app freely.
- RN's useWindowDimensions reports the true windowed size, and the opening
  detent equals exactly 50% of it at every size seen.
- The screenshot oracle cannot separate the Drawer card from the reader's
  near-white page; painted facts come from the native grabber pill, the
  traffic-light dot (window top anchor, offset 31.8 pt) and RN's size.
- Sheet drags in the windowed presentation take a start about 5 pt ABOVE the
  painted pill and a slower pace; faster drags at the pill can no-op.
- The native bottom chrome is about 51 pt fullscreen but only about 6-11 pt
  windowed: it follows the native presentation, it is not a fixed inset.
Real input throughout; playback stays paused. Run the steps under
kit/ios_guard.py admission. Artifact paths are attempt-local arguments.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

UDID = os.environ.get('OPENREADER_UDID', 'EF3E47DA-C530-45CC-9BC8-9B70ECCD454B')
OUT = Path(os.environ.get('OPENREADER_DRAWER_ARTIFACTS', '/tmp/openreader-drawer361-ios-qa-01/phases'))
ROOT = Path(__file__).resolve().parents[3]
SCALE = 2.0
EXPECTED_CHROME = 51  # accepted native bottom inset (about 52 pt at 820x1180)

spec = importlib.util.spec_from_file_location('ax', ROOT / 'test/manual-test/kit/ax.py')
ax = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ax)
spec2 = importlib.util.spec_from_file_location('dp', ROOT / 'test/manual-test/library-and-reader/drawer-placement.py')
dp = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(dp)
spec3 = importlib.util.spec_from_file_location('di', ROOT / 'test/manual-test/library-and-reader/drawer-interactions.py')
di = importlib.util.module_from_spec(spec3)
spec3.loader.exec_module(di)

env = dict(os.environ, OPENREADER_DEVICE=os.environ.get('OPENREADER_DEVICE', 'drawer-361-pad-01'))


def run(command, timeout=35):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True,
                            timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError(f'{Path(str(command[0])).name}: {result.stderr[:300]}')
    return result.stdout


def axe(*args):
    result = subprocess.run([ax.axe_binary(), *args, '--udid', UDID], capture_output=True, text=True, timeout=40)
    if result.returncode:
        raise RuntimeError(f'axe {args[0]}: {result.stderr[:300]}')
    return result.stdout


DETS_EXPRESSION = """(() => {
  const h=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;const groups=[];
  function walk(f){if(!f)return;const p=f.memoizedProps||{};
    if(f.type?.name==='Group'&&p.modifiers?.some(m=>m.$type==='presentationDetents'))
      groups.push(p.modifiers.map(m=>Object.fromEntries(Object.entries(m).filter(([k,v])=>typeof v!=='function'))));
    walk(f.child);walk(f.sibling);}
  for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
  return JSON.stringify({groups});
})()"""

ROWS_EXPRESSION = """(() => {
  const h=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;const rows=new Set();
  function walk(f){if(!f)return;const p=f.memoizedProps||{};
    const child=typeof p.children==='string'?p.children:'';
    if(/^Chapter \\d+:/.test(child))rows.add(child);
    walk(f.child);walk(f.sibling);}
  for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
  return JSON.stringify({rows:[...rows]});
})()"""

DIMS_EXPRESSION = """(() => {
  const h=globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;let dims=null;
  function walk(f){if(!f||dims)return;
    if(f.type?.name==='Drawer'){
      let hook=f.memoizedState;let n=0;
      while(hook&&n<24){const m=hook.memoizedState;
        if(m&&typeof m==='object'&&typeof m.width==='number'&&typeof m.height==='number'&&typeof m.scale==='number'){dims=m;break;}
        hook=hook.next;n++;}
    }
    walk(f.child);walk(f.sibling);}
  for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
  return JSON.stringify({dims});
})()"""


def cdp(expression_file, name):
    script = OUT / f'{name}.js'
    script.write_text(expression_file)
    reply = run(['node', ROOT / 'test/manual-test/kit/cdp.cjs', '--eval', script, 'http://127.0.0.1:8362'])
    return json.loads(json.loads(reply)['value'])


def state():
    result = cdp(DETS_EXPRESSION, 'r5d-state')
    if not result['groups']:
        return {'selection': None, 'guard': None, 'detents': None}
    mods = result['groups'][0]
    return {'selection': next(m['selection'] for m in mods if m['$type'] == 'presentationDetents'),
            'guard': next(m['isDisabled'] for m in mods if m['$type'] == 'interactiveDismissDisabled'),
            'detents': next(m['detents'] for m in mods if m['$type'] == 'presentationDetents')}


def shot(name):
    path = OUT / f'{name}.png'
    run(['xcrun', 'simctl', 'io', UDID, 'screenshot', path])
    return path


DOT_OFFSET = 31.8  # red traffic dot centre to window top, calibrated 2026-11-08


def window_bounds(path, rn=None):
    """Window top from the red traffic-light dot (drawer-state independent);
    left/width from the light-pixel columns; SIZE from RN (authority)."""
    img = np.asarray(Image.open(path).convert('RGB')).astype(int)
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    red = (r > 210) & (g < 130) & (b < 130)
    red[:, 900:] = False
    rows = np.flatnonzero(red.sum(axis=1) > 4)
    if len(rows) == 0:
        raise RuntimeError('traffic-light red dot not found')
    top_rows = rows[rows < rows.min() + 60]
    yy, xx = np.where(red)
    sel = np.isin(yy, top_rows)
    dot_x, dot_y = xx[sel].mean() / SCALE, yy[sel].mean() / SCALE
    light = (img.min(axis=2) > 233) & ((img.max(axis=2) - img.min(axis=2)) < 12)
    col_frac = light.mean(axis=0)
    cols = np.flatnonzero(col_frac > .35)
    if len(cols) < 100 and rn is None:
        raise RuntimeError(f'no window-sized light region: cols {len(cols)}')
    width = (cols[-1] - cols[0] + 1) / SCALE
    # The dot anchors the window frame; at large the dimmed page breaks the
    # light-column left edge, so the dot wins when they disagree.
    x0 = dot_x - DOT_OFFSET
    if abs(x0 - cols[0] / SCALE) <= 8:
        x0 = cols[0] / SCALE
    top = dot_y - DOT_OFFSET
    if rn is not None:
        # RN's window size is the authority; the light columns understate the
        # window when the large drawer dims the page around its card.
        return [round(x0, 1), round(top, 1), float(rn['width']), float(rn['height'])]
    if width < 300:
        raise RuntimeError(f'implausible window width {width:.1f}')
    return [round(x0, 1), round(top, 1), round(width, 1), -1.0]


def crop_window(path, bounds, name):
    x, y, w, h = bounds
    cropped = OUT / f'{name}-window.png'
    Image.open(path).crop((int(x * SCALE), int(y * SCALE), int((x + w) * SCALE), int((y + h) * SCALE))).save(cropped)
    return cropped


def find_grabber(path, bounds, min_top_frac=0.12, min_y_px=None):
    """The native grabber pill: a compact mid-grey centred blob (screen pt).

    min_y_px bounds the search floor: the pill cannot sit far above the
    position implied by the CDP detent, which excludes title-bar lookalikes.
    """
    img = np.asarray(Image.open(path).convert('RGB')).astype(int)
    x, y, w, h = bounds
    band = img[int(y * SCALE):int((y + h) * SCALE), int(x * SCALE):int((x + w) * SCALE)]
    light = (band.min(axis=2) > 233) & ((band.max(axis=2) - band.min(axis=2)) < 14)
    grey = (np.abs(band - band.mean(axis=2, keepdims=True)).max(axis=2) < 14) & \
           (band.mean(axis=2) > 120) & (band.mean(axis=2) < 190)
    rows = np.flatnonzero(grey.mean(axis=1) > 0.015)
    if min_y_px is not None:
        rows = rows[rows >= min_y_px * SCALE]
    if len(rows) == 0:
        return None
    groups = np.split(rows, np.where(np.diff(rows) > 10)[0] + 1)
    centre_x = w * SCALE / 2
    for g in groups:
        if len(g) < 6 or len(g) > 30:
            continue
        if g[0] < int(h * SCALE * min_top_frac):
            continue  # by default skip the window title bar area
        cols = np.flatnonzero(grey[g[0]:g[-1] + 1].mean(axis=0) > 0.3)
        if len(cols) == 0:
            continue
        width_pt = (cols[-1] - cols[0]) / SCALE
        blob_x = (cols[0] + cols[-1]) / 2
        if not (26 <= width_pt <= 90 and abs(blob_x - centre_x) < 60 * SCALE):
            continue
        # A real grabber has the light drawer card directly under it.
        below = light[g[-1] + 6:g[-1] + int(30 * SCALE)]
        if below.size == 0 or below.mean(axis=1).mean() < .5:
            continue
        return [round(x + blob_x / SCALE, 1), round(y + (g[0] + g[-1]) / 2 / SCALE, 1)]
    return None


def drawer_left_right(path, bounds, grabber_y):
    """The drawer's painted left/right edges: light card against the page."""
    img = np.asarray(Image.open(path).convert('RGB')).astype(int)
    x, y, w, h = bounds
    row2 = img[int((grabber_y + 6) * SCALE)]
    seg = row2[int(x * SCALE):int((x + w) * SCALE)]
    light = (seg.min(axis=1) > 233) & ((seg.max(axis=1) - seg.min(axis=1)) < 14)
    cols = np.flatnonzero(light)
    if len(cols) < 40:
        return None
    return [round(x + cols[0] / SCALE, 1), round(x + cols[-1] / SCALE, 1)]


def measure(name, note=''):
    dims = cdp(DIMS_EXPRESSION, 'r5d-dims')['dims']
    path = shot(name)
    bounds = window_bounds(path, dims)
    st = state()
    sel = st['selection']
    floor = 0.0
    if isinstance(sel, dict) and 'height' in sel:
        floor = max(0.0, bounds[3] - sel['height'] - 90) / bounds[3]
    grabber = find_grabber(path, bounds, min_top_frac=0.0, min_y_px=floor * bounds[3])
    record = {'name': name, 'note': note, 'window': bounds, 'grabber': grabber,
              'state': st, 'rnWindow': dims, 'rows': sorted(cdp(ROWS_EXPRESSION, 'r5d-rows')['rows'])}
    if grabber is not None:
        edges = drawer_left_right(path, bounds, grabber[1])
        record['drawerEdges'] = edges
        if edges:
            record['drawerWidth'] = round(edges[1] - edges[0], 1)
        # Drawer top offset from the window top; implied painted height from
        # the accepted chrome: height = window_h - offset(top) - chrome.
        record['drawerTopOffset'] = round(grabber[1] - bounds[1] - 8, 1)
        record['impliedChrome'] = round(bounds[3] - record['drawerTopOffset'] - (record['state']['selection']['height'] if isinstance(record['state']['selection'], dict) and record['state']['selection'] else 0), 1)
    (OUT / f'{name}-measure.json').write_text(json.dumps(record, indent=2))
    brief = {k: record.get(k) for k in ('name', 'window', 'rnWindow', 'state', 'drawerEdges', 'drawerWidth', 'drawerTopOffset')}
    brief['rowsFirstLast'] = (record['rows'][0], record['rows'][-1]) if record['rows'] else None
    print(json.dumps(brief))
    return record


def tap(point):
    axe('touch', '-x', f'{point[0]:.1f}', '-y', f'{point[1]:.1f}', '--down', '--up', '--delay', '0.2')


def sheet_drag(start, end, settle='1.2'):
    """Sheet drags in the windowed presentation take a start just above the
    painted pill and a slower pace; faster drags at the pill no-op."""
    axe('drag', '--start-x', f'{start[0]:.1f}', '--start-y', f'{start[1] - 5:.1f}',
        '--end-x', f'{end[0]:.1f}', '--end-y', f'{end[1]:.1f}', '--duration', '2.2', '--post-delay', settle)


def drag(start, end, duration='1.2', settle='1.0'):
    axe('drag', '--start-x', f'{start[0]:.1f}', '--start-y', f'{start[1]:.1f}',
        '--end-x', f'{end[0]:.1f}', '--end-y', f'{end[1]:.1f}', '--duration', duration, '--post-delay', settle)


def find_transport_y(path, bounds):
    """The paused transport row: the dark Play circle's centre y (screen pt)."""
    img = np.asarray(Image.open(path).convert('RGB')).astype(int)
    x, y, w, h = bounds
    band = img[int(y * SCALE):int((y + h) * SCALE), int((x + w * 0.25) * SCALE):int((x + w * 0.75) * SCALE)]
    dark = (band.max(axis=2) < 60)
    rows = np.flatnonzero(dark.mean(axis=1) > 0.03)
    if len(rows) == 0:
        raise RuntimeError('no dark Play circle found')
    groups = np.split(rows, np.where(np.diff(rows) > 12)[0] + 1)
    for g in reversed(groups):
        height_pt = (g[-1] - g[0]) / SCALE
        if height_pt < 30:
            continue
        centre_px = (g[0] + g[-1]) / 2
        col_dark = dark[g[0]:g[-1] + 1]
        cols = np.flatnonzero(col_dark.mean(axis=0) > 0.3)
        if len(cols) == 0:
            continue
        centre_x = x + w * 0.25 + (cols[0] + cols[-1]) / 2 / SCALE
        if abs(centre_x - (x + w / 2)) > 40:
            continue
        return round(y + centre_px / SCALE, 1)
    raise RuntimeError('no Play-circle-shaped dark cluster found')


def open_contents():
    for attempt in range(3):
        if state()['selection'] is not None:
            return measure('r5d-opening', 'Contents open (CDP-verified)')
        path = shot('r5d-base')
        bounds = window_bounds(path)
        transport_y = find_transport_y(path, bounds)
        tap([bounds[0] + 46, transport_y])
        time.sleep(1.7)
        record = measure(f'r5d-opening-{attempt}', 'Contents opened in windowed app')
        if record['grabber'] is not None:
            return record
        print(f'attempt {attempt}: drawer not open')
    raise RuntimeError('Contents drawer did not open after retries')


def drawer_top(record):
    """Implied drawer top edge (screen y): grabber y minus its 8 pt inset."""
    return record['grabber'][1] - 8


def painted_height(record):
    """Painted height from the drawer top edge to the accepted chrome bottom."""
    return record['window'][1] + record['window'][3] - EXPECTED_CHROME - drawer_top(record)


def main():
    # State-first: only trust a drawer's existence through CDP, never pixels.
    st = state()
    if st['selection'] == 'large':
        probe = shot('r5d-open-probe')
        pb = window_bounds(probe, cdp(DIMS_EXPRESSION, 'r5d-dims')['dims'])
        pg = find_grabber(probe, pb, min_top_frac=0.0)
        if pg is None:
            raise RuntimeError('drawer is large but its grabber was not found')
        sheet_drag(pg, [pg[0], pb[1] + pb[3] * 0.55])
        st = state()
        print('contracted an open large drawer first:', st['selection'])
    if st['selection'] is None:
        record = open_contents()
    else:
        print('drawer already open (CDP), measuring it directly')
        record = measure('r5d-opening', 'Contents already open in windowed app')
    bounds = record['window']
    detent = record['state']['selection']['height']
    rn_h = record['rnWindow']['height']
    if abs(detent - rn_h * 0.5) > 2:
        raise RuntimeError(f'opening detent {detent} is not 50% of the RN window height {rn_h}')
    chrome = record['impliedChrome']
    if not (0 <= chrome <= 80):
        raise RuntimeError(f'painted drawer top inconsistent with detent {detent}: implied chrome {chrome}')
    print(f'windowed opening: RN window {record["rnWindow"]["width"]}x{rn_h}, detent {detent} = 50%, '
          f'drawer top offset {record["drawerTopOffset"]}, native bottom chrome {chrome} (fullscreen shows about 51)')
    dw = record.get('drawerWidth')
    if dw is None or dw > bounds[2] + 2:
        raise RuntimeError(f'drawer wider than the available window width: {dw} in {bounds[2]}')
    print(f'narrow window: drawer painted width {dw} in window {bounds[2]}')

    grabber = record['grabber']
    sheet_drag(grabber, [grabber[0], bounds[1] + 20], settle='1.2')
    pre = measure('r5d-pre', 'expanded in windowed app')
    if pre['state']['selection'] != 'large':
        raise RuntimeError(f'did not reach large: {pre["state"]}')
    pre_top = pre['grabber'][1]

    # Real shrink via the window handle.
    w = pre['window']
    handle = [w[0] + w[2] - 10, w[1] + w[3] - 14]
    drag(handle, [w[0] + w[2] - 170, w[1] + w[3] - 330], duration='1.4', settle='3.5')
    shrunk = measure('r5d-shrunk', 'after real handle shrink')
    if shrunk['state']['selection'] != 'large':
        raise RuntimeError(f'expanded state lost across shrink: {shrunk["state"]}')
    if shrunk['window'][2] >= w[2] - 80 or shrunk['window'][3] >= w[3] - 80:
        raise RuntimeError(f'window did not shrink: {w} -> {shrunk["window"]}')
    if abs(shrunk['grabber'][1] - pre_top) > 12:
        raise RuntimeError(f'grabber moved across shrink: {pre_top} -> {shrunk["grabber"][1]}')
    overlap = set(pre['rows']) & set(shrunk['rows'])
    if not overlap:
        raise RuntimeError(f'rendered rows disjoint across shrink: {pre["rows"][:3]} vs {shrunk["rows"][:3]}')
    shrunk_detent = shrunk['state']['detents'][0]['height']
    if abs(shrunk_detent - shrunk['rnWindow']['height'] * 0.5) > 2:
        raise RuntimeError(f'shrunk detent {shrunk_detent} not 50% of RN window {shrunk["rnWindow"]["height"]}')
    print(f'shrink: window {shrunk["window"][2]}x{shrunk["window"][3]}, RN {shrunk["rnWindow"]["width"]}x{shrunk["rnWindow"]["height"]}, detent {shrunk_detent}, drawer stayed presented at the same top')

    # Real grow back out.
    w2 = shrunk['window']
    handle2 = [w2[0] + w2[2] - 10, w2[1] + w2[3] - 14]
    drag(handle2, [w2[0] + w2[2] + 380, w2[1] + w2[3] + 240], duration='1.4', settle='3.5')
    grown = measure('r5d-grown', 'after real handle grow')
    if grown['state']['selection'] != 'large':
        raise RuntimeError(f'expanded state lost across grow: {grown["state"]}')
    if grown['window'][2] <= w2[2] + 60 or grown['window'][3] <= w2[3] + 60:
        raise RuntimeError(f'window did not grow: {w2} -> {grown["window"]}')
    overlap2 = set(pre['rows']) & set(grown['rows'])
    if not overlap2:
        raise RuntimeError('rendered rows disjoint across grow')
    print(f'grow: window {grown["window"][2]}x{grown["window"][3]}, drawer still presented')

    # Contract to opening: ratio follows the CURRENT window.
    grabber = grown['grabber']
    gw = grown['window']
    sheet_drag(grabber, [grabber[0], gw[1] + gw[3] * 0.55])
    contracted = measure('r5d-contracted', 'contracted to opening after resizes')
    if contracted['state']['guard'] is not False or contracted['state']['selection'] == 'large':
        raise RuntimeError(f'contraction failed: {contracted["state"]}')
    c_detent = contracted['state']['selection']['height']
    if abs(c_detent - contracted['rnWindow']['height'] * 0.5) > 2:
        raise RuntimeError(f'contracted detent {c_detent} not 50% of RN window {contracted["rnWindow"]["height"]}')
    c_chrome = contracted['impliedChrome']
    if not (0 <= c_chrome <= 80):
        raise RuntimeError(f'contracted drawer top inconsistent with detent {c_detent}: implied chrome {c_chrome}')
    print(f'contracted: detent {c_detent} = 50% of current window, native bottom chrome {c_chrome}')

    # Dismiss, reopen: the opening height resets to the setting's ratio.
    grabber = contracted['grabber']
    sheet_drag(grabber, [grabber[0], gw[1] + gw[3] - 12], settle='1.4')
    after = measure('r5d-dismissed', 'after downward dismissal')
    if after['grabber'] is not None or after['state']['selection'] is not None:
        raise RuntimeError('drawer did not dismiss')
    path = shot('r5d-dismissed')
    tb = window_bounds(path)
    ty = find_transport_y(path, tb)
    tap([tb[0] + 46, ty])
    time.sleep(1.7)
    reopened = measure('r5d-reopened', 'reopened after dismissal')
    if reopened['grabber'] is None:
        raise RuntimeError('drawer did not reopen')
    r_detent = reopened['state']['selection']['height']
    if abs(r_detent - reopened['rnWindow']['height'] * 0.5) > 2:
        raise RuntimeError(f'reopened detent {r_detent} not 50% of RN window {reopened["rnWindow"]["height"]}')
    print(f'reopen resets the opening to the setting ratio of the current window: detent {r_detent}')
    print('PHASE5D-OK')
    return 0


if __name__ == '__main__':
    sys.exit(main())  # the main() sequence encodes the drawer-361-pad-01 run;
                      # import the helpers for other windowed phases
