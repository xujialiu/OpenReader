#!/bin/bash
# EXPERIMENT ONLY: isolated output-driven WSOLA + source-position metadata.
# Usage: native-pull-prototype.sh PCM_DIR RATE TAG [CHAPTER_REPEATS=1] [reset]
# PCM_DIR/source.f32 is private 48 kHz mono float PCM, prepared by native-chapter-input.ts.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "$#" -lt 3 ] || [ "$#" -gt 5 ]; then
  echo 'Usage: native-pull-prototype.sh PCM_DIR RATE TAG [CHAPTER_REPEATS] [reset]' >&2
  exit 2
fi
probe_dir=${OPENREADER_PULL_PROBE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/openreader-pull-prototype.XXXXXX")}
lib=${OPENREADER_AUDIO_SOURCE:-node_modules/react-native-audio-api/common/cpp}
python3 test/manual-test/native-pull-prototype.py "$lib" "$probe_dir"
clang++ -std=c++20 -O2 -DRN_AUDIO_API_TEST=1 -DHAVE_ACCELERATE -framework Accelerate \
  -I "$probe_dir" -I "$lib" test/manual-test/native-pull-prototype.cpp \
  "$probe_dir/audioapi/dsp/WsolaTimeStretcher.cpp" "$lib/audioapi/dsp/VectorMath.cpp" \
  -o "$probe_dir/probe"
"$probe_dir/probe" "$@"
