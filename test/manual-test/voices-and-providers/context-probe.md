# Sentence or paragraph requests (#61, `context-probe.ts`)

`context-probe.ts` compares asking a provider for one sentence at a time, as the app does, with asking for a whole paragraph in one request. It runs in Node through the app's own `createProvider`, `segmentBlocks` with `splitWithSentencex`, and `prepareSpeechText`, so both modes send exactly the text the app would. No simulator is involved. It reads credentials from `~/.secrets/openreader/zotero-tts-settings.json`, the desktop plugin's settings export, and `OUT` must be outside the repository, because it receives the owner's book text.

```sh
OUT=/path/outside/the/repo; B=~/Works/epub_books
npx tsx test/manual-test/voices-and-providers/context-probe.ts survey "$OUT" "$B/Shadow Slave/Shadow Slave 1-250.epub" …   # sentences per Block
npx tsx test/manual-test/voices-and-providers/context-probe.ts pick   "$OUT" "$B/…epub" …   # candidates.json; write paragraphs.json from it by hand
npx tsx test/manual-test/voices-and-providers/context-probe.ts run    "$OUT" azure fish speechify local   # audio/<provider>-<P>-{sentence,paragraph}.wav + .json
npx tsx test/manual-test/voices-and-providers/context-probe.ts analyze "$OUT" -40   # analysis-40.{txt,json}; run again at -30
npx tsx test/manual-test/voices-and-providers/context-probe.ts page   "$OUT"   # listen.html, a blind A/B page; open it locally
```

`paragraphs.json` is a list of `{ id, book, section, kind, utterances }`, the shape `pick` writes. Voices are the owner's own where a match exists (`VOICE_MATCH`); otherwise the first English voice is used. Each provider gets one warm-up `Hello.` first. The six paragraphs of 2026-09-24 came to about 2,300 characters per mode per provider.

What it measures: time from `synthesize` to its result (the first sentence against the whole paragraph), total duration, timed words, and the pause at each sentence boundary. The per-sentence pause is the trailing silence of one Clip plus the leading silence of the next. The whole-paragraph pause is the longest silence from the last word's start to the next sentence's first word's end, alongside the gap the timings leave. Results are in `notes/NOTES_2026-09-24.md`.

What it cannot show: latency from the phone's network (it runs from the Mac, through whatever proxy the Mac uses); how iOS's `decodeAudioData` treats Fish's MP3 padding (ffmpeg drops the encoder delay the LAME header declares); the Blocks the renderer would find where a book's stylesheet makes a block element inline; anything about OpenAI or OpenAI-compatible voices, which return no timings and were not configured. The listening page randomises A/B per pair in the browser and keeps the order and answers in that browser's `localStorage`, so clearing it draws new orders.
