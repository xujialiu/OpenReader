# src/core

The half of OpenReader that runs under Node.

Nothing here imports React, React Native or Expo. `eslint.config.js` enforces
that with a `no-restricted-imports` override over `src/core/**`, and
`test/core/providers/import-boundary.test.ts` fails if the override ever stops
firing.

## Why the rule is worth having

Two reasons, and neither is tidiness.

The first is ADR 0013. About 3,200 lines of provider tests come across from the
Zotero-TTS plugin, driven entirely by fake `fetch` implementations and injected
dependencies. They run under `vitest` with `environment: 'node'` because the
code they test has no platform underneath it. The moment something here imports
`react-native`, that suite needs a simulator and stops being run.

The second is that the ADR wants extracting this into a shared package later to
be "a move, not an archaeological dig". The discipline costs nothing today and
is unrecoverable once broken in fifty places.

## How the platform gets in

Injected, the way the provider layer already does it:
`createProvider(id, settings, deps)` takes `{ fetch, getWebSocket, newRequestId, ... }`.

So a function here that needs a file's bytes takes the bytes, not a path — the
caller in `src/` reads them with `expo-file-system`. A function that needs the
wall clock takes a clock. This is the same discipline that let
`core/webdav.ts` parse PROPFIND responses with regular expressions instead of a
DOM (ADR 0003), which is why that file ports to React Native unchanged.

## What lives here

- [`providers/`](providers/) — ADR 0013
- [`segmenter/`](segmenter/) — ADR 0006
- [`sync/`](sync/) — ADR 0003
- [`document/`](document/) — ADR 0004, 0007, 0008

Files that several of them share sit directly in `core/`. In the plugin those
are `align.ts`, `wav.ts`, `timeout.ts`, `single-flight.ts`, `memory-cache.ts`
and `speech-text.ts`, and they keep those names and this location when they
come across, so the plugin's `test/core/*.test.ts` land unchanged too.
