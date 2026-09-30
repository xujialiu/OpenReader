---
status: accepted
---

# The acknowledgements are generated from what the build ships

For #111. Settings → Acknowledgements lists every third-party component the app
ships, each with its licence's own text. The owner decided on 2026-09-30 that
the notices live in the app rather than on the website. The product argument is
in `docs/design/0065-the-app-says-what-it-is-made-of.md`.

## The list is data, written by a script

`scripts/acknowledgements/generate.mjs` (`npm run acknowledgements`, after
`npx expo prebuild --platform ios`) writes `src/app/acknowledgements.json`,
which is committed. A component reaches the app three ways, so there are three
sources:

1. **JavaScript.** It builds a production bundle with a source map
   (`npx expo export:embed --platform ios --dev false … --sourcemap-output`),
   without `EXPO_PUBLIC_OPENREADER_DEBUG_MODE`. A module under
   `node_modules/<name>/` belongs to `<name>`. Measured on 2026-09-30: 1,573
   sources, from 77 package directories, some of them second versions nested
   under another package.
2. **Native.** It reads the pods in `ios/Podfile.lock`, each traced through its
   `:path:` or `:podspec:` to the package that holds it. All of them come from
   `node_modules`, `modules/` (ours) or `build/generated` (ours). No pod comes
   from a spec repo, and the script fails if one ever does, since it could not
   name its package. Five packages ship native code only: `expo-font`,
   `expo-keep-awake`, `@expo/dom-webview`, `@expo/log-box` and
   `expo-modules-jsi`.
3. **Vendored.** This is what a package carries inside itself, which neither
   list names. It is written by hand in `scripts/acknowledgements/vendored.mjs`,
   and each entry says how it was found.

Each package's text is its own `LICENSE`, `LICENCE` or `COPYING` file, followed
by any `NOTICE`. Texts that do not ship in `node_modules` are cached under
`scripts/acknowledgements/licenses/`, taken from pinned tags where the project
has them, so a regeneration needs no network. `--fetch` fills a missing file,
and without it a missing file fails the run. The output is deterministic: two
runs wrote the same bytes.

## What the packages carry, measured 2026-09-30

- **React Native's prebuilt dependencies.** `ReactNativeDependencies.xcframework`
  holds boost, double-conversion, fast_float, fmt, folly, glog and SocketRocket
  (its `Headers/` names them). The versions come from
  `react-native/third-party-podspecs/*.podspec` and
  `scripts/cocoapods/helpers.rb`: boost 1.84.0, double-conversion 1.1.6,
  fast_float 8.0.0, fmt 12.1.0, folly 2024.11.18.00, glog 0.3.5, SocketRocket
  0.7.1. The artifact ships no licence file. Hermes's pod ships its own, and its
  version is read from `Podfile.lock`.
- **FFmpeg 8.0.1 in react-native-audio-api.** Four dynamic frameworks
  (`libavcodec`, `libavformat`, `libavutil`, `libswresample`) are downloaded by
  its `download-prebuilt-binaries.sh` from software-mansion-labs/rn-audio-libs,
  and `Pods-OpenReader-frameworks.sh` embeds them.
  - Each binary's own string reads `license: LGPL version 2.1 or later`.
  - The configure line in `libavutil` has `--enable-shared --disable-static
    --enable-openssl` and no `--enable-gpl`, `--enable-nonfree` or
    `--enable-version3`.
  - rn-audio-libs's README calls its FFmpeg LGPLv3. The list records what the
    binaries report, LGPL-2.1-or-later, and its note names the source release
    and the build scripts.
  - Being dynamic, the four frameworks can be replaced, which the library's own
    `libs/ffmpeg/relinking.md` describes.
- **OpenSSL, inside libavformat.** `libavformat` carries the string
  `OpenSSL 4.0.0-dev` and exports no OpenSSL symbols: OpenSSL is linked into it
  statically. Apache-2.0.
- **Xiph libraries.** `libogg.a`, `libopus.a`, `libopusfile.a`, `libvorbis.a`,
  `libvorbisenc.a` and `libvorbisfile.a` are force-loaded by the RNAudioAPI pod
  (`-force_load` in its xcconfig). The binaries say libopus 1.6.1 and
  libVorbis 1.3.7. rn-audio-libs's `configs.json` says ogg 1.3.5 and opusfile
  0.12.
- **Sources copied into react-native-audio-api.** Its pod compiles
  `common/cpp/audioapi/**`, which holds:
  - miniaudio 0.11.21;
  - PFFFT, and r8brain-free-src 7.1's double-precision adaptation of it;
  - Ooura's FFT: `fft4g.h` carries only the notice "Modified and used with
    permission granted by the license", not Ooura's own text;
  - Web Audio filter, wave and vector-math code under Google, Chromium and Apple
    BSD notices;
  - base64 (René Nyffenegger);
  - moodycamel's ConcurrentQueue, and its LightweightSemaphore, which extends
    Jeff Preshing's zlib-licensed semaphore.
  
  Where the licence is in the file itself, the script extracts it from the
  shipped file, and fails when the notice is no longer where it was.
- **SQLite 3.50.3.** expo-sqlite compiles its own amalgamation (`ios/sqlite3.c`),
  because neither SQLCipher nor libSQL is chosen. SQLite is in the public
  domain, and the list carries its blessing.
- **epub.js and JSZip, embedded as strings in @epubjs-react-native/core**
  (`lib/commonjs/epubjs.js` and `jszip.js`, run inside the reader's web view).
  - The epub.js build reports version "0.3". It carries core-js 3.18.3 (its
    `versions` entry), localForage, xmldom, event-emitter, lodash, marks-pane
    and path-webpack; their markers are all in the text.
  - The JSZip build's banner says v3.1.5, with pako.
  - Neither build says more, so the list takes these from a production install
    of epubjs@0.3.93 and jszip@3.1.5 on 2026-09-30, with the licence file of each
    exact release.
- **Packages without a licence file.**
  - `@expo/ui` and four `@react-native/*` packages ship none; each gets its
    project's own licence file (`expo`'s, `react-native`'s), with a note saying
    so.
  - The react-native-audio-api npm package ships none; it gets its repository's,
    at tag 0.13.5.
  - `isarray@1.0.0`'s licence is the License section of its README.
  - `marks-pane` and `path-webpack` ship none anywhere. They get SPDX's standard
    MIT text with the author their package.json names, and for path-webpack also
    Node.js's copyright holders, since the code is Node's path module. Their
    notes say so.

The result on 2026-09-30: 132 components (77 JavaScript package directories, 5
native-only packages, 53 vendored entries), 277 KB of JSON.

## Read when the page opens

Expo's Metro configuration sets `inlineRequires: false`. A JSON module imported
at the top of a screen would therefore be evaluated with the shell at launch,
because `shell.tsx` imports every screen. `src/app/acknowledgements.ts` requires
the file inside a function instead, on first use.

## Guards

`test/app/acknowledgements.test.ts` fails when:
- a dependency in `package.json` is missing from the list;
- a dependency is listed at a version other than the one installed, which is
  how an upgrade without a regeneration shows;
- an entry has no licence or a text under 100 characters;
- names repeat, or the order differs from the one the script writes;
- FFmpeg is linked but not listed under LGPL-2.1-or-later.

Each was watched failing once, against a deliberately broken list.
