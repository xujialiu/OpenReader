#!/bin/bash
# Compile the installed production render methods with the real native DSP.
# Artifacts stay outside the repository; no device, credential or speaker is used.
set -euo pipefail
cd "$(dirname "$0")/../.."
probe_dir=${OPENREADER_NATIVE_PROBE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/openreader-native-drift.XXXXXX")}
mkdir -p "$probe_dir"
lib=${OPENREADER_AUDIO_SOURCE:-node_modules/react-native-audio-api/common/cpp}
if rg -q 'outputDriven_' "$lib/audioapi/core/sources/AudioBufferQueueSourceNode.h"; then
  echo 'Use test/native-audio/run.sh for the patched queue; OPENREADER_AUDIO_SOURCE can select pristine 0.13.5 for this baseline probe.' >&2
  exit 2
fi
python3 - "$lib" "$probe_dir/production.inc" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])/'audioapi/core/sources'
methods=[('AudioBufferBaseSourceNode','void','processWithPitchCorrection'),
 ('AudioBufferBaseSourceNode','void','resetPitchCorrection'),
 ('AudioBufferQueueSourceNode','void','runBufferProcessor'),
 ('AudioBufferQueueSourceNode','double','getCurrentPosition'),
 ('AudioBufferQueueSourceNode','void','clearBuffers')]
chunks=[]
for cls,ret,name in methods:
    source=(root/(cls+'.cpp')).read_text()
    signature=ret+' '+cls+'::'+name+'('
    if name == 'resetPitchCorrection' and signature not in source:
        continue  # Absent in the unpatched baseline.
    start=source.index(signature)
    opening=source.index('{',start)
    depth=1;end=opening+1
    while depth:
        depth += (source[end]=='{')-(source[end]=='}');end+=1
    chunks.append(source[start:end].replace(cls+'::','Node::',1))
Path(sys.argv[2]).write_text('\n\n'.join(chunks)+'\n')
PY
clang++ -std=c++20 -O2 -DRN_AUDIO_API_TEST=1 -DHAVE_ACCELERATE -framework Accelerate \
  -I "$lib" -I "$probe_dir" test/manual-test/native-queue-drift.cpp \
  "$lib/audioapi/core/utils/buffer/BufferProcessorBase.cpp" \
  "$lib/audioapi/core/utils/buffer/QueueBufferProcessor.cpp" \
  "$lib/audioapi/dsp/WsolaTimeStretcher.cpp" "$lib/audioapi/dsp/VectorMath.cpp" \
  -o "$probe_dir/probe"
"$probe_dir/probe" "$@"
