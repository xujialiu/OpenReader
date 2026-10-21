# A server's passing failure no longer stops the reading

_The engineering half of this decision is
[ADR 0084](../adr/0084-a-server-error-is-asked-again-three-tries-in-all.md).
Issue [237](https://github.com/xujialiu/OpenReader/issues/237), with
[280](https://github.com/xujialiu/OpenReader/issues/280) and
[279](https://github.com/xujialiu/OpenReader/issues/279). The words are the
glossary's: a **Provider**, an **Utterance**, a **Reading** and a **Download**._

## Why

The app asks the Provider for one sentence at a time. A long book saved for
listening offline is thousands of questions. Now and then a server, or the
gateway in front of it, answers one of them with "something went wrong on our
side" instead of audio. Asked again a second later, it usually answers properly.

For three Providers (OpenAI, OpenAI Compatible and Kokoro FastAPI) the app did
not ask again. The first such answer stopped the voice in the middle of the
book, and in a Download it marked the whole chapter as failed and left the rest
of that chapter unasked. A Download left running overnight could end with
several chapters failed, each to be retried by hand. The other three Providers
already asked once more, so the same hiccup cost more or less depending on the
Provider the owner happened to use.

## What the author sees

- **The voice goes on.** When the server stumbles once or twice, the sentence
  comes a moment later and the Reading carries on. Nothing is shown.
- **A Download finishes its chapters.** The same hiccup no longer marks a
  chapter as failed.
- **Every Provider behaves the same.** Each sentence is asked at most three
  times, half a second and then a second apart, while reading as while
  downloading.
- **A server that stays down still says so.** After the third failed try the
  Reading stops with the same message as before, and the Download marks the
  chapter as failed, as before.
- **The messages name what to look at.** When the server of OpenAI Compatible
  cannot be reached, the message now names its Address, so the owner of a
  server of their own knows which machine to check. When Fish Audio's gateway
  answers with an error web page, the message gives the error's number and no
  longer shows the page's code.

## What it costs

- **A little more waiting before bad news.** When a server is really down, the
  Reading now stops about a second and a half later than before.
- **Possibly paying twice for one sentence.** A gateway can report a failure
  after the service behind it has already done the work and charged for it.
  Asking again may then be paid for twice. Downloads already took this risk
  when the connection dropped; now a Reading takes it too, for at most two
  extra questions per sentence.

## Turned down

- **Asking again only in a Download.** The voice would still stop at the first
  hiccup while listening. The author wanted the Reading to ride it out as well.
- **Asking again in both places, each on its own count.** A Download would then
  ask up to nine times for one sentence. The author set three as the most, in
  either.
- **Asking again after every kind of failure.** A wrong voice or a sentence too
  long for the Provider would be sent three times for nothing, and could cost
  three times.
