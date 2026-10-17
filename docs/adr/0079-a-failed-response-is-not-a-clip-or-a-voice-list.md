---
status: accepted
---

# A failed response is not a Clip or a Voice list

For #203, #211 and #204, a Provider distinguishes transport failure, malformed
complete content and an HTTP refusal. A received response is not yet a received
Clip. A failed Voice listing is not evidence that the server publishes no list.

## The native read must finish

In the installed Expo 57.0.24 iOS implementation, `text()` and `arrayBuffer()`
wait only for `bodyCompleted`. A lost transfer or cancellation instead enters
`errorReceived`, so either reader can remain pending until the application's
outer deadline. `json()` uses `text()` and inherits that behavior.

`patches/expo+57.0.24.patch` makes both buffered readers wait for either terminal
state and reject with the recorded native error before touching the buffer on
failure. This also covers an error already received when the reader is called:
`NativeResponse.waitFor` checks the current state before registering a listener.
The patch does not change the streaming API or install a global fetch wrapper.

The app's `expo.autolinking.ios.buildFromSource` includes `expo`. Without that
setting, a precompiled Expo framework can bypass the patched Swift source.
Autolinking's installed Apple resolver exports this setting, and its CocoaPods
integration matches the npm package name as well as the pod name. Keep the
setting and patch together; when updating Expo, verify both buffered readers
against a cut connection before removing them.

A stream-only workaround was rejected: an error before native streaming starts
has another state path and must not be assumed to emit the streaming error event.
Shortening the 60-second deadline merely reports the wrong failure sooner. The
existing deadline remains necessary for a response that never completes and
never reports an error. No new synthesis retry is added: a lost paid POST may
already have been charged (ADR 0040).

## The Provider reports what failed

`core/providers/response.ts` consumes text or bytes and converts transfer errors
into retriable `network` SynthesisErrors. Cancellation ends the caller's wait
without being retriable, even when a transport ignores abort. Listeners are
removed when consumption settles. JSON parsing happens outside that transport
catch, so complete invalid JSON keeps each Provider's existing format error.
A known HTTP refusal retains its status classification if its optional error
body cannot be read; cancellation is not swallowed by that fallback.

Raw-audio routes use `responseAudio`: an explicitly non-audio Content-Type is
rejected before `readClip`, with a recognized JSON server reason when available.
Absent types and `application/octet-stream` retain the raw-sample fallback;
container signatures still distinguish encoded audio from declared PCM. Fish's
SSE and the captioned/chat JSON envelopes do not pass this raw-route check.
Failures reach neither the in-memory Clip cache nor Offline Narration's writer.

For OpenAI-compatible Voice listings, 404/405 and an unusable complete 200 retain
the documented-name fallback. Other HTTP refusals reject; 429 is a rate limit
and 5xx a service/network failure. The existing loader remembers only fulfilled
lists, so a failed startup prefetch stays silent and the Drawer can ask again.
Its cache and single-flight lifetime do not change.

## Verification boundaries

Provider tests drive delayed body errors, cancellation and valid/invalid content.
Runtime tests keep the real factory, Providers, scheduler and Reading Clip
fetcher: a lost body is reported before the deadline, Downloads use their existing
retry policy, invalid audio is neither cached nor saved, and a stalled transfer
still reaches the deadline. Voice-list tests exercise startup prefetch followed
by server recovery and opening the list. Native source guards are scoped to each
buffered reader and reject deletion of its terminal-state guard; they are not
proof of native execution. A rebuilt iOS app must separately exercise real
URLSession body failures, including consumption started after failure.
