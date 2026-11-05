# Percentage Margins in Appearance (#344, ADR 0085)

Margins uses the whole available reading window: 0%–25% **per side**, one
percentage point per step, new-install default 5%. Holding either button
repeats slowly and then faster without changing the step size. Release,
cancellation, Drawer closure and endpoints stop it; release adds no step.
Font Size's tap-only behavior and the Player/Library/Settings width caps stay.

## Prerequisites and admission

Read `../kit/ios-verification.md` and hold one guarded phase through readiness,
staging and native interactions. Target the explicit simulator and this tree's
Metro. Reuse an already installed compatible Debug native shell; confirm the
new Beta and live bundle. Do not uninstall or erase a device to test defaults.
Keep app data/backups and artifacts outside the repository. Use a real book
from `~/Works/epub_books` without altering its original.

Open a real chapter, not a centred frontispiece or an indented copyright notice.
The observed report uses Chapter I of Pride and Prejudice. Begin paused.
All geometry/control checks are silent. If verifying Following, complete the
provider/Consent control first, silence that simulator immediately before Play,
measure only the necessary layout transition and stop playback immediately.

## Host regressions

```sh
npx vitest run test/renderer/margins-percent.test.ts test/renderer/appearance.test.ts \
  test/app/margins-migration.test.ts test/app/provider-storage.test.ts \
  test/app/appearance-margins.test.ts test/app/held-reading-tap-lock.test.ts
```

These exercise storage round trips and one-time conversion, actual ReadingView
layout wiring, emitted CSS, and the actual Appearance controls with fake timers.
They do not establish native Pressable timing, browser CSS layout, or resize
continuity; those gates are below.

## Native controls

Open More actions → Appearance. Use real touches for both buttons, not only
harness settings patches. Save the displayed percentage and resulting layout.

- A short press changes exactly one percentage point.
- Hold long enough to see slow repeats followed by faster ones; values remain
  consecutive whole percentages. Capture intermediate values, not just an end.
- Release mid-range; verify no extra release step or later changes.
- Reach 0% and 25%; the outward button is disabled and the inward one works.
- Cancel a press before repetition, leave Appearance during repetition and
  close its Drawer during repetition. No timer may continue changing settings.
- The number, percent sign and buttons fit at larger Dynamic Type.
- Font Size still changes only on an ordinary tap, not through held repeats.

## Geometry, rotation and window size

Capture the native reading window dimensions and an actual screenshot. Ask the
existing read-only harness for EPUB geometry:

```sh
node test/manual-test/kit/hx.cjs SIMULATOR_UDID '{}' \
  --code-file test/manual-test/settings/margins-probe.js
```

Require a newly timestamped `[probe]` answer in the app's Debug Log. Preserve
monotonically increasing harness sequence numbers across commands; removing the
file midway and recreating sequence 1 can silently replay an already seen id.
Remove the final harness file before delivery so relaunch cannot replay it.

At 0%, 5% and 25%, each displayed iframe and the native Reader must match the
available reading width, not an 800-point inner column. Computed body padding
must equal that width times the chosen percentage on both sides; body side
margins are zero. At a 1180-point landscape width, expected per-side padding is
0, 59 and 295 points respectively. A paragraph's internal indentation can add
space; ordinary Chapter I paragraphs must not acquire extra wrapper whitespace.

Rotate iPad portrait ↔ landscape and resize to a real narrow window. Verify
that the percentage remains unchanged, iframe widths match the new viewport,
and the computed padding follows that new width. A 5% choice is 41 points at
820 and 59 at 1180. Check Browsing preserves the upper visible passage and a
Reading Position is unchanged. Test Following separately with a working
provider, measured short playback and explicit stop. Use the existing exact-CFI
resize probes under `../place-and-following/` for passage evidence; do not
confuse a constant-width rotation with a real width-changing reflow.

The controls and page must also work in dark mode and in a phone-sized viewport.
A handler-assisted geometry setting is staging, not proof that the native
stepper or rotation input worked.

## Migration and persistence

Back up the selected simulator's settings before staging, preserving unrelated
settings. Stop the target app before editing its file; do not edit a live file
and assume in-memory settings changed. Resolve the data container after any
installation. Do not log the whole settings object.

- Legacy `appearance.margins: 8` with no `marginsUnit`, in a 1180-point reader,
  must become `margins: 1, marginsUnit: "percent"` on its first measured opening.
- Visiting Library/Settings or saving an unrelated setting before opening a
  Document must preserve the pending old value as `marginsUnit: "points"`.
- A saved `8` explicitly marked `"percent"` must remain 8%, not migrate again.
- Relaunch, rotate and open another Document: keep the saved percentage.
- A new settings state starts at 5%; failed atomic writes preserve the old
  file/unit (host failure-injection coverage; never fill the owner's disk).

Restore the non-test settings after the migration scenario, retaining the
correctly migrated percentage and original library. Verify the delivered Beta
and ordinary reading page, playback stopped, with the parent-tree Metro live.

## Earlier fixed-point evidence (#84, superseded behavior)

The old recipe measured 8/16/32/48 **points**, with screenshot ink edges
8.0/394.0, 16.0/386.3, 32.0/370.0 and 48.0/354.0 on a 402-point iPhone in dark
mode, and matching 16/8 in light. Glyph antialiasing reached about 1.3 points
outside some rows. The highlighted sentence stayed at y 418.3 at 8, 16 and 48.
That established the old point rule, not percentage behavior on an iPad. Its
migration and default-16 observations belong to that earlier implementation.
`../kit/ink.py` still measures screenshot ink, not CSS boxes or input success.
