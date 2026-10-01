#!/usr/bin/env python3
"""The accessibility tree of a simulator, and real touches on what it lists.

Reads the tree with the AXe that ships inside mobilebuildmcp (the same binary
`pitfalls/mcp.md` tells you to find by hand) and touches with a down/up pair in
one call, which is what the phone's alerts, sheets and buttons answer
(`pitfalls/mcp.md`, "A system alert and a masked field").

  python3 test/manual-test/kit/ax.py UDID tree
  python3 test/manual-test/kit/ax.py UDID find LABEL
  python3 test/manual-test/kit/ax.py UDID alert
  python3 test/manual-test/kit/ax.py UDID touch LABEL
  python3 test/manual-test/kit/ax.py UDID alert-touch LABEL
  python3 test/manual-test/kit/ax.py UDID scroll-touch LABEL
  python3 test/manual-test/kit/ax.py UDID scroll-to LABEL

tree         every element that has a label or a value: `role | label | value |
             x,y WxH`, in points, indented by depth. A long ScrollView lists all
             its rows, the off-screen ones with their frames beyond the screen,
             so one dump answers "how many rows, in which order".
find         the centre `x y` of the first element (a heading excluded) whose
             label is exactly LABEL and that has a size; exit 1 when there is none.
alert        `ALERT` and the title, message and buttons of the phone's own alert
             (an `AXSheet`, not an `Alert`, `pitfalls/mcp.md`), or `NO ALERT` and
             exit 1.
touch        a touch pair (0.2 s) on what `find` found; prints the point and the
             time *after* the touch. `describe-ui` takes about two seconds, so a
             time taken before calling this is two seconds early.
alert-touch  the same, for a Button inside the alert only (an `Allow` under the
             alert, not one elsewhere on the page).
scroll-touch `touch` for a row of a long list: swipes the list (`axe swipe`, 0.8 s,
             1.3 s to settle) until the element is on the screen, waits until two
             reads 0.7 s apart agree, so a list still decelerating cannot move
             the row under the touch, then touches it. Exit 1 when there is no such
             element or the list never brought it up.
scroll-to    the same swiping and settling, without the touch: prints the centre
             `x y` the element came to rest at, for a screenshot of a row.

AXE names the binary to use; unset, the newest one under ~/.npm/_npx. Nothing
here sets the simulator's volume or plays anything.
"""
import glob
import json
import os
import subprocess
import sys
import time
from datetime import datetime


def axe_binary():
    named = os.environ.get('AXE')
    if named and os.path.exists(named):
        return named
    found = glob.glob(os.path.expanduser('~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe'))
    if not found:
        sys.exit('No AXE: set AXE, or run mobilebuildmcp once so npx caches it (pitfalls/mcp.md).')
    return max(found, key=os.path.getmtime)


def read_tree(udid):
    out = subprocess.run([axe_binary(), 'describe-ui', '--udid', udid], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def walk(node, inside_sheet=False, depth=0):
    """Every element with its depth and whether it sits under an alert's Sheet."""
    if isinstance(node, list):
        for child in node:
            yield from walk(child, inside_sheet, depth)
        return
    if not isinstance(node, dict):
        return
    here = inside_sheet or node.get('type') == 'Sheet'
    yield node, here, depth
    for child in node.get('children', []):
        yield from walk(child, here, depth + 1)


def frame(node):
    f = node.get('frame') or {}
    return f.get('x', 0), f.get('y', 0), f.get('width', 0), f.get('height', 0)


def centre_of(tree, label, buttons_in_sheet_only=False):
    """The first element with this exact label, a Button before anything else with the same label (a voice's row and its name in the player)."""
    found = []
    for node, in_sheet, _ in walk(tree):
        if node.get('AXLabel') != label or node.get('type') == 'Heading':
            continue
        if buttons_in_sheet_only and not (in_sheet and node.get('type') == 'Button'):
            continue
        x, y, w, h = frame(node)
        if w > 0 and h > 0:
            found.append((node.get('type') != 'Button', x + w / 2, y + h / 2))
    if not found:
        return None
    pick = ([one for one in found if not one[0]] or found)[0]
    return pick[1], pick[2]


def bring_on_screen(udid, label, top=130, bottom=800, tries=40):
    """Swipe the list under `label` until its centre is between `top` and `bottom` (points) and has stopped moving. Returns the centre, or None."""
    for _ in range(tries):
        at = centre_of(read_tree(udid), label)
        if at is None:
            return None
        x, y = at
        if top < y < bottom:
            time.sleep(0.7)
            again = centre_of(read_tree(udid), label)
            if again == at:
                return at
            continue
        start, end = (700, 250) if y > bottom else (250, 700)
        subprocess.run([axe_binary(), 'swipe', '--start-x', '201', '--start-y', str(start), '--end-x', '201', '--end-y', str(end),
                        '--duration', '0.8', '--post-delay', '1.3', '--udid', udid], check=True, stdout=subprocess.DEVNULL)
    return None


def touch(udid, tree, label, sheet_only):
    at = centre_of(tree, label, sheet_only)
    if at is None:
        print(f"no {'alert button' if sheet_only else 'element'} '{label}'")
        return 1
    x, y = at
    subprocess.run([axe_binary(), 'touch', '-x', f'{x:.1f}', '-y', f'{y:.1f}', '--down', '--up', '--delay', '0.2', '--udid', udid],
                   check=True, stdout=subprocess.DEVNULL)
    print(f"touched '{label}' at ({x:.1f}, {y:.1f}) {datetime.now().strftime('%H:%M:%S.%f')[:-3]}")
    return 0


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    udid, command, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
    tree = read_tree(udid)
    if command == 'tree':
        for node, _, depth in walk(tree):
            label, value = node.get('AXLabel') or '', node.get('AXValue') or ''
            if label or value:
                x, y, w, h = frame(node)
                print(f"{'  ' * depth}{node.get('type')} | {label} | {value} | {x:.0f},{y:.0f} {w:.0f}x{h:.0f}")
        return 0
    if command == 'find':
        at = centre_of(tree, rest[0])
        if at is None:
            return 1
        print(f'{at[0]:.1f} {at[1]:.1f}')
        return 0
    if command == 'alert':
        seen = []
        for node, in_sheet, _ in walk(tree):
            label = node.get('AXLabel') or ''
            if in_sheet and label and node.get('type') in ('StaticText', 'Button') and (node.get('type'), label) not in seen:
                seen.append((node.get('type'), label))
        print('ALERT' if seen else 'NO ALERT')
        for kind, label in seen:
            print(f'   {kind}: {label}')
        return 0 if seen else 1
    if command in ('touch', 'alert-touch'):
        return touch(udid, tree, rest[0], command == 'alert-touch')
    if command == 'scroll-to':
        at = bring_on_screen(udid, rest[0])
        if at is None:
            print(f"no element '{rest[0]}', or the list never brought it up")
            return 1
        print(f'{at[0]:.1f} {at[1]:.1f}')
        return 0
    if command == 'scroll-touch':
        if bring_on_screen(udid, rest[0]) is None:
            print(f"no element '{rest[0]}', or the list never brought it up")
            return 1
        return touch(udid, read_tree(udid), rest[0], False)
    sys.exit(__doc__)


if __name__ == '__main__':
    sys.exit(main())
