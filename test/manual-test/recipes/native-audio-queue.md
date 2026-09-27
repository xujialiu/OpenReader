# Native audio queue (#63)

## Native queue position versus actual rendered audio (#63)

On macOS with Xcode command-line tools and installed dependencies:

```sh
bash test/manual-test/native-queue-drift.sh 1.55 60 download
bash test/manual-test/native-queue-drift.sh 1.55 10 clear
bash test/manual-test/native-queue-drift.sh 1.50 60 download
```

The unpatched 0.13.5 baseline is expected to report RED for the 1.55× and
clear cases. No production repair has been accepted yet; the owner requested a
joint decision after diagnosis. The 1.50× run is a control.

These render deterministic alternating tones through the real native queue
processor and WSOLA, with production processing/position/clear methods extracted
from the installed library. No speaker, simulator, credentials or provider
requests are used. `download` asserts that median audio-versus-reported boundary
lead grows by less than 100 ms between the first and last samples. `clear` asserts
that seeking discards both input and output retained by the stretcher. Exit 0 is
GREEN, 1 is RED and 2 is invalid fixture/input. Build artifacts stay in a temporary
directory; `OPENREADER_NATIVE_PROBE_DIR` can select an external directory for
reusing its compiled `probe`. Optional positional sample rate defaults to 48000.
The second argument is **rendered audio duration**, not wall-clock waiting.

This is a native algorithm test, not an iOS audio-route or WebView test. The
session, graph ownership and callback delivery are test adapters; the signal
processing is production code. Fixed output latency is not treated as drift.
The optional `stream` mode inserts queue drains and is exploratory, not a claim
that real provider response timing was reproduced.

For an entire private chapter, prepare an external directory containing
`texts.json` (ordered speakable Utterances), numbered `0.mp3` / `0.json` pairs
(with the provider's `timestamps`), and a separate JSON file of renderer-extracted
Blocks spanning that chapter. `ffmpeg` decodes; book content stays outside Git:

```sh
npx tsx test/manual-test/native-chapter-input.ts OUT_DIR BLOCKS_JSON
bash test/manual-test/native-queue-drift.sh render 1.55 OUT_DIR production155
uv run --with numpy --with scipy python test/manual-test/native-audio-match.py OUT_DIR production155 1.55
```

Preparation uses the real segmenter, buffer cuts and default sentence/paragraph
pauses; the fixture must match that segmentation. The render consumes the entire
chapter and writes 48 kHz mono float PCM plus source positions. Matching compares
actual output PCM with source PCM at >=0.90 normalized waveform correlation and
requires enough matches near the beginning, middle and end. It asserts <100 ms
change in median lead between the first and last windows. The optional matcher
source-bias argument is for controlled seek/replay experiments; leave it zero for
a fresh node. This measures native rendered content independently of its reported
clock, but cannot establish physical AirPods output latency, the owner's original
trigger, or what the WebView painted.

## Output-driven audio/position prototype (#63, validation only)

This isolated prototype asks for input only when the real WSOLA output iteration
needs more samples. Source positions follow the same window/transition weights
as the audio and travel alongside its output queue. The position is read when
those samples leave that queue, rather than when input is consumed. It modifies
only a generated copy in an external build directory; it does **not** patch
`node_modules`, change the app, or establish a production decision.

Use the same external chapter PCM fixture as the native baseline above:

```sh
bash test/manual-test/native-pull-prototype.sh OUT_DIR 1.55 pull155
uv run --with numpy --with scipy python test/manual-test/native-audio-match.py OUT_DIR pull155 1.55
bash test/manual-test/native-pull-prototype.sh OUT_DIR 1.55 pull155-long 35
uv run --with numpy --with scipy python test/manual-test/native-long-match.py OUT_DIR pull155-long 1.55
bash test/manual-test/native-pull-prototype.sh OUT_DIR 1.55 pull155-reset 35 reset
uv run --with numpy --with scipy python test/manual-test/native-long-match.py OUT_DIR pull155-reset 1.55
```

`35` repeats the **same complete chapter**, giving about 2 h 3 min of output at
1.55× for the measured fixture. Rendering runs faster than real time; it is not
a two-hour device session. Long runs save one 10 ms PCM sample per second and its
reported source position, instead of gigabytes of continuous output. The long
matcher independently searches the original PCM, including wraps between
repetitions, and requires <10 ms median start/end growth and <10 ms absolute
error at the 95th percentile of accepted acoustic matches.

Without `reset` the stream is uninterrupted. With `reset`, the previous chapter
is rendered through its end with a 50 ms source-position margin before the
stretcher is discarded, then another 50 ms of output silence is inserted. The
combined extra separation at 1.55× was about 0.1 s per boundary. Waiting alone
would not discard queued audio. `PULL_SAVE_FULL=1` also saves continuous PCM for
multi-chapter runs, including the explicit silence; leave it unset for long runs.
`OPENREADER_PULL_PROBE_DIR` selects an external build directory whose `probe` can
be reused without recompiling. A source hash guards the transformation against
an unreviewed WSOLA revision.

Source-position metadata describes an overlap of windows, not a unique original
sample: the same coefficients give a weighted position. The probe also reports
the widest source-coordinate span contributing to any output frame. At 1.55×
over 35 repetitions that span was at most 26.44 ms in heard-time units; input
storage peaked at 6,623 frames and output storage at 448, both independent of
session length in the measured run. This is distinct from timing the actual
speaker/headphones or scheduling highlights in a WebView.

Waveform matching has limits. A 10 ms vowel can resemble another nearby vowel;
a high correlation alone does not make every point unambiguous. Inspect the
accepted counts and full error distribution, not only medians. Near-silent
source windows are explicitly excluded: cancellation in the energy calculation
and FFT roundoff had otherwise produced impossible correlation values >1.
The corrected calculation leaves the chapter's measured growth unchanged.

## Production output-driven queue (#63)

After dependencies and their patch-package patches are installed:

```sh
bash test/native-audio/run.sh
bash test/native-audio/run.sh render 1.55 OUT_DIR queue155
uv run --with numpy --with scipy python test/manual-test/native-audio-match.py OUT_DIR queue155 1.55
bash test/native-audio/run.sh long 1.55 OUT_DIR 35 queue155-long
uv run --with numpy --with scipy python test/manual-test/native-long-match.py OUT_DIR queue155-long 1.55
```

This compiles the **actual production AudioBufferQueueSourceNode.cpp**, queue
processor and WSOLA; host adapters replace session/scheduling/event delivery and
graph ownership only. The default lifecycle check covers pause/resume, seek,
source endpoints, complete tail output, partially and fully pre-read removals,
new input arriving during starvation flush, and rate changes. `render` uses the
private chapter fixture above; `long` repeats it with a bounded 64-buffer feed,
checks every end callback and exact final content duration, and saves independent
waveform samples. `OPENREADER_QUEUE_TEST_DIR` selects an external build directory
for reuse. These checks supplement iOS verification; they do not emulate its
thread scheduling, Bluetooth latency, UI or background lifecycle.

The earlier `native-queue-drift.sh` and `native-pull-prototype.sh` are historical
baseline/prototype comparisons. On a patched install, select a pristine 0.13.5
source tree with `OPENREADER_AUDIO_SOURCE=/external/package/common/cpp`; obtain
that tree from the exact published npm archive. They must not silently measure
one implementation while claiming to measure the other. The production regression
command is `test/native-audio/run.sh`.
