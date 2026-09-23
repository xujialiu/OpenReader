---
status: accepted
---

# A quiet Provider connection is warmed before it is used, and kept warm while saved audio plays

_The product argument is
[design 0040](../design/0040-the-reading-goes-on-into-a-chapter-that-is-not-downloaded.md)._

## The defect (#26)

The first synthesis after a quiet spell failed with `fetch failed:
UnexpectedException: The network connection was lost.`, surfaced as a `network`
`SynthesisError` from `request` in `fish.ts`, and the reading stopped at that
sentence.

Measured with a Swift `URLSession` probe on the Mac
(`notes/NOTES_2026-09-22.md`, 02:29):

- Fish's replies advertise `alt-svc: h3=":443"; ma=86400`, and from the second
  connection on every request went over HTTP/3. The app does the same: its
  connection store on the iPhone 17 simulator holds an HTTP/3 entry for
  `api.fish.audio`.
- Reusing a connection idle 20, 45, 50, 55 or 58 s worked. All 9 reuses after
  60–120 s stalled, sent two keep-alive probes a second apart, and gave up with
  `NSURLErrorDomain -1005 "The network connection was lost."`
  (`_kCFStreamErrorDomainKey=4, _kCFStreamErrorCodeKey=-4`) after 6.7–6.95 s.
  A keyed `s2.1-pro-free` synthesis after 100 s idle failed the same way, after
  6760 ms.
- **CFNetwork retries a GET and never a POST.** A GET was retried
  (`could retry(Y) … has forbidden protocols`) on a new HTTP/2 connection and
  answered 200 after 7.1–7.2 s in total. A POST was not
  (`idempotent(N) … bytes written(Y) … can retry(N)`), and every synthesis is a
  POST.
- HTTP/2 over TCP on the same path survived 45, 60, 90 and 200 s idle.
- The path: Clash Verge Rev runs its mihomo core in TUN mode, and its outgoing
  UDP socket for a connection disappears about 60 s after its last packet.

Measured in the app on the iPhone 17 simulator (iOS 27.0), Fish Audio
`s2.1-pro-free` (`notes/NOTES_2026-09-23.md`, 12:57 and 13:48):

- `Boundary Fixture` with chapter one downloaded, 107 s after the last request to
  `api.fish.audio`: the POSTs for chapter two's first two Utterances failed after
  6,428 and 6,425 ms, and the two sent straight after answered 200 in 2,473 and
  2,640 ms. About 61 s after the last request: no failure.
- `Cultivation Online 2001-2044` about 70 s after launch — the start-up voice
  listing of ADR 0033 is the last request — both first POSTs failed after about
  7 s. About 3 min 13 s after the last request, nothing failed: iOS had closed the
  idle connection itself.

So the failure needs a connection quiet for about a minute but not yet closed by
iOS, and three ordinary moments make one: a paused reading resumed, the first Play
a minute or so after launch, and — the commonest — a downloaded chapter, because
saved audio is read from disk and sends nothing at all. When the reading nears the
first Utterance without saved audio, the read-ahead asks for two at once, and both
go over the dead connection.

Every Provider made by `createProvider` sends through `providerDeps.fetch` in
`src/app/settings.ts`; its callers are `src/offline/runtime.ts` (synthesis for
reading and downloading), `src/app/use-voices.ts` (voice lists) and
`src/app/provider-connection.ts` (the connection check). Azure's synthesis is the
exception: `turn` in `azure.ts` opens a WebSocket of its own for every Utterance,
so it never reuses an idle connection.

## What was decided

`src/core/warm-connections.ts`, platform-free, with `fetch` and the clock
injected, is the `fetch` in `providerDeps`. It records, per origin, when a request
to it last **settled** — an answer or a failure, since a failure still went over
the connection — and does two things:

- **Warm before sending.** A request whose method is not GET, to an origin that
  has settled before and has been quiet for at least `QUIET_MS` (30 s) since,
  first sends `GET <origin>/` and waits for it for at most `WARM_UP_TIMEOUT_MS`
  (15 s, through `withTimeout`, which then aborts it). What it answers, or that it
  failed, is ignored: the request goes on either way. Requests sent together
  share the one warm-up in flight, so the read-ahead's two POSTs cost one GET.
  If the connection was dead, the GET is what CFNetwork retries on a fresh one,
  and the POST goes out after it.
- **Keep warm.** `keepWarm(origin)` sends the same GET without waiting for it,
  when the origin has been quiet for `KEEP_WARM_MS` (20 s). A warm-up in flight is
  joined rather than repeated, and its settling is contact, so the cadence is at
  most one GET per 20 s of quiet — even when the GET fails.

An origin never reached in this process is never warmed: it has no idle connection
to go wrong, and a first request opens a fresh one anyway.

`src/core/single-flight.ts` was not used for the sharing: it folds a poke into the
running run plus one trailing run, which is a second request where this needs
the one already in flight. A map of warm-ups in flight, keyed by origin, is the
whole of it.

`src/app/settings.ts` holds the one instance, behind both `providerDeps.fetch`
and `keepWarm`: what it knows is which origins a Provider has reached, so a
second instance would keep nothing warm. `synthesisOrigin(settings, provider)`
names each Provider's synthesis origin: `FISH_API`, `OPENAI_URL` and
`SPEECHIFY_API`, the typed `baseURL` for `compatible` and `local`, and null for
`azure`. The global `fetch` is looked up at each call, so the walkthrough
harness's `watchfetch` logs the warm-ups as `fetch GET https://api.fish.audio/`.

