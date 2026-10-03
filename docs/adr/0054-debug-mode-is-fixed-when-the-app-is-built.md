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
   `src/debug/credentials.ts` with the name of its Keychain entry
   (`forbidCredential(entry, secret)`, `forbidGatewayHeaders(entry, text)`).
   An entry holds only the latest value written or read for it, and
   `removeSecret` drops it once the Keychain has removed the entry
   (`forgetCredential(entry)`); no value shorter than 8 characters is held
   (below). For Gateway Headers, `forbidGatewayHeaders` holds the whole text,
   each value, and a value's last word, the token of `Bearer <token>`, all as
   the entry's; the minimum is why a flag like `X-Debug: 1` does not blank
   every `1`. The Sync screen's typed password is handed over by `check`
   before it is saved, as the WebDAV password's entry. Every line, to the file
   and to the system log, is written with each held value, and its
   JSON-escaped and URL-encoded spellings, replaced by `[credential]`.
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

### A typed key blanked every `s`: one value per entry, none under 8 characters

The guard first held every value `store.ts` handed it, for the rest of the run.
Measured 2026-09-29 on the simulator (notes 12:19), Debug build
`0.0.2-beta51`: after `OfflineFixProbe.testConfigureFishProvider` typed a Fish
key into Settings, every later Debug Log line had each `s` replaced:

```
[provider] fi[credential]h GET http[credential]://api.fi[credential]h.audio/model -> 200 in 823 m[credential]
```

