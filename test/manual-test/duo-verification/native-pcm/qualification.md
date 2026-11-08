# Existing-source PCM observer — qualification gate (#353, #358)

**HOST implementation only, NOT native acceptance.** No Apple-framework build,
Simulator, Mac app, phone, LLDB, GUI, audio or route/volume operation was run to
implement this tool. Parent review and the default ios-tester's single admitted
lane own the next phase. Keep SDK58 and the parent's chosen Beta; this tool does
not change versions or the Settings version format.

## Boundary and loading

`NativePCMObserver.mm` adds one public output tap to bus 0 of the **sole existing
AVAudioSourceNode** in the app's existing AudioEngine. It constructs no engine,
AudioContext, queue, Reading, Worklet, microphone or replacement signal. It
neither plays/pauses nor changes the graph, rate, session, route or volume.
Only the verified iOS 27 selector
`installTapOnBus:bufferSize:format:error:block:` is used, with `format:nil` and
100 ms requested frames derived from the actual bus rate. Returned frame
lengths and format, not that request, determine storage and analysis.

The installer is deliberately **not** a default config plugin/import/package
script. It modifies only a fresh, private external source archive's generated
project, after normal prebuild. A source checkout or its ordinary `ios/` is
refused. Every existing PBX/plist/dependency/Pod write target and source destination
parent is canonicalized and checked for owned external containment, then
revalidated before any write. PBX/plist/source-parent symlink escapes fail before
changing any target file. The archive must be exclusively owned and unchanged
while installing; this preflight is not an adversarial concurrent-path sandbox.
Absent/0 opt-in is a strict no-op. Formal/free Info.plist roles are
refused even with opt-in. The translation unit additionally excludes all body
code unless `TARGET_OS_SIMULATOR && DEBUG && OPENREADER_PCM_TEST_ONLY`; its
`+load` does nothing without a Debug-role receipt and `-ORNativePCMRun TOKEN`.
A Release configuration, physical device or ordinary Debug build cannot arm it.
Do not reuse a diagnostic native product as an ordinary app delivery.

The diagnostic installer also applies `snapshot-accessor.cjs` only to the
external archive's exact-hash-pinned AudioEngine header/source and generated Pod
source build entry. A test-only zeroing-weak publication at normal initialization
allows a retained strong owner load; precise ARC lifetimes keep that owner/mutex
alive through unlock. The accessor retains its AVAudioEngine under the library's
**existing recursive mutex**, exits that scope, then returns.
No naked nonatomic singleton/property acquisition, new lock, private lock
introspection, graph mutation or render hook. ARC is a compile-time requirement.
Only AudioEngine.mm gets the Pod test macro, additionally guarded to Simulator
and Debug. Wrong source/version/layout, shared dependency symlink or missing
Pod source entry fails closed. The checkout's dependency and repository patch
stay byte-identical; never reuse a partially/fully patched diagnostic archive.

The build receipt embeds the exact source revision, tool/playback hashes,
original/patched library header/source hashes, reproducible test-patch hash,
Pod source flags/project hashes, compile gate and opt-in in Info.plist, and
writes before/after generated app project/plist hashes to a private file.
No visible version suffix is added.
The controller writes a ready receipt only for a new token and expires after
120 seconds, including setup. One capture per launch, <=10 seconds capacity,
<=8 seconds bracketed measurement. No persistent service, debugger or arbitrary
JavaScript/native evaluation is introduced. An expired token needs a fresh
paused launch; deleting files does not extend its lifetime.

### Native provenance and build gate — tester only

Read `MEMORY/device-testing.md`, `MEMORY/app-change.md`, the Simulator install
guide and `test/manual-test/kit/ios-verification.md`. Parent must first freeze
the final integrated revision and set the Beta centrally. Inside the one
admitted lane, derive a new private build snapshot, not a sub-worktree:

```sh
# These variables belong to the admitted tester. Do NOT run this beside it.
mkdir -m 700 "$SNAPSHOT"
git archive "$FINAL_SHA" | tar -x -C "$SNAPSHOT"
cd "$SNAPSHOT"
npm ci
EXPO_PUBLIC_OPENREADER_VARIANT=debug npx expo prebuild --platform ios
OPENREADER_NATIVE_PCM_OBSERVER=1 node \
  test/manual-test/duo-verification/native-pcm/install-observer.cjs \
  "$SNAPSHOT" "$FINAL_SHA" "$ATTEMPT/observer-install.json"
```

