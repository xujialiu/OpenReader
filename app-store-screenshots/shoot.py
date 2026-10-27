#!/usr/bin/env python3
"""Build the app for the simulator and take OpenReader's App Store screenshots.

  python3 app-store-screenshots/shoot.py build OUT
  python3 app-store-screenshots/shoot.py shoot iphone|ipad --app APP [--out DIR] [--keep]

`build` makes the free role's Release app for the simulator in OUT and prints
its path. It runs `expo prebuild`, which rewrites this checkout's `ios/`.
`shoot` makes a new simulator of the device, installs APP, opens Pride and
Prejudice, reads it aloud with a local fake Kokoro server (silent audio, word
timings, voice "Bella"), and writes four PNGs into DIR (default: this folder's
`iphone/` or `ipad/`):

  1-reading.png   Chapter I, the spoken word highlighted, the player paused
  2-lookup.png    Word Lookup of "acknowledged" (the Free Dictionary API, live)
  3-download.png  the Download drawer with two chapters ticked
  4-library.png   the Library with the book's "Last read" line

Run both under the shared iOS guard (test/manual-test/kit/ios-verification.md);
README.md has the commands. The simulator is deleted afterwards unless --keep.
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
KIT = os.path.join(REPO, 'test', 'manual-test', 'kit')
FAKE_KOKORO = os.path.join(REPO, 'test', 'manual-test', 'player-and-reading-held', 'fake-kokoro.cjs')
BUNDLE = 'top.xujialiu.openreader'
DEFAULT_EPUB = os.path.expanduser('~/Works/epub_books/Pride and Prejudice/Pride and Prejudice.epub')

# The device each set is taken on, and the size App Store Connect asks for.
DEVICES = {
    'iphone': ('com.apple.CoreSimulator.SimDeviceType.iPhone-17', (1206, 2622)),
    'ipad': ('com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB', (2064, 2752)),
}
# Tried in order; each has an entry in the Free Dictionary API.
LOOKUP_WORDS = ('acknowledged', 'universally', 'possession')
CHAPTERS_TO_TICK = ('I hope Mr. Bingley will like it. CHAPTER II.', 'He rode a black horse. CHAPTER III.')


def log(message):
    print(f"{time.strftime('%H:%M:%S')} {message}", flush=True)


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def simctl(*args, **kwargs):
    return run('xcrun', 'simctl', *args, **kwargs)


# ---- build -------------------------------------------------------------------

def role_env(role='free'):
    env = {k: v for k, v in os.environ.items()
           if k not in ('EXPO_PUBLIC_OPENREADER_DEBUG_MODE', 'EXPO_PUBLIC_OPENREADER_UNLOCKED')}
    env.update(EXPO_PUBLIC_OPENREADER_VARIANT=role, EXPO_NO_DOTENV='1')
    return env


def build(out):
    os.makedirs(out, exist_ok=True)
    env = role_env()
    log('prebuild (free role)')
    with open(os.path.join(out, 'prebuild.log'), 'w') as f:
        run('npx', 'expo', 'prebuild', '--platform', 'ios', cwd=REPO, env=env, stdout=f, stderr=subprocess.STDOUT)
    log('xcodebuild Release for the simulator')
    with open(os.path.join(out, 'build.log'), 'w') as f:
        run('xcodebuild', '-workspace', 'ios/OpenReader.xcworkspace', '-scheme', 'OpenReader',
            '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator',
            '-derivedDataPath', os.path.join(out, 'derived'), 'ENABLE_USER_SCRIPT_SANDBOXING=NO', '-quiet', 'build',
            cwd=REPO, env=env, stdout=f, stderr=subprocess.STDOUT)
    app = os.path.join(out, 'derived', 'Build', 'Products', 'Release-iphonesimulator', 'OpenReader.app')
    with open(os.path.join(out, 'verification.json'), 'w') as f:
        run('node', '--require', 'tsx/cjs', 'scripts/verify-build.ts', '--app', app, '--variant', 'free',
            cwd=REPO, stdout=f)
    print(app)


# ---- the simulator's screen --------------------------------------------------

def axe_binary():
    named = os.environ.get('AXE')
    if named and os.path.exists(named):
        return named
    found = glob.glob(os.path.expanduser('~/.npm/_npx/*/node_modules/mobilebuildmcp/bundled/axe'))
    if not found:
        sys.exit('No AXe: set AXE, or run mobilebuildmcp once so npx caches it.')
    return max(found, key=os.path.getmtime)


class Screen:
    def __init__(self, udid):
        self.udid = udid
        self.axe = axe_binary()

    def elements(self):
        """Every element of the accessibility tree, with whether it sits in an alert's Sheet."""
        result = None
        for _ in range(3):
            result = subprocess.run([self.axe, 'describe-ui', '--udid', self.udid],
                                    capture_output=True, text=True, timeout=30)
            if result.returncode == 0:
                break
            time.sleep(3)
        else:
            sys.exit(f'AXe describe-ui failed: {result.stderr.strip()[:400] if result else ""}')
        found = []

        def walk(node, in_sheet):
            if isinstance(node, list):
                for child in node:
                    walk(child, in_sheet)
                return
            if not isinstance(node, dict):
                return
            here = in_sheet or node.get('type') == 'Sheet'
            found.append((node, here))
            for child in node.get('children', []):
                walk(child, here)

        walk(json.loads(result.stdout), False)
        return found

    def find(self, label, prefix=False, kind=None, sheet=False):
        """The centre of the first sized element with this label (or label prefix), a Button first."""
        hits = []
        for node, in_sheet in self.elements():
            text = node.get('AXLabel') or ''
            if not (text.startswith(label) if prefix else text == label) or node.get('type') == 'Heading':
                continue
            if kind and node.get('type') != kind:
                continue
            if sheet and not in_sheet:
                continue
            f = node.get('frame') or {}
            if f.get('width', 0) > 0 and f.get('height', 0) > 0:
                hits.append((node.get('type') != 'Button', f['x'] + f['width'] / 2, f['y'] + f['height'] / 2))
        if not hits:
            return None
        hits.sort(key=lambda hit: hit[0])
        return hits[0][1], hits[0][2]

    def wait(self, label, timeout=30, **kwargs):
        deadline = time.time() + timeout
        while time.time() < deadline:
            at = self.find(label, **kwargs)
            if at:
                return at
            time.sleep(1)
        sys.exit(f"'{label}' did not appear within {timeout} s")

    def touch_at(self, x, y, hold=0.2):
        run(self.axe, 'touch', '-x', f'{x:.1f}', '-y', f'{y:.1f}', '--down', '--up', '--delay', str(hold),
            '--udid', self.udid, stdout=subprocess.DEVNULL)

    def touch(self, label, settle=1.5, timeout=30, **kwargs):
        x, y = self.wait(label, timeout, **kwargs)
        self.touch_at(x, y)
        log(f'touched {label!r}')
        time.sleep(settle)

    def type(self, text):
        run(self.axe, 'type', text, '--udid', self.udid, stdout=subprocess.DEVNULL)

    def key(self, code):
        run(self.axe, 'key', str(code), '--udid', self.udid, stdout=subprocess.DEVNULL)

    def height(self):
        """The screen's height in points."""
        return max(f.get('y', 0) + f.get('height', 0) for f in
                   ((n.get('frame') or {}) for n, _ in self.elements() if n.get('type') == 'Application'))

    def close_drawer(self, name):
        """The iPad's drawers have a Close button; the iPhone's are sheets, closed by dragging the grabber down.
        A drag often leaves the sheet where it was (test/manual-test/pitfalls/screenshots.md), so check, and
        drag again. The drag ends on the screen rather than below it."""
        for _ in range(5):
            if self.find(f'Close {name}'):
                self.touch(f'Close {name}')
            else:
                at = self.find('Sheet Grabber')
                if not at:
                    return
                end = min(at[1] + 450, self.height() - 4)
                run(self.axe, 'swipe', '--start-x', f'{at[0]:.0f}', '--start-y', f'{at[1]:.0f}', '--end-x', f'{at[0]:.0f}',
                    '--end-y', f'{end:.0f}', '--duration', '0.4', '--udid', self.udid, stdout=subprocess.DEVNULL)
                log(f'dragged the {name} drawer down from y {at[1]:.0f} to {end:.0f}')
                time.sleep(1.5)
            if not self.find(f'Close {name}') and not self.find('Sheet Grabber'):
                return
        sys.exit(f'the {name} drawer would not close')

    def open_drawer(self, button, name, expect, settle=1.5):
        """Touch the button that opens a drawer until the element `expect` shows in it."""
        for _ in range(3):
            self.touch(button)
            deadline = time.time() + 8
            while time.time() < deadline:
                if self.find(expect):
                    self.touch(expect, settle=settle)
                    return
                time.sleep(1)
            log(f'{expect!r} did not show; closing the {name} drawer and trying again')
            self.close_drawer(name)
        sys.exit(f'{expect!r} never showed after {button!r}')

    def allow(self, timeout=15):
        """Answer the app's own question (sending text to a service) with Allow."""
        self.touch('Allow', kind='Button', sheet=True, timeout=timeout)

    def shot(self, path):
        simctl('io', self.udid, 'screenshot', '--type=png', path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return path


def png_size(path):
    with open(path, 'rb') as f:
        header = f.read(24)
    return int.from_bytes(header[16:20], 'big'), int.from_bytes(header[20:24], 'big')


def find_word(png, word, finder):
    result = subprocess.run([finder, png, word], capture_output=True, text=True)
    if result.returncode:
        return None
    x, y = result.stdout.split()
    return int(x), int(y)


# ---- shoot -------------------------------------------------------------------

def start_fake_kokoro(work):
    port = 8790 + os.getpid() % 100
    env = dict(os.environ, OPENREADER_FAKE_TTS_LOG=os.path.join(work, 'fake-tts.log'),
               OPENREADER_FAKE_TTS_SECONDS='4', OPENREADER_FAKE_TTS_VOICE_NAME='Bella')
    server = subprocess.Popen(['node', FAKE_KOKORO, str(port)], env=env,
                              stdout=open(os.path.join(work, 'fake-kokoro.out'), 'w'), stderr=subprocess.STDOUT)
    for _ in range(50):
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/v1/audio/voices', timeout=1)
            return server, port
        except OSError:
            time.sleep(0.2)
    server.kill()
    sys.exit('the fake Kokoro server did not start')


def prepare_simulator(device):
    device_type, _ = DEVICES[device]
    udid = subprocess.run(['xcrun', 'simctl', 'create', f'OpenReader screenshots {device}', device_type],
                          check=True, capture_output=True, text=True).stdout.strip()
    log(f'created simulator {udid}')
    simctl('boot', udid)
    simctl('bootstatus', udid, '-b', stdout=subprocess.DEVNULL)
    # US English, so the status bar reads "9:41" rather than the Mac region's "09:41";
    # the setting takes hold at the next boot.
    simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleLocale', '-string', 'en_US')
    simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleLanguages', '-array', 'en-US')
    simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleICUForce12HourTime', '-bool', 'true')
    simctl('spawn', udid, 'defaults', 'write', '-g', 'AppleICUForce24HourTime', '-bool', 'false')  # copied from the Mac
    simctl('shutdown', udid)
    simctl('boot', udid)
    simctl('bootstatus', udid, '-b', stdout=subprocess.DEVNULL)
    run('bash', os.path.join(KIT, 'silence.sh'), 'set', udid)  # after the last boot, which resets it
    simctl('ui', udid, 'appearance', 'dark')
    simctl('status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active',
           '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4',
           '--batteryState', 'discharging', '--batteryLevel', '100')
    return udid


def full_screen_apps(screen):
    """iPadOS starts in Windowed Apps, which draws a resize handle in the corner of every app."""
    simctl('launch', screen.udid, 'com.apple.Preferences', stdout=subprocess.DEVNULL)
    screen.touch('Multitasking & Gestures', timeout=30)
    screen.touch('Full Screen Apps', prefix=True)
    simctl('terminate', screen.udid, 'com.apple.Preferences')


def set_up_kokoro(screen, port):
    screen.touch('Settings')
    screen.touch('Providers', prefix=True)
    screen.touch('Kokoro FastAPI', prefix=True)
    screen.touch('Address', kind='TextField', settle=1)
    if screen.find('Clear text'):
        screen.touch('Clear text', settle=0.5)
    screen.type(f'http://127.0.0.1:{port}')
    screen.key(40)
    time.sleep(1)
    screen.touch('Enable Kokoro FastAPI', settle=1)
    screen.wait('Connection successful', timeout=20)
    for _ in range(3):
        screen.touch('Back')


def shoot(device, app, epub, out, keep):
    _, expected = DEVICES[device]
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp(prefix=f'openreader-screenshots-{device}-')
    log(f'work directory {work}')
    finder = os.path.join(work, 'find-word')
    run('swiftc', '-O', os.path.join(HERE, 'find-word.swift'), '-o', finder)
    book = os.path.join(work, os.path.basename(epub))
    shutil.copyfile(epub, book)  # the app is handed a copy; the original is never opened
    server, port = start_fake_kokoro(work)
    udid = prepare_simulator(device)
    screen = Screen(udid)
    try:
        if device == 'ipad':
            full_screen_apps(screen)
        simctl('install', udid, app)
        simctl('launch', udid, BUNDLE, stdout=subprocess.DEVNULL)
        screen.wait('Settings', timeout=60)

        set_up_kokoro(screen, port)

        simctl('openurl', udid, 'file://' + urllib.parse.quote(book))
        screen.wait('Choose a Voice', timeout=60)
        time.sleep(3)
        screen.open_drawer('Choose a Voice', 'Voice', 'Voice')
        screen.touch('Bella', settle=2)
        screen.close_drawer('Voice')
        screen.open_drawer('Contents', 'Contents', 'Chapter I.', settle=8)  # the page reflows for seconds

        log('1-reading: play from the heading, pause on a word of the first sentence')
        screen.touch('Play', settle=0.5)
        screen.allow()
        time.sleep(4.2)  # the heading's 4 s clip at 1.5x, then about half of the first sentence
        screen.touch('Pause', settle=1.5)
        screen.shot(os.path.join(out, '1-reading.png'))

        log('3-download: tick two chapters')
        screen.open_drawer('More actions', 'Pride and Prejudice', 'Download', settle=2)
        for row in CHAPTERS_TO_TICK:
            screen.touch(row, settle=0.8)
        time.sleep(1)
        screen.shot(os.path.join(out, '3-download.png'))
        screen.close_drawer('Download')

        log('2-lookup: long-press a word')
        probe = screen.shot(os.path.join(work, 'probe.png'))
        width_points = max(f.get('x', 0) + f.get('width', 0) for f in
                           ((n.get('frame') or {}) for n, _ in screen.elements() if n.get('type') == 'Application'))
        scale = png_size(probe)[0] / width_points
        for word in LOOKUP_WORDS:
            at = find_word(probe, word, finder)
            if at:
                break
        else:
            sys.exit(f'none of {LOOKUP_WORDS} is on the page')
        screen.touch_at(at[0] / scale, at[1] / scale, hold=1.0)
        log(f'long-pressed {word!r}')
        screen.allow()
        screen.wait('Copy result', timeout=20)
        time.sleep(3)
        screen.shot(os.path.join(out, '2-lookup.png'))
        screen.close_drawer('Lookup')

        log('4-library')
        screen.touch('Back', settle=2)
        screen.shot(os.path.join(out, '4-library.png'))

        for name in ('1-reading', '2-lookup', '3-download', '4-library'):
            size = png_size(os.path.join(out, f'{name}.png'))
            if size != expected:
                sys.exit(f'{name}.png is {size[0]}x{size[1]}, not {expected[0]}x{expected[1]}')
        log(f'four screenshots in {out}')
    finally:
        server.terminate()
        subprocess.run(['xcrun', 'simctl', 'terminate', udid, BUNDLE], capture_output=True)
        if keep:
            log(f'kept simulator {udid}')
        else:
            subprocess.run(['xcrun', 'simctl', 'shutdown', udid], capture_output=True)
            subprocess.run(['xcrun', 'simctl', 'delete', udid], capture_output=True)
            log(f'deleted simulator {udid}')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build')
    b.add_argument('out')
    s = sub.add_parser('shoot')
    s.add_argument('device', choices=sorted(DEVICES))
    s.add_argument('--app', required=True)
    s.add_argument('--epub', default=DEFAULT_EPUB)
    s.add_argument('--out')
    s.add_argument('--keep', action='store_true')
    args = parser.parse_args()
    if args.command == 'build':
        build(os.path.abspath(args.out))
    else:
        shoot(args.device, os.path.abspath(args.app), args.epub,
              os.path.abspath(args.out or os.path.join(HERE, args.device)), args.keep)


if __name__ == '__main__':
    main()