`synthesize` in `src/offline/runtime.ts` calls
`keepWarm(synthesisOrigin(current, voice.provider))` whenever it answers with
saved audio while `online`. The read-ahead fetches saved sentences as the reading
moves, a few seconds apart for sentences of ordinary length, so a downloaded
chapter does not leave the connection quiet for the 60 s the measured proxy
allows, and the first POSTs of the next chapter — sent while the last saved
sentences are still playing — find it alive. A single saved sentence playing for
longer than about 40 s could still let it lapse; the next warm-up, or the
POST's own, then goes over a fresh connection.

### The request that warms

`GET <origin>/` with `credentials: 'omit'`, `redirect: 'manual'`, and no headers
and no body of the request it precedes:

- **No credentials.** No key, no Gateway Headers (philosophy rule 3), and no
  cookies. The global `fetch` is `expo/fetch` (`expo` 57.0.24), which defaults
  `credentials` to `'include'` (`src/winter/fetch/fetch.ts`,
  `credentials ?? 'include'`), and `'include'` sets `httpShouldHandleCookies` and
  attaches the shared cookie store's cookies (`ios/Fetch/ExpoURLSessionTask.swift`).
- **No redirect followed.** With `'manual'`, `ios/Fetch/NativeResponse.swift`
  answers the redirect with `completionHandler(nil)` and the 3xx comes back as
  the response, so the warm-up stays on the origin whose connection is at stake.
- **Nothing to cache, nothing spent.** Measured 2026-09-23 16:21: Fish's root
  answers 404 with 29 bytes, OpenAI's 421 with 124 bytes and
  `cache-control: … no-store …`, Speechify's 404 with 121 bytes; none redirects,
  and none carries `Last-Modified`, a future `Expires` or a positive `max-age`,
  so the session's URL cache cannot answer a later warm-up without the network.
  No synthesis, no quota (philosophy rule 4).

The origin is read from the text of the address, `originOf`: scheme, host and a
port that is not the scheme's own, lower-cased, with any user name and password
dropped so they never travel with a warm-up; anything that is not http or https is
null. It does not ask a `URL` for `origin`, because React Native's `URL` is not
the browser's and this layer cannot assume what it answers.

### The numbers

- **30 s** is half the measured 60 s expiry, which leaves the warm-up well clear
  of the edge on both sides.
- **20 s** keeps a reading from saved audio under 30 s, so the next chapter never
  waits for a warm-up at all.
- **15 s** covers the 7.1–7.2 s a dead connection's GET took to be retried and
  answered, twice over, and stays well inside the 60 s a synthesis is given
  (`DEFAULT_SYNTHESIS_TIMEOUT_MS` in `clips.ts`, and the runtime's own).

## What was turned down

- **Retrying a synthesis once after -1005.** The simplest, and the wait is the
  same. But the POST that failed had `bytes written(Y)`: whether it reached the
  Provider cannot be known from here, and a paid Provider could charge for both
  (philosophy rule 4).
- **Keep-warm alone.** It covers the chapter boundary and not a resumed pause or
  the first Play after launch.
- **Turning HTTP/3 off.** Not reachable from JavaScript through this `fetch`, and
  it would slow every connection to protect an idle one.
- **Warming before a GET as well.** CFNetwork already retries a GET on a fresh
  connection; warming it would only double it.

## What it costs, and what it does not establish

- A request that is not a GET, after 30 s or more of quiet, waits one GET: a
  fraction of a second on a live connection, and about seven on a dead one —
  the same seven the failure took, now ending in the synthesis instead of the
  error.
- While saved audio plays online, one GET per 20 s or so to the Provider's
  root, carrying no key and no cookie.
- Whether the owner's phone meets #26 at all is not established: the trigger is
  a network path that expires idle UDP, which the Mac's proxy does and a phone's
  VPN-mode proxy app or a router might.
- A path that drops an idle connection in less than 30 s is not covered; none has
  been measured.
- A failure that never reached the network counts as contact too: a refusal by
  the walkthrough harness's `breakfetch`, or a request refused at once because
  the device had just gone offline. The next request within 30 s then goes out
  without a warm-up, over a connection that may have idled much longer. Met in
  the iOS verification of 2026-09-23: after `unbreakfetch` the retry failed once
  with the real "The network connection was lost", and the next Play, a minute
  later and warmed, went through. Counting only answers would warm again after
  every real failure, where CFNetwork has already replaced the dead connection.

## Tested

`test/core/warm-connections.test.ts`, with a fake `fetch` and clock: one GET to
the root, with none of the request's headers, before a POST after 30 s of quiet,
and the POST waits for it; concurrent POSTs share one; within 30 s, and before a
GET, nothing is warmed; an origin never reached is not warmed; a warm-up that
fails or has not answered in 15 s lets the request go on, and the late one is
aborted; contact is taken when a request settles, not when it is sent, and a
failure counts; `keepWarm` sends at most one GET per 20 s of quiet, joins one in
flight, counts a failed one, and sends nothing for an origin never reached;
`originOf` for strings, `URL`s and `Request`s. Each rule was checked by breaking
it: recording contact at send, warming before a GET, `>` for `>=`, no sharing,
warming an origin never reached, not counting a failed warm-up, and copying the
request's own `init` into the warm-up each fail at least one case.
`test/app/settings.test.ts`: `synthesisOrigin` for all six Providers, and one
instance behind `providerDeps.fetch` and `keepWarm`. `test/offline/runtime.test.ts`:
saved audio asks for its synthesis origin to be kept warm, a sentence sent over
the network does not, and nothing is asked while offline.
