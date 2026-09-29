---
status: accepted
---

# Debug Mode is fixed when the app is built, and keeps a Debug Log

_The product half is [design 0054](../design/0054-the-owners-phone-keeps-a-record-of-what-the-app-did.md).
Issue #82; the owner's eight decisions are its plan comment. The terms are
CONTEXT.md's **Debug Mode** and **Debug Log**. The measurements are in
`notes/NOTES_2026-09-29.md`, 10:42 to 10:45._

A fault on the owner's phone left no record there. The app's `HX` lines are
React Native's `console.log`, which the phone keeps at INFO, in memory, only
while a stream is attached (notes 2026-09-29 08:25,
`test/manual-test/pitfalls/physical-iphone.md`), and nothing logged a Reading,
a provider request, a download, a sync or a lookup at all. The walkthrough
harness, which can run JavaScript in the reader, was in every build.

## The switch

`src/debug/mode.ts`:

```ts
export const DEBUG_MODE: boolean =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_OPENREADER_DEBUG_MODE === '1';
```

- **Every Metro build has it**, through `__DEV__`. An embedded bundle has it only
  when made with `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`, exactly `1`: `0`,
  `true`, `yes`, ` 1`, the empty string and absence are all off
  (test/debug/mode.test.ts).
- **It is a constant in the bundle.** babel-preset-expo 57.0.12's
  `plugins/inline-env-vars.js` replaces a static `process.env.EXPO_PUBLIC_…`
  read with `t.valueToNode(process.env[key])` when the transform is for
  production; in development it reads `expo/virtual/env` instead. In an
  embedded bundle the line becomes `var DEBUG_MODE = false;` or
  `var DEBUG_MODE = true;`, which is what every measurement below greps for.
- **The Xcode build reaches it** as a build setting on the `xcodebuild` command
  line. Xcode exports build settings to the environment of the "Bundle React
  Native code and images" phase, whose `react-native-xcode.sh` runs
  `@expo/cli export:embed`. The phase is `alwaysOutOfDate = 1` in the generated
  project, so it runs in every build, incremental ones included.
  `docs/install-on-iphone.md`'s command always sets the switch, so a build made
  without thinking about it is a release without Debug Mode.
- **No run-time switch** (decision 1): Settings has no control, and nothing a
  file or the harness can say turns it on.

**Measured 2026-09-29 10:36–10:42** (notes): three unsigned Release builds for
a generic iOS device in a row, without the switch, with
`EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`, and without again. All three returned
0 (203 s for the first, which compiled every Pod; 27 s and 23 s after). The
plain bundle the phase leaves in `Build/Products/Release-iphoneos/` said
`false`, `true`, `false`; the two `false` bundles were byte-for-byte the same,
plain and Hermes alike, and line 60743 was the only line that differed from the
`true` one. The switch in the shell's environment instead of the command line
reached the phase too (10:43:01, `true`).

### The cache trap, and what closes it

Metro caches a file's transformed code under a key made of the file and the
transformer's configuration: `@expo/metro-config` 57.0.12's
`transform-worker/metro-transform-worker.js` `getCacheKey` is its own files,
`stableHash` of the transformer configuration less three paths, and the Babel
transformer's key. The environment is not in it. So the transformed
`mode.ts` of one build, with its value written in, is reused by the next build
whatever that build's environment says, until the cache is reset. The cache is
`os.tmpdir()/metro-cache`, shared by every checkout on the machine.

The Xcode phase passes `--reset-cache`, which hides this in an ordinary build.
But `@expo/cli`'s `exportEmbedAsync.js` drops the reset when `CI` is set ("The
React Native build scripts always enable the cache reset but we shouldn't need
this in CI environments"), and drops it again when `npx expo run` has bundled
eagerly. Measured 2026-09-29 10:43–10:44 with Release builds and `CI=1`: with
`metro.config.js` moved aside, a build with the switch and then one without it
both came out `true`, the second in 477 ms from the cache, its Hermes bundle
identical to the first's. A release made that way would have been in Debug Mode,
harness and all.

So `metro.config.js` extends Expo's configuration with every `EXPO_PUBLIC_`
value, `NAME=value`, sorted, under `transformer.publicEnvironment`. Everything
under `transformer` but the three paths is hashed into the key, so each value
has cached files of its own. With it, the same `CI=1` pair came out `true`,
then `false` (456 ms: the cache was reused for every file but the ones the
value changes). The phase's own bundling command, run alone without
`--reset-cache`, off, on, off, on, gave `false`, `true`, `false`, `true`
(10:44:39). test/app-config.test.ts loads the file as Metro does, with and
without the switch, and checks that Expo's own transformer is still under it.

