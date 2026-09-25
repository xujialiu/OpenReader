#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
lib=node_modules/react-native-audio-api/common/cpp
out=${OPENREADER_QUEUE_TEST_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/openreader-queue-test.XXXXXX")}
mkdir -p "$out"
clang++ -std=c++20 -O2 -DRN_AUDIO_API_TEST=1 -DHAVE_ACCELERATE -framework Accelerate \
 -I test/native-audio/stubs -I "$lib" test/native-audio/queue.cpp \
 "$lib/audioapi/core/sources/AudioBufferQueueSourceNode.cpp" \
 "$lib/audioapi/core/utils/buffer/BufferProcessorBase.cpp" "$lib/audioapi/core/utils/buffer/QueueBufferProcessor.cpp" \
 "$lib/audioapi/dsp/WsolaTimeStretcher.cpp" "$lib/audioapi/dsp/VectorMath.cpp" -o "$out/probe"
"$out/probe" "$@"
