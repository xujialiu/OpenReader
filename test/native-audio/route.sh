#!/bin/bash
# No devices, provider requests or audible output. See native-audio/route-loss.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
out=${OPENREADER_ROUTE_TEST_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/openreader-route-test.XXXXXX")}
python3 test/native-audio/route-probe.py "$out"
lib=node_modules/react-native-audio-api/common/cpp
clang++ -std=c++20 -O2 -fobjc-arc -DRN_AUDIO_API_TEST=1 -DHAVE_ACCELERATE \
 -framework Foundation -framework Accelerate -I "$out/stubs" -I "$lib" "$out/probe.mm" \
 "$lib/audioapi/core/sources/AudioBufferQueueSourceNode.cpp" \
 "$lib/audioapi/core/utils/buffer/BufferProcessorBase.cpp" \
 "$lib/audioapi/core/utils/buffer/QueueBufferProcessor.cpp" \
 "$lib/audioapi/dsp/WsolaTimeStretcher.cpp" "$lib/audioapi/dsp/VectorMath.cpp" -o "$out/probe"
for mode in baseline immediate-js no-route interruption; do "$out/probe" "$mode"; done
