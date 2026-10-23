#!/bin/bash
# Plants, shows or removes the app's own purchase record in a simulator's
# container, for the legacy-record checks of #316 (beta7-unscoped-unlock.md).
# The file is `Library/Application Support/purchase.json`, which only a build
# asking StoreKit reads (a Debug build after {"do":"store","use":"real"}).
#
#   bash test/manual-test/purchase/plant-record.sh SIMULATOR_UDID unscoped|v2|show|remove
#
#   unscoped  exactly the bytes 1.0.0 (7) wrote for a buyer, no newline:
#             {"unlocked":true,"trialStartedAt":null}
#   v2        a version-2 envelope holding a `production` Unlock of a made-up
#             appTransactionId (a control: it shows the file is read at launch)
#   show      size, SHA-256, modification time and the bytes of what is there
#   remove    deletes the file
#
# The app must not be running: a running app can write the file itself, and a
# plant it then overwrites proves nothing. Terminate it first
# (`xcrun simctl terminate UDID top.xujialiu.openreader`). The script refuses
# otherwise, and prints the hash it planted so a later `show` can be compared.
set -euo pipefail
if [[ $# -ne 2 || ! $2 =~ ^(unscoped|v2|show|remove)$ ]]; then
  echo 'Usage: plant-record.sh SIMULATOR_UDID unscoped|v2|show|remove' >&2
  exit 2
fi
udid=$1
mode=$2
bundle=top.xujialiu.openreader
data=$(xcrun simctl get_app_container "$udid" "$bundle" data)
folder="$data/Library/Application Support"
file="$folder/purchase.json"
if xcrun simctl spawn "$udid" launchctl list 2>/dev/null | grep -q "UIKitApplication:$bundle"; then
  if [[ $mode != show ]]; then
    echo "$bundle is running on $udid; terminate it first." >&2
    exit 3
  fi
fi
describe() {
  if [[ ! -f $file ]]; then echo "purchase.json: absent"; return; fi
  printf 'purchase.json: %s bytes, sha256 %s, modified %s\n' \
    "$(stat -f %z "$file")" "$(shasum -a 256 "$file" | cut -d' ' -f1)" "$(stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' "$file")"
  printf 'bytes: '; cat "$file"; echo
}
case $mode in
  unscoped)
    mkdir -p "$folder"
    printf '%s' '{"unlocked":true,"trialStartedAt":null}' > "$file"
    echo planted; describe ;;
  v2)
    mkdir -p "$folder"
    printf '%s' '{"version":2,"records":[{"version":2,"source":{"environment":"production","appTransactionId":"planted-control"},"record":{"unlocked":true,"trialStartedAt":null}}]}' > "$file"
    echo planted; describe ;;
  remove) rm -f "$file"; echo removed; describe ;;
  show) describe ;;
esac