Not guarded, and said so in `docs/install-on-iphone.md`: the bundling phase
inherits the shell's environment and sources `ios/.xcode.env.local`, and
`export:embed` loads `.env.production.local`, `.env.local`, `.env.production`
and `.env` (`@expo/env`) from the repository root before Metro starts. A switch
left in any of them makes every build one with Debug Mode: a `.env.local`
holding it, and no switch in the shell, gave `true` (10:44:55). Metro's key then
carries that value too, so the cache stays consistent with it.

Turned down: reading the switch natively from an Info.plist key expanded from a
build setting. It cannot go stale through Metro, but it needs a config plugin, a
native constant, and a JavaScript fact that is unknown until the native module
loads; the inlined constant is known to every module as it loads, and is what
the plan named.

## The Debug Log

`src/debug/debug-log.ts` is the writer and the one function every call site
uses, `debugLog(category, message)`. It is platform-free, so the suite can
import the call sites under Node; `eslint.config.js` refuses a platform import
in `src/debug/` outside `install.ts` and `launch.ts`
(test/debug/import-boundary.test.ts). `index.ts` imports `launch.ts` before
`App`, and `installDebugLog` sets a writer only in Debug Mode; until then
`debugLog` does nothing.

- **The line.** `2026-09-29 14:03:12.345 +08:00 [category] message`: local wall
  time to the millisecond with its UTC offset, one of eleven categories
  (`launch app hx warn error document reading provider download sync lookup`),
  line breaks written as ` ⏎ `, and at most 2,000 characters, which keeps a
  stack's first dozen frames. Document text, titles and addresses are quoted
  through `cutText` (80 characters with `…`, never half a surrogate pair) and
  `cutAddress` (scheme, host and path; no `user:password@`, no query, no
  fragment).
- **Batched.** A line waits in memory; the batch is appended as one
  `File.write(text, { append: true })` 2 s after its first line, at once when
  AppState leaves `active`, and at once before a fatal error is handed on.
  expo-file-system 57.0.7's `write` is a synchronous `Function` whose append
  opens a `FileHandle`, seeks to the end, writes and closes
  (`FileSystemFile.swift`, `writeAppending`), so a flush is one short
  synchronous call on the JavaScript thread, never one per line. More than 2,000
  lines between two writes are counted and dropped, and the drop is written.
  A batch that cannot be written is lost, said in the system log, and the next
  one tries again.
- **Rolling.** `debug-log-000001.txt`, `…000002.txt`, …; a batch that would
  take the newest past 5 MB (5,242,880 bytes, counted in UTF-8) starts the next
  file, and the oldest are deleted so that no more than four remain: 20 MB in
  all. At launch it goes on appending to the newest file the folder holds.
  test/debug/debug-log.test.ts writes about 22 MB through a folder in memory
  and checks both bounds after every batch.
- **Where.** `Library/Application Support/debug-log/` in the app's container:
  `new Directory(Paths.document.parentDirectory, 'Library', 'Application
  Support', 'debug-log')`, whose URI expo-file-system writes as
  `…/Library/Application%20Support/debug-log`. It is made at launch and marked
  `isExcludedFromBackup` with the offline module's `excludeFromBackup` (ADR 0027
  made it for the downloaded audio). Under Library, iOS does not purge it, as
  it may purge Caches and tmp, and the Files app does not list it; Documents is
  the owner's data and the harness's file. `test/manual-test/kit/debug-log.py`
  copies it with `xcrun devicectl device copy from --domain-type
  appDataContainer --domain-identifier top.xujialiu.openreader --source
  "Library/Application Support/debug-log"`, and falls back to a listing and a
  copy per file. The launch line names the folder's full URI, so the first pull
  from a phone proves where it is.
- **Off, nothing.** Without Debug Mode `installDebugLog` returns before any
  `Directory` or `File` is constructed; no handler is wrapped, no listener is
  added, no credential is held (test/debug/install.test.ts,
  test/debug/credential-rule.test.ts). `loggedFetch`, `providerDepsFor` and the
  continued task's wrapper hand back what they were given.