Use the existing guarded build/install guide with an explicitly selected owned
Simulator, **iOS Simulator SDK27.1**, Debug configuration, fresh external derived
data and correct Metro/variant from this exact snapshot. No concurrent native
build. Keep ordinary and instrumented artifacts separate. The script does not
invoke Xcode, CocoaPods or Simulator tools itself. Verify, do not infer:

1. Installed Audio API is 0.13.5; actual SDK header exposes the BOOL/NSError
   selector. The external test-patched `AudioEngine.h` resolves through normal
   RNAudioAPI headers; AudioEngine.mm compiles with ARC and the source-only test
   macro; the existing class links and responds to `or_pcmTestEngineSnapshot`.
   A missing accessor reports ineligible, never falls back to a naked load.
   Native ARC/weak-owner lifetime, initialization/cleanup and rebuild handling
   need actual qualification, not just host source-contract checks. No fallback
   selector, callback swizzle or permanent production-library edit if this fails.
2. Generated app source build entry points to the copied `.mm`, with only its
   test-only compiler flag; `.hpp` bytes match the receipt. Actual app role is
   Debug. The built app carries the exact diagnostic Info.plist receipt and
   observer class, current native/Settings version and final JS bundle.
3. A separate fresh ordinary build from the same source, **without running the
   installer**, contains no observer class, flag, receipt or polling files.
   Its installed dependency header/source must also keep the unmodified hashes;
   no accessor or weak publication is added without the explicit installer.
   Host source/fixture absence checks are not Mach-O absence proof.
4. A paused fresh diagnostic launch without `-ORNativePCMRun` creates no control
   folder. For the measurement launch use a fresh nonsecret token:
   `simctl launch UDID top.xujialiu.openreader -ORNativePCMRun TOKEN` through the
   normal admitted entry. Record ready PID, token, build receipt and clock.
   Use a real new process, not an already-running launch that cannot run +load.

Preflight Provider, Voice, Consent, actual normal request/result, known cached
real Clip and its real Word Timings **before** that 120-second launch window.
Credentials are loaded later by the tester only from environment/private
`~/.secrets/openreader/`; no values, headers, settings dump or private Document
text go to Git/stdout. The observer never reads them.

## Source attribution and storage

The controller acquires a retained engine only through the external test-build
mutex-protected accessor, never AudioEngine's unguarded nonatomic singleton or
property. It then reads Apple's public `attachedNodes` snapshot, not the library's
mutable dictionaries. The library lock is released before source enumeration,
format reads or any tap API. It rejects
zero or multiple source nodes. Describe retains the precise engine/source/format
in strong ivars across commands and issues a fresh UUID token plus increasing
generation, valid for at most five seconds and one arm. Lifecycle/configuration
observers start before snapshot acquisition; cancellation, expiry, another
describe or shutdown retires the ticket. Arm requires that token/generation and
compares the actual current objects to the retained described objects, not just
address strings. Capture observers overlap ticket consumption so no target
lifecycle event is lost during handover. A retired source cannot be freed and
reallocated at the same address while its description retains it; an old token
cannot arm a replacement after that retention expires.

Arm also requires the described engine/source identity receipts plus
`sole-current-reading-no-other-audio` declaration and a nonsecret Reading token. This declaration is an attribution receipt,
**not independent proof**: the tester must establish the actual held Reading,
its selected Provider/Voice/Clip, and absence of Pronunciation/other app audio.
The source identity is the retained object address, **not** the library's
unread registration UUID. The AVAudioEngine/source objects and bus format are
retained. Public source.engine/attachedNodes/format/running checks at arm,
50 ms polls and disarm plus existing OpenReaderAudioTrace lifecycle and Apple
configuration notifications invalidate collection; no repeated unguarded
library-property polling. Notifications use callback leases too. No choosing a
first ambiguous dictionary element,
node migration, mixer fallback, stop/reset or reconnect. This is pre-mixer,
pre-device-gain output, not the final acoustic/device signal.

