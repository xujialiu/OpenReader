# Verifying #306: Delete all current voice audio (1.0.0 (9)-beta13, 2026-10-20)

Record of the iOS verification of 7853b32 (`feat: delete all of the managed
Voice's audio from Manage downloads (#306)`), on a session-created iPhone 17
Pro simulator (iOS 26.5, UDID 0BF2A961-7862-4AD5-8C96-76CA0DDEA341), from the
`delete_download/.worktrees/ios-check` sub-worktree's own Metro (port 8085).
The installed Debug app (1.0.0, build 9, built 2026-10-20 00:18) carries
main's native side; the JavaScript came from Metro, and Settings showed
`Version 1.0.0 (9)-beta13-debug`. No playback ran and no paid Provider was
touched: the Document is the short fixture (`A Short Test of Reading Aloud`,
chapter `The First Chapter` only), and the Provider is the app's Local Kokoro
against `fake-kokoro-two-voices.cjs` (a two-voice variant of the kit's fake
Kokoro-FastAPI, written for this run) on 127.0.0.1:8811, serving
`af_bella — Bella (fake)` (Voice A) and `af_nova — Nova (fake)` (Voice B).

Both downloads ran through the app's own offline runtime with the kit's
`download-chapter.cjs` — ten synthesis requests each, answered with silent
PCM — and the first request raised the Consent question, answered through the
preflight recipe (`ax.py alert` read, recipient checked against the fake's
address, `Allow`). The Document's Voice was put on A with a real touch on
`Use downloaded voice · af_bella`; B's clips were downloaded from B only
through the runtime, so B's own label on every page is its voice id
(`af_nova`), not the fake's display name — an artifact of
`download-chapter.cjs`'s `label: voice` argument, not of the app.

## The row, and what it deletes

- **One row, two red buttons.** On Manage for Voice A (`Voice · Bella (fake)`
  / `0.1 MB saved`), the AX tree read `Delete all audio` at {31, 725}
  101×16 pt and `Delete all current voice audio` at {179, 725} 191×16 pt on
  the 402 pt screen: one row, `Delete all audio` at the row's left inset,
  `Delete all current voice audio` right-aligned at its end (370 pt = 402 −
  32), 47 pt between them, neither truncated nor wrapped (one 16 pt line
  each; the plan estimated ~103 pt and ~194 pt at 15 pt text). Both labels'
  reddest pixels are RGB (138, 47, 24) — `INK.attention`'s light #8a2f18.
  Screenshot `02-manage-voiceA-row.png` in the run's `/tmp` directory.
- **`Manage · af_nova` is listed** under it, as the other Voice with saved
  audio.
- **The confirmation names Voice, Provider and the page's own figure.**
  Pressing `Delete all current voice audio` raised exactly:
  `Delete all current voice audio?` — `All saved audio for this document in
  Bella (fake) (Kokoro FastAPI) will be deleted, freeing 0.1 MB. Other
  voices' audio, the document and reading position will be kept.` — with
  Cancel and Delete. `0.1 MB` is the page's `0.1 MB saved` line (125,770
  bytes). For B the same alert read `af_nova (Kokoro FastAPI)` with the same
  figure. No Fish Model appears — the Provider is not Fish.
- **Cancel changes nothing.** Cancel left the page byte-for-byte (same
  buttons, same `0.1 MB saved`) and the catalogue's 20 clips untouched.
- **Confirming A's deletion leaves Manage open on the player's Voice.** After
  Delete: still `Back from Manage`, `Voice · Bella (fake)`, `0.0 MB saved`,
  an empty chapter list (no `…, downloaded` rows), **no**
  `Delete all current voice audio` button (the Voice has nothing saved),
  `Delete all audio` still there, and `Manage · af_nova` still offered.
- **B survives, three ways.** The persisted catalogue (app terminated, the
  offline directory copied) held exactly B's voice key
  `8aeecf116a01…` with 10 ready clips, 125,770 bytes — A's key
  `da522836e955…` had no clips and its `voices` row was gone — and B's ten
  `.m4a` payloads were still on disk under B's voice-key directory while
  A's directory was empty. On the page, `Manage · af_nova` →
  `0.1 MB saved`.