Estimated from the lines' real formats, not measured on a phone: a sentence
read aloud writes about 590 bytes (the synthesis start, the request, the
synthesis finish and the harness's status line), so about 0.64 MB an hour at a
sentence every 4 s, and 20 MB holds some thirty hours of listening. An idle
open reader writes the status line every 5 s, about a tenth of that.

## What is logged (decision 3)

- **The launch**: `APP_VERSION`, the native `CFBundleShortVersionString` and
  `CFBundleVersion`, Debug Mode, a Metro or an embedded bundle, whether the
  system log is on, and the folder.
- **AppState**: every change, as `app active|inactive|background`.
- **`HX`**: `hlog` writes each line to the Debug Log as well as to the console,
  including `reading-view.tsx`'s status line every 500 ms when it changes and
  every 5 s when it does not.
- **`console.warn` and `console.error`**, wrapped at launch: each argument as
  text (an Error with its stack, anything else as cycle-safe JSON), then handed
  to the function that was there.
- **Uncaught errors**: `ErrorUtils.setGlobalHandler`, chained to the handler
  React Native installed; a fatal one is flushed first.
- **Unhandled rejections**: in an embedded bundle,
  `HermesInternal.enablePromiseRejectionTracker({ allRejections: true, … })`.
  React Native 0.86.3 enables its own tracker only when `__DEV__`
  (`Libraries/Core/polyfillPromise.js`), and a second one would replace it, so a
  Metro build keeps React Native's, whose reports go to
  `ExceptionsManager.handleException`. Whether that reaches the Debug Log
  through `console.error` was not measured.
- **A Document** (`reading-host.tsx`): opening with its cut title, opened and
  how long it took, would not open and why, and closed.
- **The Reading** (`use-reading.ts`): play with the Utterance, Provider and
  voice; pause; a seek; a skip; every note and voice error the status shows.
- **Provider requests**: the Reading's synthesis (`offline/runtime.ts`) writes
  its start (Provider, voice, length, cut text), its finish (milliseconds, the
  audio's length and rate or bytes and type, the Word Timings' count) or its
  failure (the error's name, `SynthesisError` kind and message). Its `fetch` is
  `loggedFetch` (`src/debug/requests.ts`, through `providerDepsFor` in
  `settings.ts`): who, method, `cutAddress(url)`, status and milliseconds, or
  the failure. Voice lists and connection checks go through the same `fetch`.
  Azure synthesizes over a WebSocket, so it has the start and finish lines and
  no request line.
- **Downloads**: a chapter's preparation (start, done, failed, or waiting for
  the foreground), a sentence that was not synthesized, the continued task's
  submission and answer, what its Live Activity shows when that changes (not at
  every saved clip), its finish, its expiry with the payload ADR 0053 added,
  and the bounded background time's expiry. A download's successful requests
  are not written, since a long one asks for tens of thousands of sentences;
  its failures are.
- **Sync** (`use-sync.ts`): each run's start with `cutAddress` of the server,
  its outcome (trigger, result, error, the file's item count, places taken,
  whether it uploaded) and each connection check.
- **Lookups** (`use-lookup.ts`): mode, service and direction with the cut
  selection, then the answer's source and cut text, or the failure; its `fetch`
  is `loggedFetch` too.

**One exception to the 80 characters**: the harness's answers to a command
(`added`, `shelf` with each title, `file` with a file's contents, `saysettings`,
`watchfetch` with 400 characters of a request body) are written as the harness
prints them, capped at the line's 2,000. They exist only while the kit drives
the harness through `Documents/harness.json`, never in ordinary use, and kit
scripts parse their format. The status line the reader prints on its own cuts
its resume text to 60 characters.

## What is never logged (decision 4)

API keys, Gateway Headers, the WebDAV password and the Microsoft Translator key.
Three guards, each tested in test/debug/credential-rule.test.ts:

1. **The call sites.** Every line is built from named facts; no call passes a
   settings object, a request's headers or a Keychain lookup. The test reads
   every `debugLog(…)` call in `src/` (39 today) and fails on `secret`,
   `password`, `apiKey`, `microsoftKey`, `headers`, `authorization`,
   `keyResult`, `token` or `credential` in its arguments.
2. **Requests.** `loggedFetch` reads a request's address and method and nothing
   else. The test hands it headers, a body and a query full of secrets and a
   `user:password@` address, and reads none of them back; it also reads the
   file for any `.headers`, `.body` or `init?.` other than `init?.method`.
3. **The values.** `src/keys/store.ts` is the one place a secret is read from or
   written to the Keychain (the test counts its four `SecureStore` calls), and
   its `readSecret` and `writeSecret` hand each one to
   `src/debug/credentials.ts`. For Gateway Headers, `forbidGatewayHeaders`
   holds the whole text, each value, and a value's last word, the token of
   `Bearer <token>`; a value shorter than 4 characters is not searched for on
   its own, so a flag like `X-Debug: 1` does not blank every `1`. The Sync
   screen's typed password is handed over by `check` before it is saved. Every
   line, to the file and to the system log, is written with each held value,
   and its JSON-escaped and URL-encoded spellings, replaced by `[credential]`.
   Three patterns catch what no held value can: a `Bearer` or `Basic` token of
   eight characters or more (the WebDAV header is the Base64 of username and
   password, neither of the values held), the value of a header named
   `authorization`, `x-api-key`, `api-key`, `xi-api-key` or
   `ocp-apim-subscription-key`, and an address's `name:password@`. This is what
   covers the lines the app does not build: `HX`, the console and uncaught
   errors. The values are held only in Debug Mode, only in memory.
   `src/keys/` still imports nothing from `src/core/` (ADR 0002), so
   `credentials.ts` spells out `core/headers.ts`'s split rather than import it.

Every Provider in `src/core/providers/` sends its key in a header (Fish,
Speechify, OpenAI and compatible servers `Authorization: Bearer`; Azure
`Ocp-Apim-Subscription-Key` on the WebSocket upgrade), and Gateway Headers
travel as headers, never in an address.
A secret the running app has not read was never in its memory to be logged.

## The system log line (decision 5)

Each line also goes, at once and without its stamp, to
`Logger(subsystem: "top.xujialiu.openreader", category: "debug-log")
.notice("\(line, privacy: .public)")`. `.notice` is the default level, which
the phone persists, where React Native's `console` lines are INFO;
`.public` because a private string argument is collected as `<private>`.
test/app-config.test.ts pins both.

It is a new local module, `modules/open-reader-debug-log` (`OpenReaderDebugLog`:
`systemLog(line)` and the two bundle-version constants), rather than a function
on `OpenReaderOffline`, because that module is the downloads' and the Debug Log
is not, and the version constants belong with the launch line. It is required
optionally: a checkout whose `ios/` has not been through `pod install` since the
module arrived has no such module, and the app then still starts, still writes
the file, and says `system log missing (no native module)` in its launch line.

Measured 2026-09-29 10:36–10:39: the first Release build compiled
`OpenReaderDebugLogModule.swift` with no warning naming it and archived
`libOpenReaderDebugLog.a`; `ExpoModulesProvider.swift` lists
`OpenReaderDebugLogModule.self`, and the app's binary carries its symbols.

## Web Inspector (decision 6)

`@epubjs-react-native/core` 1.4.8's `View` hands its WebView a fixed list of
props, and `webviewDebuggingEnabled` (react-native-webview 13.16.1's name for
WKWebView's `inspectable`, set in `RNCWebViewImpl.m`, iOS 16.4 and later) is
not among them. `patches/@epubjs-react-native+core+1.4.8.patch` adds it to both
builds of `View.js`, default `false`, and to `ReaderProps` in `types.d.ts`.
`Reader` spreads the rest of its props into `View`, so the reader
(`reading-view.tsx`) and the download Indexer (`offline/indexer.tsx`), the only
two places a `Reader` is made, set `webviewDebuggingEnabled={DEBUG_MODE}`.
test/renderer/rules.test.ts pins the installed library and both call sites.

## The harness, the version line, and nothing else (decisions 7, 2 and 8)

`useHarnessCommands` starts its 250 ms poll of `Documents/harness.json` only in
Debug Mode; without it no `File` is ever constructed
(test/app/walkthrough-harness.test.ts). Every harness command, the `js` that
runs code in the reader included, arrives only through that poll.

Settings' version line and its accessibility label are
`shownVersion(APP_VERSION)`: `0.0.2-beta51-debug` in Debug Mode, `0.0.2-beta51`
without, and the rows above it the same either way
(test/app/settings-version.test.ts). `SettingsVersionProbe` expects `-debug`,
and `--mode release` the beta alone.

There is no control to mark a fault: the owner says roughly when, and the
lines' stamps are searched around that time.

## Not verified here

Nothing in this change ran on a simulator or a phone; ios-tester and the
owner's phone come next. Unmeasured: that the phone persists and collects the
`.notice` lines; that the files land in Library/Application Support;
that `devicectl` copies the folder whole (`debug-log.py` was run only against a
stand-in `xcrun`, whole-folder copy, fallback and `--syslog` alike); that Web
Inspector attaches; the Debug Log's real size per hour.
