# Exact native name input (#123, #318)

Use non-secret ASCII fixture names in a disposable Library. This recipe covers
OpenReader's native Rename / Create folder alerts, not masked fields, credentials,
long scrolling fields or arbitrary settings controls. Artifacts contain text.

## Replace and verify, then submit separately

Open the alert through real touches. Supply its exact title, the text it should
currently hold, and a **new** artifact directory:

```sh
python3 test/manual-test/kit/alert-input.py SIMULATOR_UDID NEW_OUTPUT_DIR \
  --title Rename --before Fiction --value Fictionx
```

For a fresh Create folder field use `--title 'Create folder' --before ''`.
For the blank-disabled check use `--value ''`. The helper scopes to one enabled
field in the named native alert, focuses its right edge, clears once, requires
empty, types once, and requires two fresh exact native reads. Every command has
a timeout; there are **zero input retries**. A mismatch returns nonzero and leaves
the editor unsubmitted with command/AX artifacts. Inspect that first failure
before deliberately reopening/retrying with a new artifact directory.

PASS means only that the native field holds the intended value. Next:

1. Touch Save/Create and verify the alert's actual outcome. A successful tap
   command alone is not a submission.
2. On success, require the exact intended name in the resulting row **and**
   `Documents/library-folders.json` for a Folder, preserving the Folder id.
3. On duplicate refusal, verify the warning and unchanged persisted name. Back
   to editing must preserve the exact draft; Cancel must leave storage unchanged.
4. If native and persisted names disagree, preserve both and report an app/input
   boundary failure. Native readback does not establish the JS draft or callback
   value. Diagnosis requires tagged JS/native instrumentation, not another sleep.

The helper's clear may fail on scrolled text whose end is not at the field's
right edge. That fails closed before new text is typed; it is not permission to
repeat a backspace burst. The placeholder defaults to `Name`; text equal to the
placeholder is ambiguous in AX, so use another fixture name.

## Exact name after Save (#318)

From a disposable Library page with no drawer open:

```sh
python3 test/manual-test/kit/ios_guard.py run --wait 900 --timeout 180 \
  --record /tmp/name-save-phase.json -- \
  python3 test/manual-test/library-and-reader/name-save.py \
  SIMULATOR_UDID NEW_OUTPUT_DIR --value Qwrtz
```

The default creates a Folder. Add `--folder CURRENT_NAME` to rename that
Folder on the browsed page; `--open-alert` starts with the matching editor
already open to remove navigation from the reproduction. Use non-secret ASCII
names, and a name free in that Folder. It reuses `alert-input.py`, then touches
the editor's own Create/Save, waits for the native dismissal and the store
write, and checks the exact name, parent, identity (for Rename) and Library row.
It never retries typing or restores a wrong name. Successful and failed saves
stay in place. Exit 0 is PASS, 1 is a saved-name/row mismatch, 2 is a setup or
input failure. Each run retains command/AX artifacts, `input/result.json`, and
before/after Folder snapshots. About 10–20 seconds with the device ready.

**Pin the keyboard's learned state when comparing old and fixed code.** A word
that was corrected once may save exactly on every later attempt even in the
old app. A green run on a learned word is not a negative control. For this
issue's before/after comparison, on a session-owned disposable simulator only:
stop the app, shut down the simulator, move its
`data/Library/Keyboard` directory into the run's artifacts, then boot it,
re-silence it, relaunch the app against the chosen Metro, and pass the readiness
gate. This lets iOS recreate unlearned keyboard data. Do not alter the Mac's,
a phone's or another session's keyboard; keep every moved directory until the
session's evidence is recorded. Reset the disposable Folder fixture between
Create runs as well, so a duplicate refusal is not mistaken for a save. Run
these setup operations inside the shared guard. The reset is a controlled
fixture operation on a healthy device, not an environment-recovery retry.

Measured on iOS 26.5: with fresh keyboard data, the old code saved `Qwrtz` as
`Quartz` twice; with only `autocorrectionDisabled(true)` on the shared field,
both runs saved `Qwrtz` exactly. Subsequent Folder renames to `Innerq` and
`Innerx` were exact too. `Deeper` is the ordinary-word control. This script does
not exercise Document Rename, IME composition or paste; those require separate
native checks. The mocked-field Vitest assertion protects the modifier's
configuration, not the keyboard's behavior.

## Document rename from the Library and the Reader (#318)

The Library row's actions drawer and the Reader's menu are the same
`ReaderActions`, so one script covers both entry points. It opens the drawer
with real touches, types through `kit/alert-input.py`, presses the alert's own
Save, and requires the new title in `display-names.json`, `library.json` and on
screen (the Library row's actions button in `--mode library`, the reader's own
title in `--mode reader`). Successful and failed renames stay in place.

```sh
python3 test/manual-test/library-and-reader/doc-name-save.py SIMULATOR_UDID NEW_OUTPUT_DIR \
  --mode library --current 'A Short Test of Reading Aloud' --value 'Renamed In Library'
python3 test/manual-test/library-and-reader/doc-name-save.py SIMULATOR_UDID NEW_OUTPUT_DIR \
  --mode reader --current 'Renamed In Library' --value 'Renamed Twice'
```

`--mode reader` starts on the Library page and opens the Reader itself. Exit 0
is PASS, 1 is a store/title mismatch, 2 is setup. It covers the #227 duplicate
refusal only through `validate`'s warning, which a sibling Document's name
raises; for that refusal's exact quoted name and Back-to-editing draft, drive
the same alert by hand or with the store-refusal recipe below. ASCII names
only. Verified 2026-10-23 on iOS 26.5 (`1.0.1 (14)-beta3-debug`): both modes
renamed exactly, with the Document Id preserved in `display-names.json` across
the two renames.