A Provider's key and Extra headers fields save on every keystroke
(`use-secret-input.ts`'s `change`, through `saveProviderEdit`), and so does the
Sync screen's password. Each save went through `writeSecret` to the guard, so
every prefix of what was typed was held, the one-character `s` among them.
Nothing leaked; the log was unreadable from that edit to the end of the run.

The rule now in force, in `src/debug/credentials.ts`:

- **One value per Keychain entry.** The guard keeps the spellings it holds by
  entry name. A value written or read for an entry replaces what that entry
  held, so a typed prefix stops being held when the next keystroke is saved; a
  Gateway Headers entry's whole text and its parts are replaced together. An
  entry `removeSecret` has removed is held no longer; a removal the Keychain
  refused leaves the secret there, and held. Different entries are held side by
  side.
- **Nothing shorter than 8 characters** (`SHORTEST_HELD`, counted after
  trimming), whether a whole secret, a Gateway Headers text or one of its parts.
  It replaces the 4 that applied to a header's parts alone, for the same reason
  made general: a few characters searched for blank every place they occur, and
  a typed prefix is exactly that until the next keystroke replaces it. A
  Provider's key, the Translator key and a gateway's service token are tens of
  characters, so none of them falls under it. A WebDAV password may be shorter,
  and is then not held: no line the app builds carries it (guard 1), its
  request carries it only as `Basic <Base64>` (the pattern), and an address
  typed with it only as `name:password@` (the pattern again).
- **Unchanged**: without Debug Mode nothing is held, and the three patterns are
  as they were.

test/debug/credential-rule.test.ts's "one value held per Keychain entry" drives
`store.ts` over the Keychain stand-in: a key and Gateway Headers typed one
character at a time leave `fish GET https://api.fish.audio/model -> 200 in 823
ms` untouched and still redact the whole key and the token; a second value
written or read for an entry replaces the first; a forgotten entry is dropped
and another kept; 7 characters are not held and 8 are; five entries' values are
held side by side. Before the change five of its six failed, the first writing
the simulator's line word for word under its own category, `[hx]`; the sixth,
side by side, passed before as after, and is there so that the fix cannot
overshoot.

Not measured: a screen that shows a secret's presence re-reads the entry after
every save (`use-provider-secrets.ts`), unordered with the next keystroke's
save, so a read that resolves late can hold the value one keystroke older until
the entry is next read or written.

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
and `--mode release` the beta alone. Since #127 (ADR 0070), `APP_VERSION` also
carries the Build Number, as in `1.0.0 (5)-beta1-debug`; `shownVersion` did not
change.

There is no control to mark a fault: the owner says roughly when, and the
lines' stamps are searched around that time.

## Not verified here

Nothing in this change ran on a simulator or a phone; ios-tester and the
owner's phone come next. Unmeasured: that the phone persists and collects the
`.notice` lines; that the files land in Library/Application Support;
that `devicectl` copies the folder whole (`debug-log.py` was run only against a
stand-in `xcrun`, whole-folder copy, fallback and `--syslog` alike); that Web
Inspector attaches; the Debug Log's real size per hour.

## 2026-10-01: the reader's page writes to the Debug Log (#113)

#112 was diagnosed through three `js` probes of the still-stuck app. Its Debug
Log showed that the reading had run out of text (`known=468 section=33
rendered=33/253` for 25 minutes, then the out-of-text note). It did not show
why. Nothing from the reader's page reached the log except `problem` messages.
The facts that located the fault were `rendition.manager.q` and
`rendition.q` both `running` with 43 and 49 tasks waiting, section 34's view
created and then removed before it displayed, and the scroll within the
manager's offset. They are now written as they happen, in Debug Mode only.

### Spliced in only in Debug Mode

- **Where it lives.** `src/renderer/renderer-log.ts` holds the page's half as
  source text, `RENDERER_LOG_SOURCE`: one function, `installRendererLog(env)`,
  in the program's own dialect, as `glide.ts` does.
- **How it gets in.** `highlighterSource` takes a fifth argument, `debugMode`.
  `reader-bridge.ts` passes `DEBUG_MODE`, and the download indexer passes
  nothing. When the argument is true, the source goes into the program's
  closure just before `window.__openReaderHighlighter` is defined. Three lines
  join it to the program:
  - `installRendererLog({ rendition, asked, bySection, post })`;
  - `renderAhead = rendererLog.traceRenderAhead(renderAhead)`;
  - a `dispatch` wrapper. It answers the one message only Debug Mode sends,
    `{ kind: 'snapshot', why }`, and it lets the watchdog look again at every
    `speak`.
  Both are function bindings, rebound. Their bodies are untouched, and #112's
  fix may change them.
- **Without it, the program is unchanged.** With the argument false, the
  program text is byte-for-byte that of `4e3544c`. This was compared for
  `highlighterSource()` and for `highlighterSource(…, 'dark', null)` together,
  235,232 characters. So a build without Debug Mode posts none of these
  messages, and has no branch for the snapshot. The Debug Mode program is
  140,713 characters against 117,468 (`'light', null`).
- **The tests.** `test/renderer/renderer-log.test.ts` runs the source in
  `node:vm` against stand-ins written from the bundled epub.js (below). It also
  pins the splice and the bridge's two `DEBUG_MODE` guards.

### Two new messages, two new categories

- **The categories.** The Debug Log now has thirteen categories. The two new
  ones are `renderer` and `probe`.
- **`openreader:renderer` `{ line }`.** The page posts a finished line. The
  bridge writes it with `debugLog('renderer', line)` through `logFromPage`, and
  only when `DEBUG_MODE` is on.
- **`openreader:probe` `{ answer }`.** The harness's `js` command is now
  `probeScript(code)` in `walkthrough-harness.ts`. It posts what the code
  returned (`String(…)`), or `threw <error>`. The bridge writes each answer as
  its own `[probe]` line and prints `HX PROBE <answer>` to the console.
- **Probe answers leave the player's note.** A probe answer used to be a
  `problem` message, so it became the player's note, and the note effect's line
  under `[reading]`. A second answer 4 ms after the first replaced it before it
  was written: at 01:59:13 the log has only `PROBE raf fired after 4ms …`.
  Answers now go through no React state, so two answers that arrive together
  are two lines.
- **Scripts that need changing.** The kit's scripts that read answers out of
  `note="…PROBE …"` need `HX PROBE` or `[probe]` instead.
- **The app asks for displays too.** `goTo`, `goToSection` and `browse` write
  `[renderer] the app asks epub.js to display … (goTo|goToSection|browse)`.
  They reach the page through the library's `goToLocation`, whose injected
  `rendition.display('…')` the page can name only as `injected code`.
- **The status line.** It carries `app=active|inactive|background` from
  `AppState.currentState`, right after `playing=`, so it still starts
  `playing=` and the kit's `HX playing=` matches.

### What the page hooks, read out of the bundled epub.js

These are facts about `@epubjs-react-native/core` 1.4.8's
`lib/commonjs/epubjs.js`, which the patch does not touch.

- **`Queue`** (around line 1942).
  - `enqueue(task, …args)` pushes `{ task, args, deferred, promise }` onto
    `_q` and calls `run()` unless `running` or `paused`.
  - `run()` sets `running = true` and calls `this.tick`, which is
    `requestAnimationFrame`. On that frame it `dequeue()`s the first entry and
    calls `run()` again only when the promise the task returned settles.
  - So a task whose promise never settles leaves `running` true for good.
    #112's queues were in that state.
  - `dequeue()` calls the task bare inside the frame callback. A task that
    throws synchronously therefore never settles either, and neither does the
    queue.
  - Both `enqueue` and `dequeue` are wrapped on each queue instance. The
    wrappers label each entry with the task's name (a bound function's target,
    an arrow function's source, cut), its first argument, and the first named
    caller. They also keep the task in flight.
- **`Views`** (around line 2281).
  - `append`, `prepend` and `clear` are wrapped.
  - `destroy(view)` is wrapped too. It is what removes a view's element, and
    `remove` and `clear` call it through `this`.
- **`IframeView`.**
  - `display()` resolves once `render` has loaded the section into the view's
    iframe.
  - `destroy()` does nothing unless the view is `displayed`. A view removed
    mid-display is therefore detached, and its `display()` never settles. In
    #112 that was section 34.
  - Each view's own `display` and `destroy` are wrapped as it is appended.
- **The continuous manager.**
  - `update()` enqueues `view.destroy.bind(view)` for a view out of reach, and
    `this.trim.bind(this)` 250 ms later.
  - `check()` enqueues an anonymous function bound to the manager that calls
    `update()`.
  - The program's own `holdStill` replaces `trim` and `check` with anonymous
    functions. That is why #112's probe listed forty-one tasks as `bound `.
  - Debug Mode adds pass-through `rlogTrim` and `rlogCheck` on top, only for
    their names. The labels now read `trim@…` and `check@…`, and the
    anonymous update reads `(anonymous)@check`.
  - `resize()` calls `clear()`, which destroys every view, whenever
    `stage.size()` differs from `_stageSize`. It is wrapped to write both sizes.
- **`rendition.display(target)`** queues `_display` on `rendition.q`. It is
  wrapped on the instance, which is what `follow()`, the resize recovery,
  `onResized` and injected code all call.

### The lines

Every line is an event, never a word or a frame (ADR 0005). Examples, as the
tests produce them (the `(anonymous)` callers are the test's own frames; on the
phone they are epub.js's and the program's):

- `installed: views [33 displayed 10559px]; manager queue idle, 0 waiting; rendition queue idle, 0 waiting; scroll top 9801 + client 812 of 10613, manager top 9801 bounds 812 offset 500 (check() would append); asked [], reported [0–33]; location 32–32 at "epubcfi(/6/66!/4/2/1:0)"; page visible`
- `view 34 appended, views [33, 34] (append ← (anonymous) ← dequeue)`, then `view 34 displayed in 640 ms`
- `view 34 removed before its display finished, 1200 ms after it started (remove ← (anonymous) ← (anonymous))`, then `view 34 has not finished displaying 10 s after it started (removed from the page 1.2 s after it started)`
- `view 33 unloaded, out of reach ((anonymous) ← (anonymous) ← (anonymous))`; `views cleared: [33 not displayed 10559px, 34 displaying for 0 s] (display ← (anonymous) ← (anonymous))`
- `stage resized from 402×812 to 402×700, every view cleared: [33 displayed 10559px]`
- `display "epubcfi(/6/68!/4/2[chapter-34]/2/1:0)" asked by follow ← (anonymous) ← (anonymous); rendition queue idle, 0 waiting`; `display "about:srcdoc" (the library's answer to an iframe's about:srcdoc load) asked by onResized ← (anonymous) ← (anonymous); rendition queue running, 1 waiting`; `display finished: section 34`; `display failed: "Error: No Section Found"`
- `renderAhead: section 34 asked for, the voice is in section 33, the last view`, then `renderAhead: section 34 done in 640 ms, views [33, 34]` or `… failed after 5 ms: "Error: …"`
- `renderAhead: the voice is in section 33, nothing asked: section 34 was asked for already and has not reported`. A skip is written once for each section and reason, not once per Utterance. The reason is read from the same guards in the same order. Whether it asked is not inferred: it is whether it queued a task on the manager's queue while it ran, and that task is labelled `renderAhead(N)`.
- `page hidden; manager queue …; rendition queue …` (`visibilitychange`)
- `snapshot, the reading ran out of text: …`. `ranOutOfText` asks for it through `bridge.snapshot`.

A snapshot has these parts:

- each view, with its index and its state: `displayed` (with its height, and `dead document` if its document has lost its window), `displaying for N s` (with `no iframe` if it has none), or `not displayed`;
- each queue, `running` or `idle`, with the task in flight and for how long, or `nothing in flight (waiting for a frame)`, and the waiting tasks grouped (`trim@stuck ×41`), eight kinds at most;
- the container's `scrollTop`, `clientHeight` and `scrollHeight`, against the manager's own `scrollTop`, `_bounds.height` and `settings.offset`, and whether `check()` would append;
- the sections `renderAhead` has asked for and those whose Blocks reported, as ranges;
- `rendition.location` start and end index, and the start CFI cut to 80 characters;
- `document.visibilityState`.

**Callers.** A caller is the first three frames of `new Error().stack` past
the page's own wrappers, which are all named `rlog…`. WebKit writes a frame as
`name@place` and injected code as `global code`, which the line calls
`injected code`. V8's `at name (place)` is parsed too, for the tests.

### The watchdog

- **The timer.** `window.setInterval(…, 1000)` looks at both queues. It never
  uses `requestAnimationFrame`, which is the queues' own `tick`, so the
  watchdog does not stop when they do.
- **Progress.** A queue has made progress when a task has started or settled
  since the last look, or when it is not `running`.
- **Counting.** A look adds the time since the last look, but never more than
  2 s (`LOOK_GAP_MS`). At 10 s counted (`STALL_MS`) it writes one line:
  `manager queue stalled: running, and nothing started or finished for 10 s on
  the clock (10 s counted); <snapshot>`. When the queue moves again it writes
  one more: `manager queue moving again after 51 s on the clock (50 s
  counted); …`. It writes nothing per tick.
- **Why the counting is capped.** In #112's background the WebView ran a
  median 7 ms each time iOS resumed it (notes, 02:20). A 1 s timer hardly
  comes round there. So the `dispatch` wrapper also looks at every `speak`,
  the Clip cue that wakes the WebView. Counted time is a bound on counting,
  not a measure of how long the page ran: a stall in the background is written
  after about five cues with nothing moving.
- **A hidden page waiting for a frame is not counted.** A queue with nothing in
  flight is waiting for a frame, and WebKit draws none for a hidden page.
  Whether `visibilityState` turns `hidden` when the app goes to the background
  was not measured. If it stays `visible`, a background spell with work queued
  writes one stalled line and one moving-again line when the app comes back.

### Limits kept

- The page posts at most 200 lines in any 10 s. Past that it counts, and then
  writes `N renderer lines dropped: more than 200 in 10 s`. That keeps a runaway
  loop far under `BUFFERED_LINES`.
- Each line is cut to 1,990 characters on the page, and the writer still cuts
  at `LINE_CHARS`.
- A target, a CFI or an error is quoted cut to `TEXT_CHARS` with `…`, never
  half a surrogate pair. No document text is quoted.
- Every line passes `withoutCredentials` in `debugLog`.
- Every wrapper calls what it wraps with the same `this` and arguments and
  returns its result, and every line is built inside a `try`.

### Not verified here

Nothing ran on a simulator or a phone. A device run must still show:

- that WebKit's stack names the callers as the tests assume (`follow`,
  `onResized`, `global code`);
- whether `document.visibilityState` is `hidden` in the background;
- that the snapshot a background `ranOutOfText` asks for reaches the log;
- how many lines an hour of listening and a fast fling add.
