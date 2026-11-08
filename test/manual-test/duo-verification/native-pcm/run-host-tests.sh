#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
area=test/manual-test/duo-verification/native-pcm
out=$(mktemp -d "${TMPDIR:-/tmp}/openreader-pcm-host.XXXXXX")
trap 'rm -rf "$out"' EXIT
export PYTHONDONTWRITEBYTECODE=1
export UBSAN_OPTIONS=halt_on_error=1
export ASAN_OPTIONS=halt_on_error=1
# Pure portable C++, not the production native queue runner (that runner links
# Accelerate). No Apple frameworks, simulator, app build, audio or native tool.
clang++ -std=c++17 -O1 -g -Wall -Wextra -Werror -pthread \
  -fsanitize=address,undefined -fno-omit-frame-pointer \
  "$area/CaptureBufferTest.cpp" -o "$out/capture-test"
"$out/capture-test"
python3 "$area/control_test.py"
python3 "$area/analyse_test.py"
npx vitest run "$area/install-observer.test.ts"