`CaptureBuffer.hpp` is shared verbatim by the native callback and portable host
tests. It preallocates actual-rate/channel float PCM (up to 192 kHz, 8 channels,
10 s) plus 4096 metadata records. The callback borrows Apple pointers only while
copying valid frames, preserving every channel to owned interleaved float32.
It records full AVAudioTime validity/sampleTime/sampleRate/hostTime, actual frame
length, cumulative **output-frame** offset and callback-arrival mach time.
The public tap adapter necessarily uses **nine bounded read-only getters**:
`pcm.format`, borrowed `format.streamDescription`, `pcm.frameLength`,
`pcm.audioBufferList`, and the five AVAudioTime validity/time/rate getters.
Expected immutable ASBD scalars are cached before installation; actual format
scalars are checked against them. Getter results/pointers are borrowed only
within the valid callback lifetime, with no owning ARC temporaries, explicit
ownership operations, arbitrary messaging, Objective-C construction/collections,
controller/graph calls, logging, files, JS, locks or waits in the adapter.
The portable C++ append path is separate and has **no Objective-C calls** and no
allocation/lock/wait. The whole callback is **not** claimed to be zero-Objective-C
or measured allocation-free. Actual compiled ARC/getter allocation behavior,
latency, configuration changes and cleanup remain **HOLD** until native
qualification; a private hook is never a fallback.
Raw mach timebase and bracketed wall/host/continuous clock
anchors are exported. `frameOffset / actualSampleRate` is output time, NOT the
content cursor and NOT multiplied by playback rate.

Failure bits, all meaning **incomplete**, not an app audio failure:

| Bit | Reason |
| --- | --- |
| 1 / 2 | PCM capacity / metadata overflow (no partial truncation) |
| 4 / 8 | format changed / missing or invalid timestamp |
| 16 / 32 | sample-time / host-time gap or reversal |
| 64 / 128 | invalid pointer/size/nonfinite PCM / concurrent callback |
| 256 / 512 | source/engine identity changed / active-session volume nonzero |
| 1024 / 2048 / 4096 | uncertain cleanup / 10 s deadline exceeded / engine configuration changed |

Timestamp consistency allows two PCM frames as a disclosed **instrument clock
check**, not a Word Timing tolerance. Sample time must first strictly increase,
independently of that tolerance, including one-/two-frame packets; equal or
reversed sample times reject in both storage and the independent analyser.
Sample-time units use AVAudioTime's own
sample rate; host ticks use the raw timebase. Invalid sample time can occur with
conversion: keep it incomplete; do not substitute a content counter. Polling is
not atomic graph-lifecycle coverage, so native source retirement/coverage and
waveform/timestamp qualification remain necessary.

Disarm atomically stops accepting data and attempts to remove **only a tap whose
install succeeded**, once. Callback leases/shared ownership cover validation and
copy work, including late callbacks. Drain waits off the render thread at most
250 ms for quiescence. Uncertain removal/quiescence retains memory safely and
reports incomplete; it never stops/resets the engine. No data inspection/export
while a writer can mutate it. PCM/checksum/JSON encoding occurs only after stop
and quiescence. The helper retains safe storage for its process lifetime.

## Fixed control and private export API

The tester resolves its exact current data container; do not guess a UUID or
borrow another session's app. Let `DATA`, `RUN`, `OUT` be that private container,
launch token and new external attempt directory. The protocol lives separately
from `harness.json` in
`Library/Application Support/duo-native-pcm/RUN/`. Native accepts only bounded
`describe`, `arm`, `state`, `anchor`, `disarm`, `drain`, `shutdown` JSON commands.
It never accepts file paths or evaluation code. Host sequence persists despite
command deletion. Arm carries the fresh `descriptionToken` and
`descriptionGeneration` from the describe answer automatically; address strings
alone are insufficient. Send arm within the five-second validity window; an
expired/cancelled ticket requires a new describe after reestablishing attribution.
A timeout means **may have executed**: inspect before retry.

```sh
TOOL=test/manual-test/duo-verification/native-pcm
# Only after the tester's normal, silenced real Play: describe must report
# eligible=true, engineRunning=true, active-session volume=0; prove attribution.
python3 "$TOOL/control.py" "$DATA" "$RUN" describe --output "$OUT/describe.json"
python3 "$TOOL/control.py" "$DATA" "$RUN" arm --output "$OUT/arm.json" \
  --description "$OUT/describe.json" --reading-token "$READING_TOKEN" --maximum-seconds 10
python3 "$TOOL/control.py" "$DATA" "$RUN" state --output "$OUT/state-01.json"
python3 "$TOOL/control.py" "$DATA" "$RUN" anchor --label measurement-start \
  --output "$OUT/measurement-start.json"
# For a transition: separate display-start and display-end anchors bracket ONE
# previously calibrated real system input; no debugger/AX/build work during it.
python3 "$TOOL/control.py" "$DATA" "$RUN" anchor --label measurement-end \
  --output "$OUT/measurement-end.json"
python3 "$TOOL/control.py" "$DATA" "$RUN" disarm --output "$OUT/disarm.json"
# Tester confirms real Pause immediately; do not leave speech running to export.
python3 "$TOOL/control.py" "$DATA" "$RUN" drain --output "$OUT/drain.json"
python3 "$TOOL/control.py" "$DATA" "$RUN" shutdown --output "$OUT/shutdown.json"
python3 "$TOOL/control.py" "$DATA" "$RUN" export --output "$OUT/original"
```

