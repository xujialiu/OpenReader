#!/bin/bash
# Raises the phone's consent alert, leaves it open for a stated time, answers it,
# and prints what the app did meanwhile: the question takes as long as the owner
# does, and nothing may give up waiting for it (#109, ADR 0064; consent.md,
# "Round 2").
#
#   bash test/manual-test/voices-and-providers/consent-hold.sh SIMULATOR_UDID HOLD_SECONDS ANSWER \
#     [--play] [--voice CHIP ROW] [--fake-log FILE] [--after SECONDS] [--shots DIR]
#
# ANSWER is `Allow` or `Don't Allow`. HOLD_SECONDS counts from the moment the
# alert is first seen, and sampling happens about every ten seconds until then.
#   --play            press the player's Play by a real touch. The reader must
#                     be open and paused on a sentence the Provider has not been
#                     asked about in this process, with the Provider's consent
#                     cleared (`settings` patch), or no question is asked.
#   --voice CHIP ROW  open the voice sheet (`Choose a Voice`), touch the
#                     Provider's chip and then the voice's row: the question a
#                     Reading playing with an allowed Provider raises for a
#                     Provider not yet allowed. With `--play` the Reading is
#                     started first and given 3 s.
#   --fake-log FILE   the fake server's log (`OPENREADER_FAKE_TTS_LOG`): its
#                     `text=` lines are the texts that left the phone, counted
#                     by route. With `Allow` the first new one is waited for.
#   --after SECONDS   how long to watch after the answer (default 12).
#   --shots DIR       half-size screenshots in DIR: `hold-first.png` (the alert
#                     just up), `hold-last.png` (the last moment before the
#                     answer, the alert still up) and `hold-after.png` (after
#                     the watch). They show what the owner sees: a note under
#                     an open alert, or none.
#
# Prints `HOLD …` lines. A Reading is always paused at the end (`pause` through
# the harness), and the simulator's volume is set to zero and checked before
# anything is pressed: a Play of the fake server's zero-valued PCM is silent even
# when a reset puts it back (`pitfalls/simulators.md`), and anything else would
# not be. After the pause a `say` reads the harness's own answer: the Voice and
# the Provider in use, and any note the player shows.
#
# A `--voice` run leaves the voice sheet open: close it with
# `kit/ax.py UDID touch "Close Voice"`.
#
# Needs: Debug Mode (the Debug Log's `[hx] playing=` lines every 5 s), the
# harness, `kit/ax.py` (AXe), and the Mac's `node`. What it cannot prove: what
# the owner sees (take a screenshot beside it), or anything about a question
# asked while the app is away from the screen.
set -euo pipefail
usage='Usage: consent-hold.sh SIMULATOR_UDID HOLD_SECONDS "Allow"|"Don'"'"'t Allow" [--play] [--voice CHIP ROW] [--fake-log FILE] [--after SECONDS] [--shots DIR]'
if [[ $# -lt 3 ]]; then echo "$usage" >&2; exit 2; fi
udid=$1; hold=$2; answer=$3; shift 3
play=no; chip=; row=; fake=; after=12; shots=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --play) play=yes; shift ;;
    --voice) [[ $# -ge 3 ]] || { echo "$usage" >&2; exit 2; }; chip=$2; row=$3; shift 3 ;;
    --fake-log) [[ $# -ge 2 ]] || { echo "$usage" >&2; exit 2; }; fake=$2; shift 2 ;;
    --after) [[ $# -ge 2 ]] || { echo "$usage" >&2; exit 2; }; after=$2; shift 2 ;;
    --shots) [[ $# -ge 2 ]] || { echo "$usage" >&2; exit 2; }; shots=$2; shift 2 ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done
[[ $answer == "Allow" || $answer == "Don't Allow" ]] || { echo "$usage" >&2; exit 2; }
[[ $hold =~ ^[0-9]+$ && $after =~ ^[0-9]+$ ]] || { echo "$usage" >&2; exit 2; }
[[ $play == yes || -n $chip ]] || { echo "Say what raises the question: --play, --voice CHIP ROW, or both." >&2; exit 2; }

kit=$(cd "$(dirname "$0")/../kit" && pwd)
alert_text=$(mktemp)
trap 'rm -f "$alert_text"' EXIT
ax() { python3 "$kit/ax.py" "$udid" "$@"; }
hx() { node "$kit/hx.cjs" "$udid" "$1" >/dev/null; }
now() { date +%H:%M:%S.%N | cut -c1-12; }
container=$(xcrun simctl get_app_container "$udid" top.xujialiu.openreader data)
debug_log() { cat "$container/Library/Application Support/debug-log/"debug-log-*.txt 2>/dev/null || true; }
since_mark() { debug_log | tail -n +$((mark + 1)); }
texts_sent() { if [[ -n $fake ]]; then grep -c 'text=' "$fake" || true; else echo 0; fi; }
new_by_route() { if [[ -n $fake ]]; then grep 'text=' "$fake" | tail -n +$((sent0 + 1)) | grep -o 'route=[a-z]*' | sort | uniq -c | tr '\n' ' '; fi; }
beat() { since_mark | grep '\[hx\] playing=' | tail -1 \
  | sed -E 's/^[0-9-]+ ([0-9:.]+).*playing=([a-z]+) utterance=([0-9a-z]+).*level=([a-z]+|null).*note=(.*)$/\1 playing=\2 utterance=\3 level=\4 note=\5/' || true; }
counts() { echo "no-audio-notes=$(since_mark | grep -c 'no audio within' || true) voice-errors=$(since_mark | grep -c 'voice error' || true) catch-up-errors=$(since_mark | grep -ci 'catch up' || true) texts-sent=$(( $(texts_sent) - sent0 )) by-route: $(new_by_route)"; }
# A half-size screenshot (603x1311), named after the moment.
shot() {
  [[ -n $shots ]] || return 0
  mkdir -p "$shots"
  xcrun simctl io "$udid" screenshot "$shots/hold-$1.full.png" >/dev/null 2>&1 \
    && sips -Z 1311 "$shots/hold-$1.full.png" --out "$shots/hold-$1.png" >/dev/null 2>&1 \
    && rm -f "$shots/hold-$1.full.png" && echo "HOLD shot $shots/hold-$1.png"
}

# A LogBox banner over the player takes the Play touch and opens DevTools on the Mac (pitfalls/mcp.md).
if grep -qi 'open debugger' <<<"$(ax tree)"; then echo "A LogBox banner is over the player: dismiss it with its own close button first." >&2; exit 2; fi
# The volume first: the simulator's own, never the Mac's.
bash "$kit/silence.sh" set "$udid" >/dev/null
bash "$kit/silence.sh" check "$udid"
mark=$(debug_log | wc -l | tr -d ' ')
sent0=$(texts_sent)
echo "HOLD start $(now): hold ${hold}s from the alert, answer '$answer', texts already sent $sent0"

if [[ $play == yes ]]; then
  bash "$kit/silence.sh" check "$udid" && ax touch Play
  [[ -z $chip ]] || sleep 3
fi
if [[ -n $chip ]]; then
  ax touch "Choose a Voice"; sleep 2.4
  ax touch "$chip"; sleep 2.0
  ax touch "$row"
fi

seen=
for _ in $(seq 1 25); do
  if ax alert >"$alert_text" 2>/dev/null; then seen=$(date +%s); echo "HOLD alert first seen $(now)"; sed -n 2,9p "$alert_text"; break; fi
  sleep 0.5
done
if [[ -z $seen ]]; then echo "HOLD no alert appeared: is the recipient's consent cleared, and is the sentence unheard in this process? (consent.md)"; hx '{"do":"pause"}'; exit 1; fi
# The alert is in the tree before it is on the screenshot (pitfalls/screenshots.md).
sleep 1.3; shot first

next=$((seen + 10)); end=$((seen + hold))
while [[ $(date +%s) -lt $end ]]; do
  if [[ $(date +%s) -ge $next ]]; then
    up=$(ax alert >/dev/null 2>&1 && echo up || echo GONE)
    echo "HOLD +$(( $(date +%s) - seen ))s alert=$up beat=\"$(beat)\" $(counts)"
    next=$((next + 10))
  fi
  sleep 1
done
up=$(ax alert >/dev/null 2>&1 && echo up || echo GONE)
echo "HOLD +$(( $(date +%s) - seen ))s alert=$up beat=\"$(beat)\" $(counts)"
shot last

ax alert-touch "$answer"
echo "HOLD answered '$answer' (time above), $(( $(date +%s) - seen ))s after the alert was first seen"

if [[ $answer == "Allow" ]]; then
  # Stop at once: the fact is that the first text leaves after the answer, not before.
  if [[ -n $fake ]]; then
    for _ in $(seq 1 100); do
      if [[ $(texts_sent) -gt $sent0 ]]; then echo "HOLD first text left the phone $(now)"; break; fi
      sleep 0.2
    done
  else
    sleep 3
  fi
else
  sleep "$after"
fi
shot after
hx '{"do":"pause"}'
echo "HOLD pause sent $(now)"
# Two harness commands written back to back run only the second (pitfalls/typing-environment.md): `say` goes out after the pause has been seen.
sleep 3.5
hx '{"do":"say"}'
sleep 3.6
echo "HOLD alert after: $(ax alert 2>/dev/null | head -1 || true)"
echo "HOLD last beat: $(beat)"
echo "HOLD $(counts)"
echo "HOLD the harness's own answer (say):"
since_mark | grep -E '\[hx\] (status|voiceInUse|note attention)' | tail -5 | cut -c1-260 | sed 's/^/HOLD   /'
echo "HOLD Debug Log since the start, without heartbeats, fetches and provider lines:"
since_mark | grep -vE '\[hx\] (playing=|fetch)|\[provider\] ' | cut -c1-200 | head -14 | sed 's/^/HOLD   /'
echo "HOLD done $(now)"