- **The Voice's Download ends with its audio.** After A's deletion the
  Download page (relaunched app) reads `0 chapters downloaded` for A and
  still offers `Use downloaded voice · af_nova`; the `state` table's `tasks`
  JSON afterwards held only B's task.
- **Tapping `Manage · af_nova` brings the button back** (`Voice · af_nova`,
  `0.1 MB saved`, both delete buttons), and **confirming B's deletion returns
  the drawer to the Download page**: `Back from Download`, no
  `Manage downloads` link, no `Delete all` buttons anywhere in the tree.
  Persisted: `clips` empty, `tasks` `[]`, both voice-key directories empty.

## Delete all audio, again

With B's chapter downloaded again (`0.1 MB` the document's only audio),
Manage for A showed `0.0 MB saved` and **no** `Delete all current voice
audio` (A has nothing) beside `Delete all audio`. Pressing the latter raised
`Delete all audio?` — `All saved audio for this document, across all
providers, models and voices, will be deleted, freeing 0.1 MB. The document
and reading position will be kept.` — and confirming it returned the drawer
to the Download page with everything gone: `clips` 0 rows, `tasks` `[]`, and
the document's whole `27fa5ef2…` directory deleted from disk.

## What ran as probes, and what did not

- `GeneralFontsProbe.testManageDownloadsDeleteAll` (the direct one: renamed
  label, confirmation, always cancels) — **passed** against this tree after
  two stale-gesture fixes the 2026-10-02 pitfall already prescribed for its
  next run (`Back to downloads` → `Back from Manage`; the sheet-closing swipe
  instead of the removed `Close Download` button): `Executed 1 test, with 0
  failures (0 unexpected) in 17.177 seconds` (result
  `result-20261020-015056-7709.xcresult`, its `manage-downloads-1-*` and
  `-2-confirm` screenshots exported beside it). It found `Delete all audio`
  on a cold launch, raised `Delete all audio?` naming a size, cancelled, and
  the catalogue afterwards still held B's 10 ready clips, 125,770 bytes.
  Runs 3 and 4 before it (`result-20261020-014057-92189` and
  `-014436-98005`) failed the same way, for a reason outside the change: a
  violated precondition. Both passed the count-line wait and failed at the
  `Manage downloads` wait (lines 189–190): the probe expects saved audio, and
  the Delete all audio above had removed it, so `Manage downloads` was
  correctly absent (#37). Their failure-time hierarchy shows the Download page
  with `Download selected (0)` and no `Manage downloads`. The chapter was
  downloaded again only after run 4; runs 5 and 6 then passed.
- `OfflineFixProbe` (its `testDeleteAllSavedAudioReal`), `DownloadRingProbe`
  and `PauseOrderProbe` configure Fish Audio and download with the owner's
  key: not run, so no paid synthesis. Their #306 changes are the renamed
  label in assertions only; the label's behaviour is covered by the touches
  above and by `GeneralFontsProbe`.
- **A 375 pt screen: not covered.** A session-created iPhone SE (3rd
  generation, iOS 26.5) was created for the narrow-screen check, but its
  install hung twice past three minutes while four simulators were booted
  (two other sessions' among them); the device was deleted on the parent agent's
  instruction once the owner noticed it. The row's fit at 375 pt rests on the arithmetic (326 pt
  between insets vs measured 101 + 47 + 191) and the 402 pt measurement.

## Observations outside the change

- Opening the Download drawer with no Voice chosen writes a `voices` row
  with an empty `voice_id` (`43106f7a…`, provider `local`) —
  `requestProgress` registers the drawer's empty choice. Pre-existing
  (the effect is untouched by #306), harmless: no clips ever attach to it.
- After a Voice's deletion, the player's Voice row is re-registered in
  `voices` the next time the drawer opens (`registerVoice` on progress),
  leaving a `voices` row with no clips and an empty directory. Also
  pre-existing behaviour of the drawer, not of the deletion path; the
  catalogue's own numbers (0 clips) are what the pages show.

`fake-kokoro-two-voices.cjs` stays beside this record: the same fake
Kokoro-FastAPI as the kit's, serving the voices its `OPENREADER_FAKE_TTS_VOICES`
JSON names (default Bella + Nova), for any check that needs two no-cost
Voices with saved audio.
