---
status: accepted
---

# Native audio contexts do not create unused workers

Issue #333. Narration and Pronunciation use native Audio API nodes, not
Worklet nodes. Both now create contexts through `createNativeAudioContext`,
which explicitly disables the optional per-context worker. The pinned Audio
API patch adds `enableWorklets?: boolean`, defaulting to upstream behavior;
false passes null to the native constructor, a branch it already supports.
No native decoding, scheduling, time-stretching or route behavior changes.

## Evidence and boundary

The physical standalone beta10 crash was EXC_BAD_ACCESS at zero on the
JavaScript thread, through `jsi::Value::~Value`,
`SerializableObject::toJSValue`, `SerializableWorklet::toJSValue` and
`RuntimeManager::createWorkletRuntime`. Audio API unconditionally allocates
that worker for each context when its optional Worklets dependency is present,
even when no Worklet node is ever created. Repository searches find no such
node use in the app; the only context constructors belong to narration and
pronunciation. The actual intermediate memory fault has not been reproduced
or repaired inside Worklets. This change eliminates an unused crashing path
from the two app operations; it is not a claim to repair every Worklets fault.

A test executes the actual patched constructor: before the opt-out, ten
native-only context lifecycles still allocate ten workers; afterwards they
allocate zero and pass null, with unchanged default behavior and sample-rate
validation. The shared factory and real pronunciation call site are tested,
and narration's engine fake rejects construction without the opt-out.

An owned-simulator native probe exercises real app graph creation, decoding,
queueing, rate changes, pause/resume, end/position callbacks and disposal,
plus actual pronunciation graphs using a generated silent WAV. Its default
constructor control creates one worker, proving the allocation counter. The
app paths then create thirteen contexts and zero workers, with ten completed
queues, a position callback and three completed pronunciations. This is a
native lifecycle check, not physical-device acceptance or proof of the
unidentified upstream fault's exact cause. The final Release artifact verifier
confirms the current embedded bundle, role and native identity; its UI smoke
checks pass. The thirteen-context allocation measurement is on Debug, not a
separately instrumented Release run. The app's two native-node call sites no
longer enter the per-context worker-creation path.

## Alternatives and consequence

Removing Worklets from the entire dependency graph would also change Expo's
optional integration and bundling. Upgrading SDK/runtime libraries based only
on similar upstream stacks risks unrelated changes without a reproduction.
Keeping unused workers and retrying after a native segmentation fault cannot
recover the process. An explicit native-only context boundary is narrower.

A future feature needing Worklet nodes must request a worker-enabled context
and revisit runtime lifecycle safety. It must not silently enable workers in
the narration/pronunciation factory. Both source and distributed module/type
files in the Audio API patch must stay in sync at dependency upgrades.
