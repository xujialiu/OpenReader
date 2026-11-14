# Fish secure-field credential setup probe

**Source status: attempt-02 SPENT — the public probe PASSED natively (1 test, 0 failures, 6.857 s) and the transport PRIVACY FAILED. The real-input method is PERMANENTLY DISABLED.**
On 2026-11-15 the single renewed public-sentinel invocation ran once on the owned Duo under the one guarded admission: the field precondition held, the public sentinel was typed while masked, observed nonempty, and cleared back to `Not set` — `Executed 1 test, with 0 failures (0 unexpected) in 6.857 seconds`. At t=3.67s the framework itself logged and titled the activity `Type 'OPENREADER_PUBLIC_...' into "Not set" SecureTextField` — an 18-character truncated prefix of the typed input, echoed by XCTest into the test log, the activity export and the retained diagnostics. **PRIVACY FAIL**: no plaintext input echo qualifies, and a truncated prefix alone is a leak. The empty-field read is now known to be an actual String that the `FishKeyEntryFieldRead` classifier classifies `.empty` (nil and non-String were ruled out by the passing precondition); whether it is the empty String or the legacy `Not set` String is unresolved by design, because the classifier accepts both.

The offline scanner that round also carried a HOST performance defect: its per-character `.{0,300}` backtracking regex hung for minutes on the retained 558 KB diagnostics session log and produced no verdict; its full-sentinel-only search also missed the observed truncated prefix. The retained scanner is deterministic and bounded: it fails fast on readable single- or double-quoted `Type` payloads (full or truncated, and chronological one-character reconstruction) with even one exposed leading character disqualifying (the compatibility prefix option cannot weaken this), keeps the full encoded forms as negative controls, and enforces an explicit runtime budget and per-artifact size cap that record coverage uncertainty as HOLD. A byte-scan CLEAN is not a semantic or image privacy pass.

[FishKeyEntryProbe.swift](../kit/FishKeyEntryProbe.swift) prepares credential
entry; it is not app-feature verification or evidence that a key works. It reuses
the sanctioned host-file → masked native `typeText` transport from
[OfflineFixProbe](../downloads/fresh-library-and-deletions.md) and
`ProviderHeaders105Probe`, but none of their navigation, Enable, connection
checks, captures or plain-field fallbacks. Do not run those older methods for
this task. No app source, SDK, Version or Beta changes are needed.

## Admission and boundaries

Native work belongs to the later `ios-tester`, after parent review. Use only the
session-owned Duo whose Metro is **8437** — `iPhone Duo ios353-fishpub-8437`,
explicitly confirmed UDID `40DC7F6C-3500-480D-A0FB-147AEF50C609` (never an
automatically chosen device) — running the frozen ordinary Debug
`1.0.4 (30)-beta19-debug` built from this worktree. Leave the frozen app
source/Beta 19 intact. No owner Mac copy, other device, phone, keyboard/device
configuration, global clipboard, security change, CDP/new endpoint, prototype
mutation, Keychain API/reset, Provider activation, connection test, Voice list,
synthesis, download, Play or audio is part of this probe. The methods never
launch, activate or terminate the app.