Those are API calls, **not an automatic valid choreography**. Require collecting,
zero failure bits and nonzero `observedFrames` before measurement-start. The last
packet's `outputCoverageEndHostTime` must cover measurement-end's complete clock
bracket before disarm. Poll with fresh filenames and a fixed deadline; retain
all answers. Allow only the prequalified actual packet-delivery bound plus a
bounded margin for this tail, within the 10 s capacity (100 ms is a request,
not a delivery guarantee); failure to cover is INCOMPLETE,
not permission to extend playback indefinitely. Derive a <=8 s measurement
from pre-calibrated input/cue/after-word budgets (e.g. a shorter 1–2 s no-change
control first). Do not spend this window writing scripts or waiting on builds.
The tester's existing in-app/host Play watchdog and `finally` Pause own playback;
the observer's deadline **does not pause Reading**. If Pause cannot be confirmed,
stop the owned app through the admitted tester's normal cleanup path.

Drain writes `capture.f32le`, `capture.json`, and preserves exact answers/ready
receipt. Export checks PCM SHA256 and copies to a new private non-Git directory
with hashes in `export.json`; it does not modify native originals. An
`INCOMPLETE` export remains incomplete (nonzero CLI status), even when copying
succeeded. Keep originals read-only. Never replay narration to recover an export.

## Ordered real-audio qualification and analysis

1. Immediately before **each** Play, confirm selected-device semantic Sound 0
   and the fail-closed kit silence check, not merely an old file write. Keep
   the actual UI/plist/session receipts and unchanged host output/route checks.
   The previous 300 zero samples are bounded state history, not today's proof.
2. Capture a known real Clip from the actual Reading at **1x**, no display
   input. Require nonzero narration PCM at active-session volume 0, stable sole
   source/format/engine, complete valid timestamps/measurement coverage, zero
   overflow and confirmed removal/quiescence. Source identity, not playing=true
   or a tone, establishes which graph was observed. Stop dependent cases if any
   control fails.
3. Export the **actual Clip bytes/decoded PCM and real Word Timing arrays consumed
   by this Reading**, with their runtime provenance, then decode that exact Clip
   outside the app to lossless float32 plus a private reference JSON as
   `analyse.py --help` specifies. A saved HTTP-200 response plus timings, matching
   Provider/Voice/text/cache name, or its checksum alone does not establish that
   byte identity. If consumed-source provenance is unavailable, keep native
   qualification HOLD; do not substitute a separately fetched/saved candidate.
   Preserve original Clip, PCM and metadata checksums. Never synthesize a
   substitute Clip/timing source.
   Use host numpy/scipy already available, or an isolated host environment;
   do not upgrade app dependencies.

```sh
python3 "$TOOL/analyse.py" "$OUT/original" "$OUT/reference.json" "$OUT/no-change-analysis.json"
# Choose an actual output-frame point wholly inside measurement, after its
# initial matching anchor. FRAMES >= 40ms; 50ms is a useful declared control.
python3 "$TOOL/qualify_copies.py" "$OUT/original" "$OUT/reference.json" \
  "$OUT/external-controls" --at-output-frame "$FRAME" --frames "$FRAMES"
```

The analyser verifies every timestamp interval and coverage of the entire <=8 s
native measurement bracket, including host-time gaps that concatenated PCM would
hide. It checks all output channels against a known mono/same-channel reference,
resampling the reference to the **actual** tap rate only on the host. Every
40 ms overlapping waveform window at 10 ms hops is independently correlated;
local repeat/skip/progression errors reject, not an aggregate-median/end-count
criterion. Simultaneous channels share a single reference content coordinate:
all channel matches must agree with the common reference-frame anchor within
**two output frames** (reported as `crossChannelToleranceFrames`), an instrument
matching uncertainty, not a speech/Word Timing tolerance. A consistently shifted
right channel cannot establish its own independent passing anchor. Honest
per-channel gain/DC changes are supported. Low energy, competing passages or low
confidence stay explicit INCOMPLETE/REJECT, never silently filled with a source
clock. The 40 ms/10 ms analysis resolution is disclosed, not exact sample or
<100 ms word-sync certification. Packet timestamp gaps use the separate two-frame
instrument bound. `HOST_1X_MATCH` is an analysis result, not native app acceptance.

