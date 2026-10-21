#!/usr/bin/env python3
"""Does a drag on the open Player move anything in it? (#312)

    python3 player-drag.py SIMULATOR_UDID OUT_DIR [--from X Y] [--by DY] [--panel-top PT]

Screenshots the device at rest, then sends one slow `axe drag` (DY points,
default -200, i.e. up, over 4 s) starting at (X, Y) and screenshots it 1.5, 2.5
and 3.5 s after sending, while the finger is still down, then once more after
it lifts. Two measurements, both against the rest shot:

- **Play**: the centre of the Play button's dark circle, as the longest run of
  near-black pixels down a column through the circle's left half (left of its
  white triangle), below PANEL_TOP.
- **panel**: how many pixel rows below PANEL_TOP differ at all. A Player that
  does not move under the finger is pixel-identical; a note sliding in its own
  scroll view, which Play's position cannot see, shows here.

Exit 1 (red) if Play moved by more than 2 points or more than 3 pixel rows of
the panel changed in any mid-drag shot; 0 (green) if neither; 2 if the drag
failed or Play was not found. Points are the iPhone 17's (402 x 874 at 3x):
the column is x 181.7 pt, the default drag starts at (300, 765), on the plain
box of the head row right of the Voice name, and PANEL_TOP defaults to 690 pt,
above a Player carrying one three-line note at the default text size. Move it
above the Player's top edge for a taller one; anything above it is ignored.

Start the drag on a plain spot, not on a button: a drag that starts on one
shows its pressed fade in the first mid-drag shot (the Voice name at the
largest text size changed 232 rows at 1.5 s and none after), which counts as
changed rows though nothing moved. The per-shot lines say which rows.

What it cannot prove: a touch from a real finger (AXe's synthetic events go
through the simulator's HID path, as XCUITest's do), any width or text size
other than the one on screen, and a Player whose Play is not under the column.
"""
import argparse, glob, os, struct, subprocess, sys, time, zlib

COLUMN_PX = 545       # x 181.7 pt: inside Play's circle, left of its triangle
NEAR_BLACK = 60


def png_rows(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', path
    pos, idat = 8, b''
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            width, height, depth, colour = struct.unpack('>IIBB', body[:10])
            assert depth == 8 and colour in (2, 6), (depth, colour)
            bpp = 3 if colour == 2 else 4
        elif kind == b'IDAT':
            idat += body
        pos += 12 + n
    raw, stride = zlib.decompress(idat), width * bpp
    rows, prev = [], bytearray(stride)
    for y in range(height):
        kind = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if kind == 1: line[i] = (line[i] + a) & 255
            elif kind == 2: line[i] = (line[i] + b) & 255
            elif kind == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return rows, bpp


def play_centre(rows, bpp, top_px):
    """Centre y of the longest near-black run down COLUMN_PX, in points, or None."""
    best, start, span = 0, None, None
    for y in range(top_px, len(rows)):
        r, g, b = rows[y][COLUMN_PX * bpp:COLUMN_PX * bpp + 3]
        dark = r < NEAR_BLACK and g < NEAR_BLACK and b < NEAR_BLACK
        if dark and start is None:
            start = y
        if start is not None and (not dark or y == len(rows) - 1):
            if y - start > best:
                best, span = y - start, (start, y)
            start = None
    return None if span is None else (span[0] + span[1]) / 2 / 3


def changed_rows(a, b, top_px):
    return [y for y in range(top_px, min(len(a), len(b))) if a[y] != b[y]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('udid')
    parser.add_argument('out')
    parser.add_argument('--from', dest='start', nargs=2, type=float, default=(300, 765), metavar=('X', 'Y'))
    parser.add_argument('--by', type=float, default=-200)
    parser.add_argument('--panel-top', type=float, default=690)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    axe = os.environ.get('AXE') or max(glob.glob(os.path.expanduser('~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe')),
                                       key=os.path.getmtime)
    top_px = int(args.panel_top * 3)

    def shot(name):
        path = os.path.join(args.out, name)
        subprocess.run(['xcrun', 'simctl', 'io', args.udid, 'screenshot', path], check=True, capture_output=True)
        return png_rows(path)

    rest = shot('rest.png')
    x, y = args.start
    # macOS has no `timeout`; an AXe call without a limit can hang (pitfalls/mcp.md).
    drag = subprocess.Popen(['perl', '-e', 'alarm shift; exec @ARGV', '30', axe, 'drag', '--start-x', str(x), '--start-y', str(y),
                             '--end-x', str(x), '--end-y', str(y + args.by), '--duration', '4.0', '--steps', '240',
                             '--udid', args.udid], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    sent, during = time.time(), []
    for i, at in enumerate((1.5, 2.5, 3.5)):
        time.sleep(max(0.0, at - (time.time() - sent)))
        during.append(shot(f'during{i}.png'))
    output = drag.communicate()[0].decode().strip()
    time.sleep(1.0)
    after = shot('after.png')

    base = play_centre(*rest, top_px)
    print(f'drag ({x:.0f},{y:.0f}) by {args.by:+.0f} pt: axe rc={drag.returncode} {output.splitlines()[-1] if output else ""}')
    if drag.returncode != 0 or base is None:
        print('BLOCKED: the drag failed or Play was not found at rest')
        return 2
    moved, rows = 0.0, 0
    for i, frame in enumerate(during + [after]):
        centre = play_centre(*frame, top_px)
        changed = changed_rows(rest[0], frame[0], top_px)
        label = f'during{i}' if i < len(during) else 'after'
        print(f'{label}: Play {"not found" if centre is None else f"{centre - base:+.1f} pt"}, '
              f'{len(changed)} panel rows changed' + (f' ({changed[0] / 3:.0f}-{changed[-1] / 3:.0f} pt)' if changed else ''))
        if i < len(during):
            moved = max(moved, abs(centre - base) if centre is not None else float('inf'))
            rows = max(rows, len(changed))
    red = moved > 2 or rows > 3
    print(f'{"RED" if red else "GREEN"}: Play moved up to {moved:.1f} pt, up to {rows} panel rows changed mid-drag')
    return 1 if red else 0


if __name__ == '__main__':
    sys.exit(main())
