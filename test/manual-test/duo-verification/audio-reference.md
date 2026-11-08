# The audio source reference (#353)

One real Clip with real Word Timings from the owner's actually configured
Provider, captured on the host through the app's own provider layer — the
**network/source answer** a later **native** capture (a real Reading in the
app) is compared against *by content*. Nothing here plays audio, touches a
simulator, or reads a microphone: `capture` is one HTTPS request, `verify` is
offline byte arithmetic.

Not this recipe's job, and never claimed by it: the rendered Reading, the
native observer, the highlight following at a Line Position, or App Consent —
Consent is answered in the app, by the owning native tester, per
[`consent.md`](../voices-and-providers/consent.md).

## Usage

```sh
npx tsx test/manual-test/duo-verification/audio-reference.ts capture OUT_DIR
npx tsx test/manual-test/duo-verification/audio-reference.ts verify  OUT_DIR
```

`OUT_DIR` is created private (0700, files 0600) and stays **outside the
repository** — it holds the owner's chosen voice and the clip named by it.
`capture` makes exactly **one** synthesis request: one utterance ≤ 25 words of
synthetic public fixture text (`UTTERANCE` in `audio-reference.ts` — never
owner book text). A retry happens once, and only for a `network` kind of
failure; a server answer is never asked again. `verify` re-reads what capture
wrote and spends nothing.

The Provider is whoever `kit/node-kit.ts`'s `loadSettings()` actually
configures — the owner's own settings export in `~/.secrets/openreader/`,
read through the app's `createProvider` (ADR 0013), not a copied request and
not a parallel service. It is whatever provider both is enabled there and
returns Word Timings over plain HTTP (ADR 0005): Fish today, model
`s2.1-pro-free`, the owner's own reference voice. If a provider returns a clip
without timings, that is not a Word Timings control; configure and choose
another actually-configured timed provider rather than interpolate (ADR 0005).

## What capture records

- the recipient as host + path only (no query, no headers — the key rides in
  `Authorization` and is never logged); every request's status and latency;
- the real Voice resolved through the provider's own listing (id, public
  label, locale) and the Model;
- the raw clip bytes as the server sent them (`clip.mp3`, Fish answers
  `audio/mpeg`), their sha256;
- the lossless decode: 16-bit mono PCM at 24 kHz (`clip.pcm`, and `clip.wav`
  for convenience), its sha256, sample count and duration — decoded by ffmpeg
  exactly as `kit/node-kit.ts`'s `toPcm` does for every probe;
- the Word Timings as returned (`timings.json`): seconds into the clip and
  UTF-16 offsets into the utterance's own text — source coordinates, since the
  fixture text carries nothing for `prepareSpeechText` to strip;
- the text hash and everything above in `reference.json`.

Nothing printed or written contains a credential: the command redacts every
string it emits against the secret values it loaded, and the request log keeps
URLs as host + path.

## What verify proves

Fully offline, against the recorded hashes and the files themselves:

- the clip and PCM bytes are intact and the PCM is real sound (nonzero
  samples, a real peak);
- the Timings are real: nonempty, each names a word of the utterance at its
  own character offset in order, first word at character 0, and **every
  Timing's own span carries sound in the PCM** (10 ms-window RMS against the
  clip's peak, −35 dB floor) — a Timing pointing at silence is a fail;
- the last Timing ends inside the clip;
- the four negative controls on copies are all refused: dropped audio,
  repeated audio, an equal-frame-count replacement (duration and Timings
  intact — within this analyser, which compares hashes and never waveforms,
  only the sample hash still tells it apart), and gapped Timings (audio
  intact — caught by the timings hash and the end-past-clip bound). These
  controls establish the **integrity of this saved reference**; they are not a
  rendered-continuity or timestamp-gap detector for the live Reading's output.

`verify` exits nonzero if any line fails. It is a focused analyser for this
reference, not the long-drift median of `native-audio-match.py`, not an
8 s continuity oracle, and not a waveform-alignment framework — a rendered
waveform analyser is the PCM implementer's separate tool and is not built here.

