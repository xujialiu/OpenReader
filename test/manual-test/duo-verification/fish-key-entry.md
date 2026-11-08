# Fish secure-field credential setup probe

**HOST preparation only: NOT COMPILED, NOT NATIVE, NOT PRIVACY QUALIFIED.**
[FishKeyEntryProbe.swift](../kit/FishKeyEntryProbe.swift) prepares credential
entry; it is not app-feature verification or evidence that a key works.
It reuses the sanctioned host-file → masked native `typeText` transport from
[OfflineFixProbe](../downloads/fresh-library-and-deletions.md) and
`ProviderHeaders105Probe`, but none of their navigation, Enable, connection
checks, captures or plain-field fallbacks. Do not run those older methods for
this task. No app source, SDK, Version or Beta changes are needed.

## Admission and boundaries

Native work belongs to the later `ios-tester`, after parent review. Use only
the session-owned Duo whose existing Metro is **8437**, with its explicitly
confirmed UDID (not an automatically chosen device). Leave the frozen app
source/Beta 18 intact. No owner Mac copy, other device, phone, keyboard/device
configuration, global clipboard, security change, CDP/new endpoint, prototype
mutation, Keychain API/reset, Provider request, Voice, Play or Download is part
of this probe. The methods never launch, activate or terminate the app.

Before entry, the caller must independently establish **original Fish key
presence ABSENT**, not unknown/refused/held, and the already-running app must
be foreground on the settled Fish Audio Provider screen: disabled, idle,
editable, masked, with the key showing `Not set`. Do not navigate there inside
this probe (opening the screen can load Models independently). No concurrent
UI/credential writer or playback is allowed. A nonempty field is a stop, never
permission to clear an existing owner key. Missing/ambiguous/revealed fields,
enabled/busy providers and unexpected placeholder representations fail closed.

Use one foreground phase inside the **same `ios_guard.py` admission** for all
native readiness, build/test, result export, qualification and real entry:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
  python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 1800 \
  --record "$ATTEMPT/native-phase.json" -- bash "$OWN_PHASE"
```

`OWN_PHASE` is the caller's owned foreground phase script, not a background
runner or a new transport framework. Use the per-command `DEVELOPER_DIR` above
on **every** Apple/runner command inside it too; never `xcode-select`. Follow
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
ATTEMPT=/tmp/openreader-fish-key-entry-duo-8437-attempt-01
umask 077
mkdir -m 700 "$ATTEMPT" || exit 2  # no -p; an existing path is a STOP
trap 'rm -f -- "$ATTEMPT/fish-api-key.txt"' EXIT
```

Run creation, staging and the admitted phase in this same owned shell, with
failure stopping the sequence. Never reuse `/tmp/openreader-fish-key.txt`, an
owner file, or an older attempt directory. Do not remove/recreate this path to
reset the attempt bound. A later separately authorized attempt needs a newly
reviewed dedicated path. Keep raw evidence under this private directory; the
`finally`/EXIT path deletes **only this shell's staged `fish-api-key.txt`**,
not owner files, Keychain contents or evidence. Parent must be owned by this
host user, mode **0700**, not a symlink; the input must be a user-owned regular,
single-link file, mode **0600**, not a symlink. Host staging checks ownership;
the native reader independently checks type, permissions and link count.
Do not put a credential in source, argv, environment variables/dumps, JSON
configuration, metadata, shell tracing, console output or the model transcript.

Stage only the **public** sentinel first (this snippet is HOST preparation
for later execution, not a command to run with credentials now):

```sh
npx tsx --input-type=module <<'JS'
import { lstatSync, writeFileSync } from 'node:fs';
const dir = '/tmp/openreader-fish-key-entry-duo-8437-attempt-01';
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

## First: one PUBLIC-only native qualification

The sentinel is public, **36 ASCII characters**. With the original absence
and exclusive ownership gates above, run exactly one public invocation inside
the admitted phase:

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
`Not set` placeholder boolean afterward, with Fish still disabled. Partial
entry/failure/interruption is not an invitation to clear unknown contents:
STOP and return control to the parent; no blind overwrite/clear/retry.

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

## Only after PASS: one real-input attempt

Keep Fish disabled and the field empty with no intervening writer. Replace
only the owned **staging file** whose contents are still the public sentinel.
The existing `loadSettings()` process supplies only the required Fish value;
never ask a model to read the settings/key and never echo it. This local
process does not create a Provider or make a request. It catches errors with a
fixed message rather than dumping settings/parser errors:

```sh
npx tsx --input-type=module <<'JS'
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { loadSettings } from './test/manual-test/kit/node-kit.ts';
const dir = '/tmp/openreader-fish-key-entry-duo-8437-attempt-01';
try {
  const path = dir + '/fish-api-key.txt';
  const parent = lstatSync(dir), file = lstatSync(path);
  if (!parent.isDirectory() || parent.uid !== process.getuid() ||
      (parent.mode & 0o777) !== 0o700 || !file.isFile() ||
      file.uid !== process.getuid() || file.nlink !== 1 ||
      (file.mode & 0o777) !== 0o600 ||
      readFileSync(path, 'utf8') !== 'OPENREADER_PUBLIC_FISH_SENTINEL_8437') throw Error();
  const key = loadSettings().fish.apiKey.trim();
  if (!/^[\x21-\x7e]{1,512}$/.test(key) ||
      key === 'OPENREADER_PUBLIC_FISH_SENTINEL_8437') throw Error();
  writeFileSync(path, key, { flag: 'w', mode: 0o600 });
} catch { console.error('Private staging refused'); process.exitCode = 2; }
JS

DEVELOPER_DIR=/Applications/Xcode-27.1.0.app/Contents/Developer \
  bash test/manual-test/kit/run-probe.sh FishKeyEntryProbe "$DUO_UDID" \
  "$ATTEMPT/real-probe" --mode real-input-privacy-qualified \
  -only-testing:testPrivateInputIntoEmpty
```

The native process alone reads the staged real value for masked typing. Its
1–512 printable-ASCII byte bound is transport safety, **not** a Fish credential
format/validity claim. It rejects newline/control-key payloads, empty/unreadable
or unsafe files, the sentinel, and nonempty/revealed/locked/ambiguous fields.
It does not clear a real value, press the eye, Enable or Test connection. Always
select the single method; default/incorrect modes fail closed. There is at
most **ONE public attempt and, only after its reviewed PASS, ONE real attempt**;
any failure ends this authorization. Do not repeat real typing because rc was
ambiguous or a save seems delayed. Delete the staged file in `finally` even on
failure/cancellation; retain the private raw evidence and report only redacted
booleans/fixed failures, never the key or field value.

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
verify the actual credential (and obtain any network authorization). No fake
sentinel Enable/connection request is allowed here or as a qualification step.
