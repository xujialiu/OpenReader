# Verifying #229: the Fish Model is chosen in Settings (1.0.0 (8)-beta16, 2026-10-17)

Record of the iOS verification of 57b23ae (`feat: choose Fish Models and keep
their Downloads separate`), on a session-created iPhone 17 simulator
(iOS 26.5, UDID in the run's report), app from the worktree's own Metro
(port 8082). The owner's API key came from `~/.secrets/openreader` and was
typed through the masked field per the #228 recipe; no paid synthesis ran:
every `drama-3` observation used seeded audio or request-shaped evidence, and
each play was preceded by `silence.sh check` and stopped once established.

## Settings: the Model list, its labels, and its lock

- **Discovery failure keeps the known four.** With `breakfetch` armed against
  `api.fish.audio`, opening the Fish Audio page logged the refused
  `GET /compat/v1/models`, showed "Additional Models could not be loaded.
  Reopen this page to try again.", and the Model menu still opened with exactly
  `s2.1-pro-free — free`, `s2.1-pro — paid`, `drama-3 — paid`, `s2-pro — paid`.
- **Live discovery appends `s1`.** Unbroken, the menu listed the four known
  entries first, then `s1 — paid` from the keyless compat list, then a saved
  unlisted choice. Labels say free or paid only; the compat prices never
  appear.
- **The footer carries no date.** "Fish Audio determines the free Model's
  availability and terms. It retains your text and has no speed guarantee.
  Paid Models use your Fish Audio credit." — no year, no countdown, anywhere
  on the page or in the tree.
- **The row locks while enabled.** With Fish enabled ("Turn off to edit."),
  touching the Model row opened nothing. Disable → select `drama-3 — paid` →
  enable read "Connection successful" with the row locked again; the same
  round-trip selected `s2.1-pro-free` back.
- **The connection check synthesizes nothing.** A wrapper around
  `globalThis.fetch` (installed with the kit's `cdp.cjs --eval`) captured every
  `api.fish.audio` request across two enable cycles: five `GET /model?…`
  voice-list calls, zero `POST`s to the TTS route.
- **A saved unlisted Model is kept and shown by id alone.** After
  `fish.model = "zz-my-model-9"` (harness patch, then a relaunch) the row read
  `Model, zz-my-model-9` with no free/paid suffix, and the menu appended
  `zz-my-model-9` after the discovered entries. A relaunch kept it.
- **The selection survives a relaunch.** `drama-3 — paid`, enabled, was still
  selected after `simctl terminate` + `launch`.

## Download and Manage name Model and Voice on two rows

Both pages rendered, as separate rows:

    Model · Fish Audio · s2.1-pro-free
    Voice · Aarav

and, with the real Fish voice `Charlotte — Female conversational voice (EN)`
as the Document's voice, the Voice line wrapped onto its own second line
(frame height 35 pt against the Model row's 17) while the Model row stayed
one line. The rows are `StaticText` — no Model control exists anywhere in the
drawer; the only picker in the app is the Settings row.

## A Model change pauses Fish work; returning never auto-resumes

- **A live flip caught mid-flight.** With a 70-utterance real-book chapter
  (Pride and Prejudice, Part 2, the owner's copy) downloading under
  `s2.1-pro-free`, the Model was switched away through the real Settings flow.
  On returning to `s2.1-pro-free` the drawer showed the task **paused**
  (`Resume all`), not running and not failed; nothing resumed it but an
  explicit touch, which then drove it to completion ("Downloading…" → done).
- **The startup path, deterministically.** A two-chapter task was killed
  mid-synthesis (`simctl terminate`), the switch was made with the app closed
  (`settings.json` `fish.model → drama-3`), and the relaunch left the task
  paused: no `[download]` activity after launch, only voice-list GETs. After
  switching back through the app the drawer exposed the paused task with its
  partial audio ("1 chapters downloaded", `Resume all` waiting).
- **What the sweep skips.** A task that had already given up before the flip
  (`done` with a failed chapter) stayed done-with-failures — `state !== 'done'`
  is the sweep's boundary, matching the unit test.
- **Fixtures are too fast for flip races.** The short fixture's 24 clips
  finished in under 30 s, and a second run of the same five chapters finished
  within ~4 s of its start against a ~15 s touch sequence; only a real book's
  chapter stayed unfinished long enough to catch mid-flight. The pause-order
  fixture, five chapters of two sentences, is unusable for this check.
- **Other Providers on device: not covered.** Every other enabled-provider
  path spends (Speechify, Azure, OpenAI) or was unreachable (the owner's
  Kokoro host answers 403). Non-interference rests on
  `runtime-fish-models.test.ts` ("keeps other Providers running"), which the
  ADR cites.

## Seeded audio: Model isolation, deletion, playback

`catalog.sqlite` was seeded (app terminated) by copying the free voice's
directory and rows under the drama-3 identity — `voiceKey` computed with
**JavaScript** separators (see the pitfall below), a `voices` row with
`model='drama-3'`, and a matching `done` entry in the `state` table's `tasks`
JSON (without the task row the drawer's marks stay at zero by the #146 rule:
a chapter counts only inside its voice's own download). All of what follows
used that seeded drama-3 audio, labelled as such; the bytes are the free
download's, never a paid synthesis.

- **Isolation.** With `drama-3` selected, doc1's drawer showed
  `Model · Fish Audio · drama-3` / `Voice · Aarav` and "1 chapters
  downloaded" from the seeded rows; the free Model's task (done, one failed
  chapter) was hidden, and the free Aarav voice produced no other-voice row.
  With `s2.1-pro-free` selected the free view returned and the drama-3 voice
  was the one hidden.
- **Deletion is scoped to the shown Model.** Manage under `drama-3` → select
  the First Chapter → Delete → the seeded `04ed883d…` clip rows were gone from
  `clips` while the free `6ff24a89…` rows survived, and the free view still
  showed the chapter downloaded afterwards.
- **Playback under a paid-selected Model used saved audio only.** With
  `drama-3` selected, a 5 s play (silence checked immediately before) advanced
  to utterance 3 with word-level highlighting from the seeded clips while a
  `watchfetch` wrapper logged zero TTS requests — one keep-warm `GET /` only.
  Had isolation failed, this play would have gone to the network under a paid
  Model; it did not.
- **Delete all saved audio names its whole scope.** The confirmation read
  "All saved audio for this document, across all providers, models and
  voices, will be deleted, freeing 0.6 MB. The document and reading position
  will be kept." — confirmed once against the Pause Order Fixture (regenerated
  freely afterwards).

## The old free audio keeps its address

After `UPDATE voices SET model=NULL` for the free Aarav row (the exact shape
the v1→v2 migration leaves) and a relaunch, the free view still showed the
chapter downloaded: a NULL Model reads as `s2.1-pro-free`, and the voice key
is the model-less `["provider","voice"]` hash — `6ff24a89…` — byte for byte
the address a pre-#229 build wrote.

## What was not verified on device

- **No `model` header read off the wire.** The wrapper logs methods and URLs,
  not headers; the exact selected-Model header is `fish.test.ts`'s assertion.
  The on-device error string `Fish Audio s2.1-pro-free: cannot reach …`
  (from a `breakfetch` run) does name the selected Model at the synthesis
  call.
- **Another Provider's download unaffected by the switch** (unit-only, above).
- **Fish Speech on the phone** does not exist as a provider page in this app;
  nothing there could change.