The external controls preserve original bytes, refresh mutant PCM hashes (so
checksum rejection alone cannot qualify the content oracle), and require removed,
repeated, **equal-frame-count repeat/skip**, and timestamp-only gap copies to be
rejected for the expected reason. Equal-count control must have a local waveform
violation without a timestamp failure. The supplied deterministic host fixtures
qualify those seams only: **not native WSOLA or real speech**. Repeat these
controls on the unmodified native no-change capture before display measurements.
An ambiguous real-Clip result is BLOCKED; do not weaken thresholds to pass it.

4. Only then record one bounded real fold/rotation/permitted system resize,
   paired with real Word Timings, `DuoAcceptanceWordTrace`, active-display
   word painting/CFI/rect evidence and the chosen Line Position as in
   `../duo-acceptance.md` Phase 4. Retain display anchors, actual native-input
   receipts and all clock brackets/uncertainty. Map each waveform match through
   the actual packet containing its output-frame offset: packet hostTime plus
   that packet's relative frames/actual rate, then the native/page clock brackets.
   Neither callback arrival nor a saved provider timing array alone establishes
   the live word/audio alignment. No LLDB attach during audio/AX.
   Establish no-change and mutation controls again after any observer change.
5. This initial analyser **refuses nonunit playback rate**. WSOLA is not bit
   preserving; native nonunit-rate waveform/coverage qualification is a separate
   remaining method gate, not `outputTime * playbackRate`. No clean synthetic
   hash or aggregate median may certify it. PCM alone also does not prove Word
   Timing/paint/Following, paused no-write behavior or Browsing independence.
6. #358 additionally needs admitted actual-session/**post-device-gain output**
   evidence with device Sound 0. Nonzero pre-gain tap PCM plus sampled session
   volume 0 does not certify final attenuation/acoustic silence or a reset cause.
   Use only an independently permitted existing output measurement; if it needs
   new access/instrumentation, stop for a decision. Never raise volume to 60,
   play a tone, mute/re-route the Mac or add microphone capture.

If the public source tap cannot qualify, return CONTROL_INCOMPLETE with exact
SDK/header/install/format/identity/time evidence. A post-render callback hook,
source swizzle, mixer fallback or app harness/config edit is **not** an automatic
repair; request the exact next decision before implementing one.

## Host checks, cleanup and handoff

```sh
bash test/manual-test/duo-verification/native-pcm/run-host-tests.sh
npm run typecheck
npx eslint test/manual-test/duo-verification/native-pcm
node --check test/manual-test/duo-verification/native-pcm/install-observer.cjs
node --check test/manual-test/duo-verification/native-pcm/snapshot-accessor.cjs
bash -n test/manual-test/duo-verification/native-pcm/run-host-tests.sh
```

The runner uses only portable C++ with ASan/UBSan (halt on failure), filesystem
fakes and host waveform tests. It links no Apple framework, emits no audio,
uses no Simulator and cleans its temporary binary. The installed native `.mm`
has **not** been compiled by those checks. The external library accessor has
only exact-source/guard/lock-scope/unchanged-production-byte contracts checked on
the host, not native ARC/lifecycle execution. Actual compilation/link/load,
initial snapshot/ticket ownership and stale-description/lifecycle cancellation,
actual public-getter adapter ARC/compiler/allocation/latency, returned format/time
validity, consumed-real-Clip/Word-Timing provenance and matching at
Sound 0 and teardown remain tester/parent review gates.

In every native finally: confirm Pause, disarm/drain/shutdown, check `ownsTap=false`,
quiescence/export and absence of further controller work, remove only this run's
command after preserving receipts, discard the private diagnostic build, restore
the latest ordinary parent app with playback stopped and the original settings.
Retain failed raw artifacts privately; never reset/stop an engine merely to
clean this observer. Uncertain cleanup means stop the diagnostic attempt and
retain memory/app provenance until the tester safely retires that process.
Record all started PID/port/device/build/control/capture resources. Host
implementation started **none** of the native resources. Parent review accepts
commits; default ios-tester qualifies the integrated candidate; no issue closure
or native PASS follows from code completion.
