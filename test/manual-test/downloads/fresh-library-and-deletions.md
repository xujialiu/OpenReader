# Issues #13/#14: a fresh Library, Fish from empty settings, and the two destructive confirmations the other probes always cancel

`OfflineFixProbe.swift` covers what none of the other probes do: a device that has
never had a provider configured or a document downloaded, and actually
confirming (not cancelling) "Delete all saved audio" and "Delete this book".
It expects two fixtures already in the Library: `A Short Test of Reading
Aloud` and a second, single-utterance document titled `OpenReader Deletion
Fixture` (one paragraph, one chapter named `Only Chapter`), used so the
destructive checks below have a document to spend rather than the shared
short fixture. Neither fixture's Library entry is written by this probe; both
were added directly (`library.json` plus `Documents/library/<id>.epub`) using
the project's own `identifyDocument`/`serializeLibrary` via `tsx`, which is
the reliable way to seed a fixture Document without reconstructing the
picker flow — a script that does this is not checked in here since it is a
one-time setup step, not a repeated verification.

```sh
printf '%s' "$FISH_API_KEY" > /tmp/openreader-fish-key.txt && chmod 600 /tmp/openreader-fish-key.txt
bash test/manual-test/kit/run-probe.sh OfflineFixProbe SIMULATOR_UDID /tmp/openreader-offline-fix-01 \
  -only-testing:testConfigureFishProvider
```

Real touches: Settings → Providers → Fish Audio, types the key read from
`/tmp/openreader-fish-key.txt` (never printed, logged or checked in — write
it there from `~/.secrets/openreader/` per MEMORY/device-testing.md before this method runs, `chmod 600`
it, and remove it afterward) into the still-masked field, taps Enable, and
waits for "Connection successful". `Show API key` is never tapped, so no
capture here can show it. Skips the enable step if a previous run already
left the provider enabled.

**A successful Fish connection check can still leave Voice empty on the next cold reader.** Measured 2026-09-26 on the dedicated iPhone 17: the connection row passed, but `testChooseVoiceForShortFixture` found no rows after a relaunch. Sending the walkthrough commands `{"do":"ask","provider":"fish"}` and then `{"do":"voicelist","provider":"fish","n":3}` after the reader was open populated the cached list; the next real Voice touch found `jjk narrator`. Treat an empty Voice sheet after a successful key check as a list-prefetch failure and ask the provider again before testing narration.

`testChooseVoiceForShortFixture` opens the short fixture and taps whichever
Fish voice sorts first (this is a download/playback mechanics check, not a
locale-picker test — `ReaderProbe`'s `fish` mode already covers real navigation to a
specific locale, [reader-sheets-and-handover.md](../voices-and-providers/reader-sheets-and-handover.md)). Choosing while paused leaves the sheet open by design
(`ReaderProbe.testReaderSheets`); dismissal is `Close Voice`, the same
full-bleed backdrop button as `Close Download`/`Close Appearance`, not the
drag gesture `ReaderProbe` uses for the same result. Because a Voice choice
also becomes the settings default, this is the only document that needs it:
the mini fixture's first open inherits the same voice.

`testDownloadShortFixture` and `testDownloadMiniFixture` select all and
download for real (real Fish Audio spend: 17 utterances, then 1). Expected:
the task completes on its first attempt, including its very first write into
a brand-new voice directory. Before #15 both failed once there, in this order,
with "Needs attention · The saved audio could not be verified." and recovered
on `testRetryBlockedShortFixture` (taps `Continue`): `saveClip` read the
payload's size without awaiting expo-file-system's asynchronous `move`, so the
sidecar recorded `size: null` and no payload survived (ADR 0027). A pass here
is one sample of a timing, not proof of the order; the faithful `move` in
`test/offline/storage.test.ts` is what holds it. To check a run, compare the
sidecar's `size` with the payload's bytes on disk. For a fresh directory
without spending on the short fixture, run `testDeleteAllSavedAudioReal`
against the mini fixture first: it removes that document's directory, so the
next `testDownloadMiniFixture` writes into a new one.

`testDeleteAllSavedAudioReal` and `testDeleteThisBookReal` are the
actually-confirm versions of `GeneralFontsProbe.testManageDownloadsDeleteAll`
and `LibraryActionsProbe`'s Delete-row check, which both cancel by design.
Run against the mini fixture only — never the short fixture, which stays
intact for the other checks. `testDeleteThisBookReal` removes the Library
entry; **the underlying `Documents/library/<id>.epub` file is not deleted**
(`use-library.ts`'s `remove` only filters the entries array), which is a
separate, minor, pre-existing orphaned-file observation, unrelated to #13/#14,
and incidentally why restoring the entry afterward needs only a `library.json`
edit.

`testReaderRespondsPromptlyAfterInterrupt` and `testSeekToSecondChapter`
support the interrupted-removal check: confirming Play responds in about a
second when launched right after a hand-applied `removals` marking transaction
for a *different* document, and moving the reading position into the short
fixture's second chapter (whose audio survives a chapter-deletion check)
without using Contents — this fixture's nav/spine mismatch (documented in
`library-and-reader/README.md`, `LibraryActionsProbe`) makes every Contents row inert here too, so the
position is moved with ten `Player.onSkip('next-sentence')` handler calls
instead of a tap.

`testDownloadDrawerShowsUpgradeMessage` and `testNetworkReadingHighlightMoves`
cover the store-failure fallback: with the stopped app's `catalog.sqlite` at
`PRAGMA user_version = 2`, the Download drawer shows "Update the app to read
this offline database." (twice — once as the chapter-list load error, once as
`downloads.downloadError()`) with `Download selected` disabled, and Play still
reads the current chapter over the network, with the same message repeated
inline as a reader notice ("Saved audio could not be checked: Error: …").
Two screenshots 2.5 seconds apart are the evidence the word highlight actually
advances rather than just appearing once; neither mode presses Play for
longer than establishing that.

None of these methods restore anything themselves (no in-place undo of a
delete, no PRAGMA restore, no backup/restore of the offline directory or
`library.json`) — every destructive one expects the caller to have backed up
first and to restore afterward, the same division of labour as `OfflineProbe`'s
`management` mode ([offline-narration.md](offline-narration.md)).