## Reversible native write failure (#215)

`display-names.json` is written by the native `writeJson`; making the file
immutable (`chflags uchg`) fails that write for real, without filling the disk
or touching other stores. With the flag set, a Document rename must say so
under the drawer's rows and change nothing; after `chflags nouchg`, the same
drawer's rename must succeed. The drawer is left open between the two parts on
purpose. Restore the flag immediately after the failing part.

## Repeatable before/after loop

Prepare two distinct sibling fixture folders through real input; leave Library
at root with no drawer open. The script renames the first, collides with the
second, returns to editing, edits and saves, asserting native text and persisted
identity/name throughout. It restores the original name only on success. Every
failed run retains its state and artifacts.

```sh
python3 test/manual-test/library-and-reader/input-integrity.py \
  SIMULATOR_UDID NEW_OUTPUT_DIR --folder Fixture --collision Sibling --rounds 3
```

To reproduce the faulty automation operation rather than use the helper, add
`--baseline-mcp-replace`. It pins mobilebuildmcp **2.7.1**, resolves a fresh field
ref, calls `type-text --replace-existing`, and asserts exact native text before
any submit. On the measured iOS 27.0 alert, this fails with appended text despite
the tool reporting success. It deliberately leaves the field for inspection;
Cancel/reopen before running the helper comparison.

## Measured: the truncation is an app defect, repaired at the submit path

2026-10-02, existing iPhone 17 / iOS 27.0. Diagnosis ran on beta16-debug; the
fix ships as beta18.

- Baseline replacement twice appended: `Fiction` → requested `Fictionx` became
  `FictionFictionx`; prefilled Rename `FictionY` → requested `Fiction` became
  `FictionYFiction`. The second is the one-command baseline loop above (exit1).
  2.7.1 sends Cmd+A then types without checking selection or the resulting value.
  Native and JS traces show append increments, not a successful replace later
  overwritten by the app. Why the HID selection did not take effect is unproven.
  This is an automation-procedure defect, separate from the app bug below.
- The helper passed replacement, blank-disabled Save, prefilled rename, and
  warning→Back to editing preservation; wrong `--before` failed before modifying
  the field. Sixteen instrumented type-only duplicate→Cancel rounds passed with
  exact JS submit values and unchanged persisted names (`cycles02`, `cycles03`).
  An earlier run (`cycles01`) timed out waiting for the warning with no store
  change — a tap that never submitted, not the truncation.
- **The uninstrumented rapid loop reproduced the defect** (`cycles-final`,
  15:59). Round 0 intended the duplicate `Fiction`; the native field read
  `Fiction`; Create was touched; no warning appeared, and the store captured
  immediately after holds a new folder `Fictio` (`0-persisted.json`): the app
  saved a truncated name through a real submit.
- **Decisive submit trace (16:03:26.088)**, same build with the submit probe:
  `{"typed":"Fictio","native":"Fiction"}` — at the moment of submit the JS draft
  had lost the final `n` while the native field held the full text, and the
  warning then quoted “Fictio” (`submit-trace03/failure.txt`). A verbatim copy
  of the Debug Log grep is preserved in
  `/tmp/openreader-input-repair/decisive-submit-160326.txt`; the `trace.txt`
  files inside `cycles-final/` and `submit-trace03/` are stale copies (identical,
  ending 15:42:18.829) that do not contain it. Whether the final onTextChange
  event was missed or the submit callback ran stale is **not established**.
- `InputIntegrityProbe.swift` finally ran one XCTest case, failing its resulting
  row assertion. The field still held the exact intended name, the alert stayed
  open, and JS tracing contained no submit event. AXe's touch pair then submitted
  the same field exactly. Thus this run failed activation, not text persistence;
  the existing Swift probe is not a passing regression test. Its two earlier
  startup-stalled attempts executed no cases and are not passes either.

**The fix (beta18)**: the submit path reads the field's native text (`text.get()`)
and uses that one value for the blank guard, validation, the warning and
`onSave`; the JS draft only drives the disabled state. Three new unit cases fail
against the old source and pass after it (`unit-before.log`, `unit-after.log`).
After the fix, five rapid duplicate→Cancel rounds (`fixed-cycles01`) and, after
a clean relaunch, five more (`beta18-create`), an eight-second settled round
(`beta18-settled`) and a full warning→back→edit→persist→restore round
(`beta18-edit`) all passed, the persisted store unchanged except the intended
rename. Raw artifacts and every failed attempt are indexed in
`/tmp/openreader-input-repair/REPORT.md` and `FINAL-REPORT.md`.

## Independent acceptance (2026-10-02)

The GLM ios-tester verified the integrated beta18 tree (`12dcbe7`) on the same
owned iPhone 17 / iOS 27 simulator, with the actual bundle containing `text.get()`.
Three rename/collision/back/edit/save/restore rounds, five rapid Create/cancel
rounds, and one eight-second-settled round exited 0. Per-round disk snapshots
preserved the folder identity and exact name. Blank Create stayed disabled;
Cancel left storage unchanged. A Document rename, which has no duplicate
validator, also changed and restored both its row and `display-names.json`.

The first invocation failed because its artifact directory already existed.
A later helper clear failed closed while all AXe text injection was unresponsive;
a clean app relaunch restored input, after which the three-round run passed.
Both failures remain in the evidence, not counted as passing rounds. This does
not establish why the simulator input channel stopped responding or why the
original React draft lagged. The app fix removes reliance on that draft at
submission; the helper detects input failures rather than silently retrying.
Raw independent logs: `/tmp/input123-independent/`. The parent checked all run
exit codes and retained the failed run before accepting #123.