**Renewed staging network exception (explicit, attempt-scoped).** Opening the Fish Audio screen
mounts a `useEffect` that loads the Model list
(`src/app/provider-screen.tsx` → `sharedFishModels.load`): a keyless GET to
`https://api.fish.audio/compat/v1/models`, independent of the Enabled switch,
single-flight, cached 30 minutes per app process. The parent authorizes AT MOST
**one keyless GET** caused by the single staging navigation to the disabled Fish
Audio screen, for THIS attempt only — it is not renewed automatically per app
process, and a recovery or relaunch never re-arms it. No credential or
Document/Speech Text may be
sent. This is the only network exception; do not reopen or retry navigation to
spend another request — if the Model list fails to load, leave the error footnote
in place (it does not affect the probe's preconditions) and do NOT reopen the
page. No interception, prototype patch, new endpoint or Keychain shortcut.

Before entry, the caller must independently establish **original Fish key
presence ABSENT**, not unknown/refused/held — unknown, held and refused are not absence. What establishes it here is THIS freshly session-created
simulator's no-input history — no Fish credential was ever entered on
`iPhone Duo ios353-fishpub-8437` in this session — together with no `API key:`
error footnote on the screen and the masked field's read classifying `.empty`.
A fresh app container alone proves NOTHING: the Keychain survives container replacement,
so container freshness is never absence evidence. The constant
`placeholderValue == "Not set"`
is the field's configuration — screen-state gating, not presence evidence on its
own — and the classifier covers the accessibility read only, never a Keychain
claim. The already-running app must be foreground on the settled Fish Audio
Provider screen: disabled, idle, editable, masked, with the key showing
`Not set`. Do not navigate there inside this probe. No concurrent
UI/credential writer or playback is allowed. A nonempty field is a stop, never
permission to clear an existing owner key. Missing/ambiguous/revealed fields, an
`API key:` error footnote, enabled/busy providers and unexpected placeholder
representations fail closed.

Use one bounded foreground `ios_guard.py` admission for ALL of staging (host
file, screen navigation, settled-state verification), native readiness,
build/test, result export, qualification and real entry; prior separate
admission boundaries do not count as same-admission proof. The phase scripts
live in a separate owned HOST prep directory
(`/tmp/openreader-fish-key-entry-duo-8437-prep-02`, mode 0700 — never inside
the attempt directory): the launcher verifies attempt-02 is absent, creates it
EXACTLY ONCE (mode 0700), and then runs the guard with the phase from prep;
the phase only validates the owned existing directory, never creates or
removes it. Both the phase's EXIT trap and the launcher's outer trap delete
ONLY this attempt's staged `fish-api-key.txt`; all evidence and the spent
directory are kept. There is no implicit re-navigation after any recovery or
relaunch: a recovery may only be spent by readiness BEFORE the single
navigation, and a failed staging assertion stops the phase:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
  python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 1800 \
  --record "$ATTEMPT/native-phase.json" -- bash "$OWN_PHASE"
```

`OWN_PHASE` is the caller's owned foreground phase script, not a background
runner or a new transport framework: it stages the sentinel file, performs the
one navigation through `ax.py` (tree-read verified before and after), verifies
the settled preconditions, runs readiness (`ios_ready.py --metro`), silence,
the single `run-probe.sh` invocation, all exports, the sentinel scan and the
EXIT-trap cleanup. Use the per-command `DEVELOPER_DIR` above on **every**
Apple/runner command inside it too; never `xcode-select`. Follow
[the kit's bounded readiness/cleanup rules](../kit/ios-verification.md).
Readiness takes a screenshot: do it only while the field is verified empty or
masked, never revealed. No additional screenshots/tree dumps/field-value
printing. Inspect exported automatic attachments during the public-only phase
for masking; if their safety cannot be established, stop before real entry.
`run-probe.sh` may terminate the selected app on failure; that is separate
runner cleanup, not probe behavior. After failure, stop: no relaunch/retry to
spend another entry attempt.

## One new private attempt directory

This probe is deliberately pinned to this dedicated, one-use path:

```sh
ATTEMPT=/tmp/openreader-fish-key-entry-duo-8437-attempt-02
umask 077
mkdir -m 700 "$ATTEMPT" || exit 2  # no -p; an existing path is a STOP
trap 'rm -f -- "$ATTEMPT/fish-api-key.txt"' EXIT
```

attempt-01 (`/tmp/openreader-fish-key-entry-duo-8437-attempt-01`) is SPENT: its
one public invocation failed at the precondition above on 2026-11-15 00:00,
nothing was typed, and its artifacts are preserved as failed evidence — NEVER
reuse, remove or recreate it. Never reuse `/tmp/openreader-fish-key.txt`, an
owner file, or an older attempt directory either. Do not remove/recreate this
path to reset the attempt bound; the launcher refuses an existing path and the
phase validates an owned existing one. A later separately authorized attempt
needs a newly reviewed dedicated path. Keep raw evidence under this private
directory; the `finally`/EXIT path deletes **only this shell's staged `fish-api-key.txt`**,
not owner files, Keychain contents or evidence. Parent must be owned by this
host user, mode **0700**, not a symlink; the input must be a user-owned
regular, single-link file, mode **0600**, not a symlink. Host staging checks
ownership; the native reader independently checks type, permissions and link
count. Do not put a credential in source, argv, environment variables/dumps,
JSON configuration, metadata, shell tracing, console output or the model
transcript.

Stage only the **public** sentinel first (this snippet is HOST preparation for
later execution, not a command to run with credentials now):

```sh
npx tsx --input-type=module <<'JS'
import { lstatSync, writeFileSync } from 'node:fs';
const dir = '/tmp/openreader-fish-key-entry-duo-8437-attempt-02';
try {
  const parent = lstatSync(dir);
  if (!parent.isDirectory() || parent.uid !== process.getuid() ||
      (parent.mode & 0o777) !== 0o700) throw Error();
  const path = dir + '/fish-api-key.txt';
  writeFileSync(path, 'OPENREADER_PUBLIC_FISH_SENTINEL_8437', { flag: 'wx', mode: 0o600 });
  const file = lstatSync(path);
  if (!file.isFile() || file.uid !== process.getuid() || file.nlink !== 1 ||
      (file.mode & 0o777) !== 0o600) throw Error();
} catch { console.error('Public staging refused'); process.exitCode = 2; }
JS
```

## The one public qualification: SPENT (attempt-02, 2026-11-15)

The sentinel is public, **36 ASCII characters**. attempt-02 ran exactly one
public invocation under the one guarded admission and is now SPENT — its
outcome is recorded above (native PASS, transport PRIVACY FAIL). The
invocation, retained for the record only (never rerun; a new attempt needs a
newly reviewed dedicated path and fresh authorization):

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
  bash test/manual-test/kit/run-probe.sh FishKeyEntryProbe "$DUO_UDID" \
  "$ATTEMPT/public-probe" --mode public-sentinel-originally-absent \
  -only-testing:testPublicSentinelIntoEmptyAndClearOwn
```

The method refuses any staged input other than the public sentinel, requires
empty, types while masked, observes nonempty as a boolean, and **immediately
clears only its own just-typed sentinel** using 36 native Delete keys, without
retapping/moving the caret or measuring masked AX length. It requires the
`Not set` placeholder boolean afterward, with Fish still disabled. An empty
actual String read — including the legacy `Not set` String representation the
pre-repair probe supported (the actual native representation is still unknown) — classifies `.empty` and the flow proceeds; a nil or non-String read
classifies `.unavailable` and the probe stops before tap or typing: a
nonsecret native adaptation to an empty String read may succeed, while an
actual nil/unknown read must stop before input. Partial entry/failure/
interruption is not an invitation to clear unknown contents: STOP and return
control to the parent; no blind overwrite/clear/retry.

**A passing XCTest result is necessary but NOT the privacy gate.** Before
loading any real credential, the tester must inspect/scan **all** raw build,
test and diagnostic logs, exported attachments/activity logs, and the complete
readable xcresult text/JSON exports, not only `Executed` lines or the runner's
summary. Use the selected Xcode's supported xcresult export commands inside
the same guard. Search for the public sentinel in UTF-8, UTF-16 LE/BE,
JSON/Unicode escapes, URL encoding, hex and base64 forms; inspect per-character
`typeText` activities and reconstruct split/escaped typing where applicable.
A scan of raw binary xcresult bytes alone is insufficient. Record the exact
export/scan commands, artifact coverage and result without importing a real
key. Missing/unreadable/unexported logs or undecodable activity payloads mean
**NOT QUALIFIED**, not an absence of leaks. Verify any automatic images show
only a masked/empty field; do not add screenshots to investigate a real key.

If XCTest/framework logging echoes the sentinel or its typed characters in
recoverable form, **STOP: do not load or type the real credential**. Source
comments, masked AX, no explicit `print`, a zero exit status, and automatic
redaction assumptions cannot establish native log privacy. Only a reviewed,
passing public qualification permits the next step with the same toolchain,
logging/diagnostic settings and field behavior. Do not suppress diagnostics
just to hide a leak; changing the logging route requires a new qualification,
not an extra attempt under this authorization.

## Real input: PERMANENTLY DISABLED in this probe

The real-input method is permanently disabled at source level.
`testPrivateInputIntoEmpty` carries a hard barrier as its first statement — a
fixed `XCTest input privacy failed: the typed input prefix leaked into
framework activity (attempt-02); this real-input method is permanently
disabled` failure raised before any staged-file read, tap or typing, not
gated on mode or caller approval. attempt-02 measured the transport end to
end: the probe's own control PASSED (empty → public-nonempty → empty, 6.857 s,
Fish still disabled, Keychain path untouched) while the framework echoed a
truncated 18-character prefix of the typed input (`Type 'OPENREADER_PUBLIC_...`
at t=3.67s) into the test log, the activity export and the retained
diagnostics — PRIVACY FAIL. The old key-staging recipe that stood here
(a host-file replacement driven by the app's local settings reader via
`loadSettings`, feeding the disabled method's private mode string) is RETIRED
and must not be
reconstructed: never stage a real key for this probe. A DIFFERENT credential
transport (one that does not inject text through the framework's typed-input
path — for example an owner-entered key on this simulator, reviewed under its
own authorization) requires a separate owner decision; this probe grants no
such permission, and no alternate transport has been implemented or authorized
here. Any future credential verification still goes through the existing
normal app presence/resave/connection-check route with its own network
authorization.

## What typing cannot establish

[`useSecretInput`](../../../src/app/use-secret-input.ts) autosaves each edit
while ready and disabled; clearing this probe's own sentinel also follows the
normal app forget path. Enablement/busy state locks editing. The
[Provider secret hook](../../../src/app/use-provider-secrets.ts) reports
unknown/absent/held/refused separately, and the
[Keychain contract](../../../src/keys/README.md) explains resaving. Neither
method directly reads/writes/resets Keychain. A nonempty masked field and
XCTest rc=0 do **not** prove final autosave, persistence, correct credential,
Provider response or feature acceptance. A later separately authorized phase
must use the existing normal app presence/resave/connection-check route to
verify the actual credential (and obtain any network authorization) — a different credential transport is therefore an owner
decision, and any
credential ENTRY transport other than this probe's disabled XCTest typing is a
separate owner decision. No fake sentinel Enable/connection request is allowed
here or as a qualification step.
