# Azure Speech: configuration, the voice sheet, and word-level highlighting (#39)

`AzureProviderProbe.swift`, through `kit/run-probe.sh` (the target scheme is
still `LockScreenProbe`; only the source file differs):

```sh
bash test/manual-test/kit/run-probe.sh AzureProviderProbe SIMULATOR_UDID /tmp/openreader-azure-provider-01 \
  -only-testing:testProvidersOrderAndAzureScreenControls
```

Prerequisites: the latest Debug app connected to Metro, the owner's Azure key
and region in two host-only files (never printed, logged, or checked in —
`chmod 600` them, one credential per line, and remove them when done):

```sh
printf '%s' "$AZURE_API_KEY" > /tmp/openreader-azure-key.txt
printf '%s' "$AZURE_REGION" > /tmp/openreader-azure-region.txt
chmod 600 /tmp/openreader-azure-key.txt /tmp/openreader-azure-region.txt
```

The methods, each its own `-only-testing` invocation and meant to run in this
order because later ones depend on state earlier ones leave (Azure enabled, a
voice chosen), the same division `OfflineFixProbe`'s methods use:

- `testProvidersOrderAndAzureScreenControls` — no credentials, free: the
  Providers list order (Azure between OpenAI Compatible and Speechify), the
  Settings version line, and the Azure screen's controls (Enable switch,
  masked API key field with Show/Hide, Region field, Test connection).
- `testAzureConnectionWordingsAndEnable` — free (voice-list checks or
  client-side format checks, no synthesis): a wrong key, a wrong region, an
  invalid region id, and an unreachable region each produce their own wording,
  then the real key and region succeed and Azure is left Enabled. Idempotent:
  `ensureAzureDisabled` unlocks the fields first regardless of what state the
  screen starts in.
- `testVoiceSheetShowsAzureAndChoosesEnglishVoice` — needs the English fixture
  in the Library. Opens the voice sheet, measures the time from tapping the
  Azure chip to the locale row appearing, dumps the full accessibility tree
  (for a host-side count of locale chips — grep it for
  `label: '[a-z]{2}(-[A-Za-z0-9]+)*'`, about 154 expected), checks zh-CN's
  `晓晓` and the `multilingual` group's `Ava Multilingual`/`晓晓 多语言`, swipes
  the locale row, and confirms a MAI voice sits under its own locale (en-US)
  next to a Neural one — then chooses Andrew and leaves the sheet.
- `testPlayEnglishAzureVoiceHighlightsWord` / `testChineseAzureVoiceHighlightsWord`
  — a real Play touch, three screenshots roughly 2.5 s apart (about 5 s of
  playback, enough to see the mark move), then a real Pause touch. Needs the
  Chinese fixture for the second one, with zh-CN → 晓晓 chosen first.
- `testMAIVoiceHighlightsWholeUtterance` — same shape, with `Ethan MAI-Voice-2`
  chosen first; the mark should cover a whole sentence, never a single word.
- `testBackgroundDuringAzureReading` — waits past the initial buffering (the
  `Pause` label exists, and is `busy`, before the first clip arrives — see
  the playback methods' own first screenshot) so the "before" capture shows
  real progress, then backgrounds the app for 30 s and returns. Measured
  2026-09-22: "before" had the heading of Chapter 1 marked (`Ethan
  MAI-Voice-2` highlights a whole Utterance); "after" had a sentence from the
  *start of Chapter 2* marked — several Utterances further, across a chapter
  boundary, entirely while backgrounded, with no red box and the transport
  still coherent.

None of these methods spends more than a handful of free voice-list requests;
the playback methods are real synthesis (Azure's free tier) and are the only
ones that cost characters — a few short sentences each.

What it does not establish: the exact RN facts in ADR 0037 that are not
visible from a touch or a screenshot — the WebSocket close reason's exact
text and code, and binary frames arriving as `ArrayBuffer`. The close reason
is measured with the two-`cdp.cjs`-call technique ([../kit/README.md](../kit/README.md)); a successful,
audible play with a moving highlight is what stands for the `ArrayBuffer`
fact, since `azure-ws.ts`'s `parseBinaryFrame` throws on anything else and no
audio would have played at all.
