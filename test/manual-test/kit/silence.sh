#!/bin/bash
# One simulator's own volume, so a Play in a test cannot be heard — without
# touching the Mac's output. The value lives in that device's own file:
#   ~/Library/Developer/CoreSimulator/Devices/UDID/data/var/run/simulatoraudio/audiosettings.plist
# `sim_volume` is the 0-100 scale the phone's volume buttons use, and an app on
# that device reads it back as `AVAudioSession.outputVolume`. A boot rewrites the
# file with the default 60, and an app takes the value when it activates its
# audio session, so: boot, set, then launch the app. See README.md.
set -euo pipefail
if [[ $# -lt 1 || $# -gt 2 || ( $1 != set && $1 != check ) ]]; then
  echo 'Usage: silence.sh set|check [SIMULATOR_UDID]   (the UDID may be omitted only when one simulator is booted)' >&2
  exit 2
fi
mode=$1
booted=$(xcrun simctl list devices booted | sed -n 's/.*(\([0-9A-Fa-f-]\{36\}\)) (Booted).*/\1/p')
if [[ $# -eq 2 ]]; then
  simulator=$2
  if ! grep -qi "^$simulator$" <<<"$booted"; then
    echo "Boot $simulator first: a shut-down device has no audio settings, and a boot resets its volume to 60." >&2
    exit 2
  fi
elif [[ $(wc -l <<<"$booted") -eq 1 && -n $booted ]]; then
  simulator=$booted
else
  echo 'Name the simulator: these are booted:' >&2
  xcrun simctl list devices booted >&2
  exit 2
fi
file=$HOME/Library/Developer/CoreSimulator/Devices/$simulator/data/var/run/simulatoraudio/audiosettings.plist
if [[ ! -f $file ]]; then
  echo "No audio settings for $simulator yet; wait for its boot to finish." >&2
  exit 2
fi
if [[ $mode == set ]]; then
  plutil -replace sim_volume -integer 0 "$file"
fi
volume=$(plutil -extract sim_volume raw -o - "$file")
if [[ $volume != 0 ]]; then
  echo "$simulator is at volume $volume; run 'bash test/manual-test/kit/silence.sh set $simulator', then launch the app again." >&2
  exit 2
fi
echo "$simulator sim_volume=$volume"