## How the native capture uses it

The Clip is named by Provider, Voice and Speech Text (ADR 0028), so a native
Reading of the **same utterance** names the same Clip for caching. That is a
*name*, not a byte guarantee: a new synthesis on the same Provider/Voice/
Speech Text may come back **byte-different** — the server can regenerate
stochastically or serve a different cached copy — and the app's native
decode, resampling and WSOLA time-stretch are not host-PCM16-hash identical
even for the same bytes. So the native comparison is **by content**: duration,
the Timings (start/end/char offsets), and waveform alignment between the
host-decoded reference and the locally captured audio, with host timestamps —
never by hash equality of PCM bytes. The recorded hashes here prove one thing
only: that this saved reference is intact as captured.

Sample lanes, named separately and never conflated:

- **Network/source samples** — what the Provider returned; this reference.
- **Cache samples** — what the app stored for that name (Offline Narration's
  `offline-narration-v2` payloads, in the app's own storage format).
- **Rendered samples** — what the audio graph plays after native decode,
  resampling and time-stretch; a different format, channel count and rate is
  expected, and byte/PCM hash equality is not evidence there.

The reference proves the source PCM is nonzero and its Timings match the text;
proving the rendered Reading follows them (#353) is the native observer's work,
not done here.

## Current capture

`/tmp/openreader-353-source-reference-01` (0700), captured 2026-11-08 from
`88bee0c`: Fish `s2.1-pro-free`, voice `en/179b5cc736974d96913c7849d0bb68c5`
("jjk narrator", en), synthesis 200 in 3.9 s, one chunk; 59,976 bytes MP3
(sha256 `aa146859…f1e92`), 24 kHz mono PCM 7.497 s (sha256
`96ad7c90…3d3c5`), 20 Word Timings, "The" at 0.00–0.16 s through "dawn" at
6.88–7.36 s, "12" timed at 3.52–4.08 s. `fish.freeOnly` routes the request to
`s2.1-pro-free`; the recorded request documents the **requested free routing**
and is not an independent billing audit. `/tmp` is ephemeral: recapture costs
one request.

## Next stage: the actual Clip and Timings a Reading used

Read-only, through seams that already exist — no new hooks, schema, or cache
format. The rendered-waveform analyser and the test-only observer are the PCM
implementer's lane (owned by the parent's delegate ba247…); this recipe only
documents how to read what the app itself stored.

- **Cache lane (stored clips).** A Download saves each clip under the app's
  existing Offline Narration store, addressable without any app change:
  `xcrun simctl get_app_container SIMULATOR_UDID data` →
  `Documents/offline-narration-v2/<sha256(document id)>/<sha256(narration
  identity)>/<sha256(Speech Text)>.json` — the metadata carries the stored
  `format` (`alac` | `gzip-pcm` | `encoded`), `sampleRate`, `mediaType` and
  the clip's stored **Word Timings** — beside the payload
  `<sha256(Speech Text)>.audio` or `.m4a`. All three hashes are computed by
  the app's own `src/offline/catalog-keys.ts`/`audio-paths.ts` (`documentKey`,
  `voiceKey`, `audioKey` — keyed on the Speech Text, ADR 0028), so a host
  script can compute the address and copy the files out read-only. These are
  **cache samples**, not rendered ones.
- **Network/source lane.** This reference is that lane's answer for this
  utterance. A Reading may hit the Provider again rather than a cache; its
  answer can differ byte-wise from this file (see above) while carrying the
  same Timings for the same text.
- **Rendered lane.** Only a capture of the running audio graph is evidence of
  what was played — the observer's lane, not this one. Native unit frames may
  differ in format, channel count and rate from the host PCM; the observer
  must align waveform/content plus host timestamps and reject external drop,
  repeat, same-length replacement and timestamp-only gaps while accepting an
  honest positive. That analyser is **not implemented here and not tested**;
  this file records it as a requirement, not an achievement.

Do not stage audio into the app by writing the store: `Documents/Inbox` + the
`hx.cjs` harness protocol is the supported staging seam, and it carries
documents, not clips.
