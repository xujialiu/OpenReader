#!/bin/bash
# Run inside ios_guard.py from the authoritative source root (docs/install-on-simulator.md).
set -euo pipefail
if [[ $# != 3 ]]; then
  echo "Usage: $0 SIMULATOR_UDID METRO_PORT ATTEMPT_DIR" >&2
  exit 2
fi
sim=$1
port=$2
attempt=$3
app=top.xujialiu.openreader
metro="http://127.0.0.1:$port"
mkdir -p "$attempt"
run=$(mktemp -d "$attempt/reload.XXXXXX")

# Check the Metro owner and native role before interrupting a running reader.
listener=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | sort -u)
metro_root=$(lsof -a -p "$listener" -d cwd -Fn | sed -n 's/^n//p')
if [[ "$metro_root" != "$(pwd -P)" ]]; then
  echo "Port $port belongs to $metro_root. Run from the source tree served by the target Metro." >&2
  exit 1
fi
device_name=$(xcrun simctl list devices booted -j | jq -er --arg id "$sim" '.devices[][] | select(.udid == $id and .isAvailable) | .name')
shell_path=$(xcrun simctl get_app_container "$sim" "$app" app)
node --require tsx/cjs -e '
  const { APP_VERSION } = require("./src/build/app-version");
  const { buildIdentity } = require("./src/build/build-variant");
  console.log(JSON.stringify({ source: APP_VERSION, ...buildIdentity(APP_VERSION, "debug") }));
' > "$run/identity.json"
plist="$shell_path/Info.plist"
if [[ ! -f "$shell_path/OpenReader.debug.dylib" ||
      "$(/usr/libexec/PlistBuddy -c 'Print OpenReaderBuildVariant' "$plist")" != debug ||
      "$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$plist")" != "$(jq -r .version "$run/identity.json")" ||
      "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$plist")" != "$(jq -r .buildNumber "$run/identity.json")" ]]; then
  echo "Installed shell does not match the Debug identity in $run/identity.json. Use the native installation path." >&2
  exit 1
fi

bundle="$run/index.bundle"
trap 'rm -f "$bundle"' EXIT
curl -fsS --max-time 90 "$metro/index.bundle?platform=ios" -o "$bundle"
if ! grep -Fq "$(jq -r .source "$run/identity.json")" "$bundle"; then
  echo "Metro serves a different Beta. Refresh this source tree's Metro, then retry." >&2
  exit 1
fi
shasum -a 256 "$bundle" | cut -d' ' -f1 > "$run/bundle.sha256"
bash test/manual-test/kit/silence.sh set "$sim"
xcrun simctl launch --terminate-running-process "$sim" "$app" -RCT_jsLocation "127.0.0.1:$port" | tee "$run/launch.txt"

# Registration follows launch asynchronously. Wait for this simulator before the CDP evaluation.
for ((i=0; i<30; i++)); do
  if curl -fsS --max-time 2 "$metro/json/list" > "$run/targets.json" &&
     jq -e --arg device "$device_name" --arg app "$app" 'any(.[]; .appId == $app and .deviceName == $device)' "$run/targets.json" >/dev/null; then
    break
  fi
  sleep 1
done
python3 test/manual-test/kit/ios_ready.py "$sim" "$attempt/readiness" --metro "$metro"
echo "Check Settings for $(jq -r .shownVersion "$run/identity.json"). Launch receipt: $run"
