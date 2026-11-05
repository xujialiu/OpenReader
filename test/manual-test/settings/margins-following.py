#!/usr/bin/env python3
"""Bounded silent Following through one native handle drag (#344).

Run inside ios_guard.py after the recipe's working-provider/Consent control.
A Document must be open and paused; --seconds derives from the transition,
not a long-running endurance test. Settings/provider configuration is untouched.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
PLAYER = """(() => {let p;function walk(f){if(!f)return;if(f.type?.name==='Player')p=f.memoizedProps;walk(f.child);walk(f.sibling);}
const h=__REACT_DEVTOOLS_GLOBAL_HOOK__;for(const id of h.renderers.keys())for(const r of h.getFiberRoots(id))walk(r.current);
if(!p)throw Error('No Player');return {playing:p.playing,following:p.following,enabled:p.enabled};})()"""
ARM = """
var R=window.__marginRun={frames:[],cues:[],original:window.__openReaderHighlighter};
window.__openReaderHighlighter=function(m){if(m.kind==='speak')R.cues.push({time:Date.now(),utterance:m.utterance});return R.original(m);};
R.timer=setInterval(function(){
 var f={time:Date.now(),width:window.innerWidth,height:window.innerHeight,lit:[]};
 rendition.manager.views._views.forEach(function(v){
  if(!v.displayed||!v.contents)return;
  var w=v.contents.window,d=v.contents.document,frame=v.iframe.getBoundingClientRect();
  w.CSS.highlights.forEach(function(h,name){
   var range=null;h.forEach(function(r){if(!range)range=r;});if(!range)return;
   var rect=range.getBoundingClientRect(),css=w.getComputedStyle(d.body);
   f.lit.push({name:name,top:frame.top+rect.top,bottom:frame.top+rect.bottom,width:frame.width,padding:parseFloat(css.paddingLeft)});
  });
 });R.frames.push(f);
},100);return {width:window.innerWidth};
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('device')
    parser.add_argument('output', type=Path)
    parser.add_argument('--metro', required=True)
    parser.add_argument('--axe', required=True)
    parser.add_argument('--before-width', type=int, required=True)
    parser.add_argument('--after-width', type=int, required=True)
    parser.add_argument('--percent', type=int, required=True)
    parser.add_argument('--seconds', type=int, default=8, choices=range(5, 11))
    parser.add_argument('--drag', nargs=4, type=int, required=True)
    args = parser.parse_args()
    if not 0 <= args.percent <= 25 or min(args.before_width, args.after_width) <= 0:
        parser.error('Invalid viewport/percentage')
    args.output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, OPENREADER_METRO=args.metro)

    def run(*command):
        return subprocess.check_output(command, cwd=ROOT, text=True, timeout=20, env=env)

    data = Path(run('xcrun', 'simctl', 'get_app_container', args.device, 'top.xujialiu.openreader', 'data').strip())
    logs = data / 'Library/Application Support/debug-log'
    state_file = args.output / 'player-state.js'
    state_file.write_text(PLAYER)

    def state():
        return json.loads(run('node', 'test/manual-test/kit/cdp.cjs', '--eval', str(state_file), args.metro))['value']

    def probe(code):
        token = 'MF344-' + uuid.uuid4().hex
        body = {'seq': time.time_ns() // 1000000, 'do': 'js', 'code': 'return ' + json.dumps(token + ' ') + '+JSON.stringify((function(){' + code + '})());'}
        run('node', 'test/manual-test/kit/hx.cjs', args.device, json.dumps(body))
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            for file in sorted(logs.glob('debug-log-*.txt'), reverse=True):
                for line in reversed(file.read_text().splitlines()):
                    if '[probe] ' + token + ' ' in line:
                        return json.loads(line.split(token + ' ', 1)[1])
            time.sleep(.1)
        raise RuntimeError('Missing tagged probe')

    before = state()
    assert before['playing'] is False and before['enabled'], 'Require a paused working control'
    appearance = json.loads((data / 'Documents/settings.json').read_text())['settings']['appearance']
    assert appearance.get('marginsUnit') == 'percent' and appearance['margins'] == args.percent
    assert probe(ARM)['width'] == args.before_width
    play = None
    try:
        run('bash', 'test/manual-test/kit/silence.sh', 'set', args.device)
        began = int(time.time() * 1000)
        with (args.output / 'play.log').open('w') as stream:
            play = subprocess.Popen(['node', 'test/manual-test/kit/reading.cjs', 'play-for', str(args.seconds), args.device],
                                    cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT, env=env)
            time.sleep(2)
            current = state()  # Separate local expression; never deletes play-for's global helper.
            assert current['playing'] and current['following'], 'Following not established before resize'
            x, y, to_x, to_y = args.drag
            run(args.axe, 'drag', '--udid', args.device, '--start-x', str(x), '--start-y', str(y),
                '--end-x', str(to_x), '--end-y', str(to_y), '--duration', '1')
            assert play.wait(timeout=15) == 0, 'Bounded Play failed'
        ended = int(time.time() * 1000)
        # Debug Log lines truncate at 2 KB: aggregate on the page, not after printing raw frames.
        summary = probe("var r=window.__marginRun;var fs=r.frames.filter(f=>f.time>=" + str(began) + "&&f.time<=" + str(ended) + ");" +
                        "var a=fs.filter(f=>f.width===" + str(args.before_width) + "&&f.lit.length);" +
                        "var b=fs.filter(f=>f.width===" + str(args.after_width) + "&&f.lit.some(l=>l.width===" + str(args.after_width) +
                        "&&Math.abs(l.padding-" + str(args.after_width * args.percent / 100) + ")<.1&&l.bottom>0&&l.top<f.height));" +
                        "return {wideHighlightedFrames:a.length,narrowHighlightedFrames:b.length,cues:r.cues.map(c=>c.utterance),lastNarrow:b[b.length-1]};")
        (args.output / 'summary.json').write_text(json.dumps(summary, indent=2))
        cues = summary['cues']
        assert summary['wideHighlightedFrames'] > 2 and summary['narrowHighlightedFrames'] > 2, 'Highlight/geometry evidence missing'
        assert len(set(cues)) >= 2 and all(a <= b for a, b in zip(cues, cues[1:])), 'Non-monotone or absent progression'
        assert not state()['playing'], 'Playback did not stop'
        print(json.dumps({'verdict': 'PASS', 'playSeconds': args.seconds, **summary}))
    finally:
        run('node', 'test/manual-test/kit/reading.cjs', 'pause')
        if play and play.poll() is None:
            play.terminate()
            play.wait(timeout=5)
        probe('var r=window.__marginRun;if(r){clearInterval(r.timer);window.__openReaderHighlighter=r.original;delete window.__marginRun;}return "cleaned";')
        (data / 'Documents/harness.json').unlink(missing_ok=True)


if __name__ == '__main__':
    main()
