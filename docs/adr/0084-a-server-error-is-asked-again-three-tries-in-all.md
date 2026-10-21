---
status: accepted
---

# A server error is asked again, three tries in all

_Issue #237, with #280 and #279. The product argument is
[design 0084](../design/0084-a-servers-passing-failure-no-longer-stops-the-reading.md).
The owner chose this on 2026-10-21: a 5xx is asked again in a Reading as well as
in a Download, and an Utterance is tried at most three times in either. This
changes [ADR 0013](0013-provider-layer-is-copied-and-returns-pcm.md)'s "Other
statuses still never ask twice" and [ADR 0037](0037-azure-word-timings-come-over-a-hand-written-websocket.md)'s
5xx row._

## What it was

A 5xx answer to a synthesis was handled two ways. Fish Audio, Speechify and
Azure asked once more after 500 ms (ADR 0037). OpenAI, OpenAI Compatible and
Kokoro FastAPI never asked again: `statusError` in `openai-compatible.ts` and in
`local/kokoro.ts` made every status but 401, 403 and 429 a `SynthesisError` of
kind `unknown`. Either way the last 5xx was `unknown`, which is not retriable
(`errors.ts`), so the Download's bounded retry (`scheduler.ts`, three tries 1 s
and 2 s apart, for `network`, `rate-limit` and `local-server-down` only) passed
it straight to the chapter's failure. A Reading has no retry of its own: Play
asks again only when pressed (ADR 0027). So one 502, 503 or 504 from a gateway
in front of OpenAI Compatible stopped a Reading, and failed the chapter of a
Download it fell in, whose other Utterances were then not asked for. A Download
sends one request per Utterance, thousands for a long Document.

## The rule

- **A 5xx is the server's passing failure.** Every Provider asks the same
  synthesis again after one, three tries in all, 500 ms and then 1 s apart:
  `SERVER_ERROR_TRIES` and `serverErrorPause` in `server-error.ts`, shared by
  OpenAI, OpenAI Compatible, Kokoro FastAPI, Fish Audio, Speechify and Azure.
- **The same in a Reading and in a Download.** The retry is inside the
  Provider, below both callers, and well inside the 60 s each allows one
  synthesis.
- **Never a fourth.** A 5xx still there after the third try is reported as
  before, `unknown` and not retriable, so the Download's own bounded retry does
  not multiply the Provider's. A Reading stops on it, a Download fails its
  chapter, as for any other refusal.
- **A try is one synthesis as it was.** On the speech route it is the PCM
  request and, after a refusal of the format (400 or 422, ADR 0013), its MP3
  one; a server remembered as refusing PCM is asked for MP3 on the next try too.
  On Kokoro it is the captioned request and its fallback to the plain route, so
  a 5xx counts only when the plain route answers it as well. A 5xx on the
  captioned route alone still falls back, as before.
- **A retry is told apart by its status.** OpenAI Compatible and Kokoro throw a
  `ServerError`, a `SynthesisError` of kind `unknown` that carries the status,
  and `askThroughServerErrors` asks again only after one. Fish, Speechify and
  Azure keep their own loops, which also wait out 429s, with the shared count.
- **An abort stops the waiting.** After each pause the request's signal is read
  before asking again, so a synthesis whose 60 s deadline has passed sends
  nothing more. A pause or a skip in a Reading aborts no request
  ([ADR 0026](0026-a-coherent-reading-interface.md): a pause "does not abort
  requests, empty the queue, or discard arrived audio"), so a sentence already
  out goes on through its tries, three at most, and its Clip is kept for the
  next Play. Measured on the simulator: a pause 0.45 s into the first retry's
  wait left that sentence's second and third requests to go out.
- **The Debug Log shows each try.** Every request has its own `[provider]`
  line with its status, so a retried sentence reads `-> 503 -> 503 -> 200`,
  and its `synthesis … done` line counts the waits in its time. The clip's
  note (` after a retry of HTTP 502`, ` after 2 retries of HTTP 502, 503`) is
  carried with the result, but no Provider's note has reached the Debug Log
  since it began (#82): `clipFacts` in `runtime.ts` prints the audio and the
  Word Timings only.

Statuses below 500 are asked as before: 400 and 422 once more as MP3 on the
speech route, 429 waited out where a Provider does, and nothing else twice.
Fish's and Speechify's Voice lists share their request loop and get the same
three tries. The OpenAI Compatible Voice list is unchanged: a 5xx there is a
`network` failure that the Drawer asks again on its next open (ADR 0079).

## The messages that went with it

- **#280.** A synthesis on OpenAI or OpenAI Compatible that cannot reach the
  server says `Cannot reach <Address>: <reason>`, as its Voice list already
  did; it said only the system's reason. It stays `network`, which a Download
  retries and a Provider does not.
- **#279.** Fish's `refusal()` quoted a body that was not its JSON reason, so a
  Cloudflare error page in front of api.fish.audio reached the Reading as
  `HTTP 502 — <!DOCTYPE html> …`. A body that starts with `<` is no longer
  quoted, and the status stands alone, as Speechify and OpenAI Compatible say
  it. A short plain-text reason, the Voice list's 401 "No permission -- see
  authorization schemes", is still quoted.

## Turned down

- **Only make the last 5xx retriable**, so that the Download's retry covers it.
  A Reading would still stop at one 5xx. The owner turned it down.
- **Ask again in the Provider and also make the last 5xx retriable.** A
  Download could then send nine requests for one Utterance, against the
  owner's three.
- **Retry every failure in the scheduler.** A wrong Voice id or an input too
  long for the Provider (400) would be sent three times, and a Reading would
  still stop.

## Cost

A Reading waits up to 1.5 s more, plus the two extra answers, before it stops
on a server that stays down. A 5xx is an answer without audio, but a gateway's
504 can come after the server behind it did the work, so a retry may be paid
for twice. A Download already took that exposure for a lost connection
(ADR 0079); a Reading now takes it for at most two more requests per Utterance.

## Verification boundaries

Provider tests drive each Provider's 5xx with `fetch` (or Azure's socket)
doubled and the pauses recorded: one 5xx then audio, two then audio, three and
the failure, statuses below 500 never asked again, and an abort during the
pause. `test/offline/runtime-response.test.ts` keeps the real runtime, factory,
Providers, scheduler and Reading Clip fetcher with the clocks faked: a Reading
past one 503, a Download chapter past one 502 with nothing failed, and a 503
that stays, asked three times by a Reading and three times by a Download.

On the simulator (1.0.0 (12)-beta5-debug, an OpenAI Compatible Provider at the
local fault server of `test/manual-test/voices-and-providers/`, its new
`flaky-503` mode): a Reading spoke on with every sentence answered 503, 503,
200, the pauses measured 505–573 ms and 1006–1060 ms; a Download chapter
finished with nothing failed at three requests per text; a 503 that stayed
stopped the Reading on `OpenAI Compatible speech: HTTP 503` and failed the
Download's chapter, each after exactly three requests for a text; and with the
server stopped the note began `Cannot reach http://127.0.0.1:PORT` (#280).
Fish's web page (#279) was not run there, as it needs Fish itself. No real
server's 5xx was captured; the gateway page is Cloudflare's usual shape.
