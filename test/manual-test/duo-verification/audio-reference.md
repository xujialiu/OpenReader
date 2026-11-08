# The audio source reference (#353)

One real Clip with real Word Timings from the owner's actually configured
Provider, captured on the host through the app's own provider layer — the
reference a later **native** capture (a real Reading in the app) is compared
against. Nothing here plays audio, touches a simulator, or reads a microphone:
`capture` is one HTTPS request, `verify` is offline byte arithmetic.

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
  intact — only the sample hash still tells it apart), and gapped Timings
  (audio intact — caught by the timings hash and the end-past-clip bound).

`verify` exits nonzero if any line fails. It is a focused analyser for this
reference, not the long-drift median of `native-audio-match.py`, and not an
8 s continuity oracle.

## How the native capture uses it

The Clip is named by Provider, Voice and Speech Text (ADR 0028), so a native
Reading of the **same utterance** on the same Provider and Voice names the
same Clip: its audio and Timings should equal this reference byte for byte,
and any difference is a finding about the native path, not about the Provider.
The reference proves the PCM is nonzero and the Timings match the text; the
native observer still has to prove the rendered Reading follows them — that
part (#353) is not done here.

## Current capture

`/tmp/openreader-353-source-reference-01` (0700), captured 2026-11-08 from
`88bee0c`: Fish `s2.1-pro-free`, voice `en/179b5cc736974d96913c7849d0bb68c5`
("jjk narrator", en), synthesis 200 in 3.9 s, one chunk; 59,976 bytes MP3
(sha256 `aa146859…f1e92`), 24 kHz mono PCM 7.497 s (sha256
`96ad7c90…3d3c5`), 20 Word Timings, "The" at 0.00–0.16 s through "dawn" at
6.88–7.36 s, "12" timed at 3.52–4.08 s. `/tmp` is ephemeral: recapture costs
one request.
