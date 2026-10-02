# Exact native name input (#123)

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
