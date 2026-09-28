# General's Line position row (#71, `LinePositionProbe.swift`)

```sh
bash test/manual-test/kit/run-probe.sh LinePositionProbe SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR
```

From a fresh launch, with
real touches: Settings → General, the row `Line position, N%` below the paragraph
pause and above the brackets' card, its menu 20% to 80% top to bottom with only
the row's value checked, 30% chosen (the row then reads `Line position, 30%`),
and the original value chosen back. Never presses Play. It relaunches the app,
so silence the simulator again before the next play, and reopen the reader with
`{"do":"open","id":"sha256:…"}`. 0 failures in 29.2 s (2026-09-26 11:12).

```sh
bash test/manual-test/kit/run-probe.sh LinePositionProbe SIMULATOR_UDID NEW_OUTPUT_DIR_OR_EXISTING_PROJECT_DIR \
  -only-testing:testLinePositionMenuRealTouches -only-testing:testLinePositionPersistsAcrossRelaunch
```

`testLinePositionPersistsAcrossRelaunch`, the same convention as
`PauseMenuProbe.testPauseValuesPersistAcrossRelaunch`: chooses 40% by real
touch, `app.terminate(); app.launch()`, and requires the row still reads 40%
after the cold start, then restores 50%. **Remove
`Documents/harness.json` first** (README Pitfalls, "Two harness commands
written back to back run only the second" / "The walkthrough harness re-runs
its last command on every launch") — a leftover `settings` patch from an
earlier `line-follow.cjs` run would silently rewrite the Line Position right
after the relaunch, the same trap `PauseMenuProbe`'s own persistence method
documents. Both methods together: `Executed 2 tests, with 0 failures (0
unexpected) in 72.327 (72.338) seconds` (2026-09-26 11:41), and the device's
own `settings.json` read `{"linePosition":50}` afterwards.
