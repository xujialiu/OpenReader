# Fish narration interruption coverage (issue #73, `FishNarrationProbe.swift`)

Use the local Fish credential through `OfflineFixProbe` ([fresh-library-and-deletions.md](../downloads/fresh-library-and-deletions.md)) and ask the Fish voice list once before this probe. Open a long book from `~/Works/epub_books` in the Library, leave the reader paused, and run the probe with the simulator silenced:

```sh
bash test/manual-test/kit/silence.sh set SIMULATOR_UDID
bash test/manual-test/kit/run-probe.sh FishNarrationProbe SIMULATOR_UDID /tmp/openreader-fish-narration-probe \
  -only-testing:testRealFishPlayThenPause
```

Change `-only-testing` to run `testLookupPausesPreviouslyPlayingFish`, `testPauseOptionOffKeepsFishPlaying`, `testPronunciationInterruptionOnCurrentReader`, or `testPronunciationInterruptionResumeAndCancellation`. The last two use the real Fish audio path and require the pause option off; the second method changes it through Settings, while the current-reader method expects the already-prepared setting. `testPronunciationInterruptionResumeAndCancellation` also exercises close, restart, and changed-selection cancellation.

The real Fish run measured 2.3 seconds to active playback, continued for 5 seconds, and stopped with a real Pause touch. On a long book, the pause option off run kept the transport in Pause after closing lookup. With the player surface cleared through its real LogBox close touch, the interruption methods proved that pronunciation resumes narration that was playing, leaves already-paused narration paused, and cancels when the drawer closes or the selected word changes. Both pronunciation accents completed naturally, with no audio error, and all runs were made at zero simulator volume.

For the iOS handle-release regression, run `testSelectionHandleExpansionTranslatesSentence` to prepare the fixture, followed by `testPreparedHandleReleaseFinishesRequest`. The second method requires that the native selection changes and then reaches a result or bounded error. In beta35 it failed with `selecting=true`, `loading=false` after the DOM lost the handle's release. The native reader release bridge fixes that path. Its coordinates are measured on the dedicated iPhone 17 fixture; do not reuse them after a font/layout change without a screenshot check.
