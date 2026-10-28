#!/bin/bash
# Run inside ios_guard.py. Resolve OpenReader only inside the explicit simulator,
# then verify its executable path before attaching; never grep all host processes.
set -euo pipefail
if [[ $# -ne 2 || ! -f "$2" ]]; then
  echo 'usage: bash owned-lldb.sh SIMULATOR_UDID COMMANDS.lldb' >&2
  exit 2
fi
UDID=$1
COMMANDS=$2
if [[ ! "$UDID" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]]; then
  echo 'Invalid simulator UDID; refusing attach' >&2
  exit 2
fi
PID=$(xcrun simctl spawn "$UDID" launchctl list | awk '$3 ~ /^UIKitApplication:top\.xujialiu\.openreader\[/ { print $1 }')
if [[ ! "$PID" =~ ^[0-9]+$ || "$PID" == 0 ]]; then
  echo 'No unique running OpenReader PID in this simulator; refusing attach' >&2
  exit 2
fi
BINARY=$(ps -p "$PID" -o comm=)
case "$BINARY" in
  *"/CoreSimulator/Devices/$UDID/"*"/OpenReader.app/OpenReader") ;;
  *) echo "PID $PID does not belong to the required simulator; refusing attach" >&2; exit 2;;
esac
printf 'Validated target UDID=%s PID=%s binary=%s\n' "$UDID" "$PID" "$BINARY"
exec xcrun lldb --batch --attach-pid "$PID" --source "$COMMANDS"
