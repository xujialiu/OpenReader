# Runtime warnings, expressions and the reading handler

## Read runtime warnings or evaluate a targeted expression

Prerequisites: the current repository's Metro server and one connected OpenReader
Debug target. The script uses Metro's installed `ws` dependency.

```sh
node test/manual-test/cdp.cjs --warnings
node test/manual-test/cdp.cjs --eval /tmp/targeted-expression.js
```

Set `OPENREADER_DEVICE` (e.g. `OPENREADER_DEVICE="iPhone 16"`) when two
simulators share one Metro — two worktree sessions on the same repository,
each with their own device — so the "expected one OpenReader debug target"
check narrows to the named `deviceName` instead of failing on two. Unset,
behaviour is exactly as before. `offline-playback.cjs` picks this up for free
by inheriting the environment into its own `cdp.cjs` calls; it separately
reads `OPENREADER_DOCUMENT_ID` to target a Document other than the short
fixture's historical id, for a Library seeded with a differently-built copy
of it (same title and chapters, different manifest digest). `OPENREADER_DEVICE`
is the Metro target's name; the silence check is a different question about the
same device and takes its UDID.

Warning capture includes buffered warnings and errors, without verbose stack
traces or ordinary playback logs. No output means no warnings were received in
that capture, not that all interactions have been tested. Restart the app against
a stable Metro before comparing runs: an old `Disconnected from Metro (1001)`
warning remains in the buffer. Keep Metro running for Debug delivery.

Evaluation prints the expression result and fails on a protocol/JavaScript error.
Use synchronous expressions: Hermes can return a Promise object before its work
finishes. Invoking a React handler through this tool is not a physical touch test.
Inspect only task-related state and avoid expressions that return credentials.
The optional final argument selects a different Metro URL.

### Capturing an async event (a WebSocket's `error`/`close`) across two `--eval` calls

Each `--eval` opens its own CDP connection and evaluates one synchronous
expression, so an event that arrives later — a refused WebSocket upgrade's
`close`, for instance — is not in that call's result. Split it into two calls
against the same running app, since Hermes's globals persist between separate
CDP connections: the first arms a listener that pushes each event into a
`globalThis` array and returns at once; after a pause for the network round
trip, the second reads the array back.

```sh
node test/manual-test/cdp.cjs --eval arm.js http://127.0.0.1:PORT   # registers ws.onerror/onclose, returns 'armed'
sleep 3
node test/manual-test/cdp.cjs --eval read.js http://127.0.0.1:PORT  # JSON.stringify(globalThis.__probe.events)
```

Used this way on 2026-09-22 against `wss://eastasia.tts.speech.microsoft.com/…`
with a wrong key, `new WebSocket(url, undefined, { headers: {…} })` produced
exactly the sequence ADR 0037 inferred from source but had not measured on a
device: a bare `error` event, then `close` with `code: 1006` and
`reason: "Received bad response code from server: 401."`. Restart the app
afterwards (or let the next `app.launch()` in a probe do it) to discard the
armed global.

## Inspect, stop or briefly exercise the reading handler

```sh
node test/manual-test/reading.cjs state
node test/manual-test/reading.cjs pause
node test/manual-test/reading.cjs play-for 5 SIMULATOR_UDID
```

Open a Document first. `play-for` requires an explicitly chosen duration up to
10 seconds and a simulator whose own volume is zero; it names the device so it
can check that, and takes `SIMULATOR_UDID` from the environment instead when the
argument is left out. Five seconds
was used here to establish an active Now Playing session before a paused-card
inspection. The script pauses via both a host cleanup path and an app watchdog.
If either reports an unconfirmed pause, stop in the app and verify its state.
The duration includes synthesis/buffering and does not guarantee that audio
actually started. These handler calls are not touch tests; use the `tap` mode
above for that. Run `state` afterwards to verify the final paused state.
