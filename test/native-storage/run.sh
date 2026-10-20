#!/usr/bin/env bash
# Run the actual native atomic replacement against disposable host files.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/openreader-native-storage.XXXXXX")"
trap 'rm -rf "$work"' EXIT
swiftc -o "$work/atomic-file" \
  "$root/modules/open-reader-offline/ios/AtomicFile.swift" \
  "$root/test/native-storage/atomic-file.swift"
"$work/atomic-file"
