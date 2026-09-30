/**
 * What a shipped package carries inside itself (#111): prebuilt binaries,
 * copied sources and whole libraries embedded as strings. Neither the bundle's
 * source map nor ios/Podfile.lock names any of it, so it is listed here, by
 * reading what each package ships. Each entry was found as its `found` says.
 *
 * `in` is the package that carries it: an entry is written only while that
 * package ships. `linked`, where given, is a file under ios/ and a string it
 * must contain, for what a build setting can switch off.
 *
 * A text comes from one of four places:
 *
 * - `cache`: a file under licenses/, fetched once from `url` (at a pinned tag
 *   where the project has one) and committed, so regenerating needs no network.
 *   `node generate.mjs --fetch` fetches any that are missing.
 * - `npm`: the licence file of that exact npm release, cached under
 *   licenses/npm/ the same way.
 * - `source`: the notice in the shipped file itself, a path under
 *   node_modules: its leading comment, or the lines from `from` to `to`.
 * - `pods`: a file under ios/Pods, for a prebuilt artifact that ships its own.
 * - `spdx`: the standard text of that licence (licenses/spdx/, from SPDX's
 *   licence list) with `holder` as its copyright line, only for a component
 *   that declares a licence and ships no text of it anywhere. Its note says so.
 */

const EMBEDDED_EPUBJS = 'Embedded in @epubjs-react-native/core, in the script its web view runs.';
const EMBEDDED_BY_EPUBJS = `${EMBEDDED_EPUBJS} Resolved from the declared dependencies of epub.js 0.3.93 and JSZip 3.1.5; the embedded build may carry an earlier release.`;

const npm = (name, version, license, extra = {}) => ({
  name, version, license, in: '@epubjs-react-native/core', note: EMBEDDED_BY_EPUBJS,
  found: 'a production install of epubjs@0.3.93 and jszip@3.1.5, 2026-09-30',
  text: [{ npm: `${name}@${version}` }], ...extra,
});

const RNAA = 'react-native-audio-api/common/cpp/audioapi';

export const VENDORED = [
  // React Native's third-party dependencies, prebuilt into ReactNativeDependencies.xcframework
  // (ios/Pods/ReactNativeDependencies/Headers names them). Versions: node_modules/react-native/
  // third-party-podspecs/*.podspec and scripts/cocoapods/helpers.rb. The artifact ships no licence file.
  { name: 'Hermes', version: { podfile: 'hermes-engine' }, license: 'MIT', in: 'react-native', found: 'the hermes-engine pod',
    text: [{ pods: 'hermes-engine/LICENSE' }] },
  { name: 'Boost', version: '1.84.0', license: 'BSL-1.0', in: 'react-native', found: 'ReactNativeDependencies',
    text: [{ cache: 'boost.txt', url: 'https://raw.githubusercontent.com/boostorg/boost/boost-1.84.0/LICENSE_1_0.txt' }] },
  { name: 'double-conversion', version: '1.1.6', license: 'BSD-3-Clause', in: 'react-native', found: 'ReactNativeDependencies',
    text: [{ cache: 'double-conversion.txt', url: 'https://raw.githubusercontent.com/google/double-conversion/v1.1.6/LICENSE' }] },
  { name: 'fast_float', version: '8.0.0', license: 'MIT OR Apache-2.0 OR BSL-1.0', in: 'react-native', found: 'ReactNativeDependencies',
    note: 'Available under any of three licences; this is its MIT licence.',
    text: [{ cache: 'fast_float.txt', url: 'https://raw.githubusercontent.com/fastfloat/fast_float/v8.0.0/LICENSE-MIT' }] },
  { name: '{fmt}', version: '12.1.0', license: 'MIT', in: 'react-native', found: 'ReactNativeDependencies',
    text: [{ cache: 'fmt.txt', url: 'https://raw.githubusercontent.com/fmtlib/fmt/12.1.0/LICENSE' }] },
  { name: 'Folly', version: '2024.11.18.00', license: 'Apache-2.0', in: 'react-native', found: 'ReactNativeDependencies',
    text: [{ cache: 'folly.txt', url: 'https://raw.githubusercontent.com/facebook/folly/v2024.11.18.00/LICENSE' }] },
  { name: 'glog', version: '0.3.5', license: 'BSD-3-Clause', in: 'react-native', found: 'ReactNativeDependencies',
    text: [{ cache: 'glog.txt', url: 'https://raw.githubusercontent.com/google/glog/v0.3.5/COPYING' }] },
  { name: 'SocketRocket', version: '0.7.1', license: 'BSD-3-Clause', in: 'react-native', found: 'ReactNativeDependencies',
    text: [{ cache: 'SocketRocket.txt', url: 'https://raw.githubusercontent.com/facebookincubator/SocketRocket/0.7.1/LICENSE' }] },

  // react-native-audio-api's prebuilt binaries, downloaded by scripts/download-prebuilt-binaries.sh
  // from software-mansion-labs/rn-audio-libs, whose configs.json pins the versions.
  { name: 'FFmpeg', version: '8.0.1', license: 'LGPL-2.1-or-later', in: 'react-native-audio-api',
    found: 'the four frameworks the RNAudioAPI pod vendors; each binary reports "license: LGPL version 2.1 or later"',
    linked: { file: 'Pods/Target Support Files/Pods-OpenReader/Pods-OpenReader-frameworks.sh', contains: 'libavformat.framework' },
    note: 'libavcodec, libavformat, libavutil and libswresample, linked dynamically as separate frameworks, so they can be replaced. '
      + 'Built without GPL or non-free parts by rn-audio-libs, whose README lists its FFmpeg as LGPLv3. '
      + 'Source: ffmpeg.org/releases/ffmpeg-8.0.1.tar.xz; build scripts: github.com/software-mansion-labs/rn-audio-libs.',
    text: [
      { cache: 'ffmpeg-license.txt', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0.1/LICENSE.md' },
      { cache: 'ffmpeg-lgpl-2.1.txt', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0.1/COPYING.LGPLv2.1' },
    ] },
  { name: 'OpenSSL', version: '4.0.0-dev', license: 'Apache-2.0', in: 'react-native-audio-api',
    found: 'FFmpeg is configured with --enable-openssl, and libavformat carries the string "OpenSSL 4.0.0-dev"',
    linked: { file: 'Pods/Target Support Files/Pods-OpenReader/Pods-OpenReader-frameworks.sh', contains: 'libavformat.framework' },
    note: 'Linked into FFmpeg\'s libavformat.',
    text: [{ cache: 'openssl.txt', url: 'https://raw.githubusercontent.com/openssl/openssl/master/LICENSE.txt' }] },
  { name: 'Opus', version: '1.6.1', license: 'BSD-3-Clause', in: 'react-native-audio-api', found: 'libopus.a, force-loaded by the RNAudioAPI pod',
    linked: { file: 'Pods/Target Support Files/Pods-OpenReader/Pods-OpenReader.release.xcconfig', contains: 'libopus.a' },
    text: [{ cache: 'opus.txt', url: 'https://raw.githubusercontent.com/xiph/opus/v1.6.1/COPYING' }] },
  { name: 'Opusfile', version: '0.12', license: 'BSD-3-Clause', in: 'react-native-audio-api', found: 'libopusfile.a, force-loaded by the RNAudioAPI pod',
    linked: { file: 'Pods/Target Support Files/Pods-OpenReader/Pods-OpenReader.release.xcconfig', contains: 'libopusfile.a' },
    text: [{ cache: 'opusfile.txt', url: 'https://raw.githubusercontent.com/xiph/opusfile/v0.12/COPYING' }] },
  { name: 'Ogg', version: '1.3.5', license: 'BSD-3-Clause', in: 'react-native-audio-api', found: 'libogg.a, force-loaded by the RNAudioAPI pod',
    linked: { file: 'Pods/Target Support Files/Pods-OpenReader/Pods-OpenReader.release.xcconfig', contains: 'libogg.a' },
    text: [{ cache: 'ogg.txt', url: 'https://raw.githubusercontent.com/xiph/ogg/v1.3.5/COPYING' }] },
  { name: 'Vorbis', version: '1.3.7', license: 'BSD-3-Clause', in: 'react-native-audio-api', found: 'libvorbis.a, libvorbisenc.a and libvorbisfile.a, force-loaded by the RNAudioAPI pod',
    linked: { file: 'Pods/Target Support Files/Pods-OpenReader/Pods-OpenReader.release.xcconfig', contains: 'libvorbis.a' },
    text: [{ cache: 'vorbis.txt', url: 'https://raw.githubusercontent.com/xiph/vorbis/v1.3.7/COPYING' }] },

  // Sources react-native-audio-api copies into common/cpp/audioapi, compiled by its pod
  // (source_files "common/cpp/audioapi/**/*.{cpp,c,h,hpp}").
  { name: 'miniaudio', version: '0.11.21', license: 'Unlicense OR MIT-0', in: 'react-native-audio-api', found: `${RNAA}/libs/miniaudio`,
    text: [{ source: `${RNAA}/libs/miniaudio/miniaudio.h`, from: 'This software is available as a choice of the following licenses.', to: 'SOFTWARE.', last: true }] },
  { name: 'PFFFT', version: null, license: 'FFTPACK', in: 'react-native-audio-api',
    found: `${RNAA}/libs/pffft, and the double-precision adaptation in ${RNAA}/dsp/r8brain/fft`,
    text: [
      { source: `${RNAA}/libs/pffft/pffft.h`, leading: true },
      { source: `${RNAA}/dsp/r8brain/fft/pffft_double.h`, from: 'NOTE: This file is adapted from Julien Pommier', to: 'Author: Dario Mambro' },
    ] },
  { name: 'r8brain-free-src', version: '7.1', license: 'MIT', in: 'react-native-audio-api', found: `${RNAA}/dsp/r8brain (R8B_VERSION in r8bbase.h)`,
    text: [{ cache: 'r8brain.txt', url: 'https://raw.githubusercontent.com/avaneev/r8brain-free-src/master/LICENSE' }] },
  { name: 'Ooura FFT', version: null, license: 'Ooura', in: 'react-native-audio-api', found: `${RNAA}/dsp/r8brain/fft/fft4g.h`,
    note: 'The shipped file carries this notice and not the package\'s original licence text.',
    text: [{ source: `${RNAA}/dsp/r8brain/fft/fft4g.h`, from: 'Functions from the FFT package by', to: 'wrapped into the "ooura_fft" class.' }] },
  { name: 'WebKit Web Audio', version: null, license: 'BSD-3-Clause AND BSD-2-Clause', in: 'react-native-audio-api',
    found: `the filter, wave and vector-math sources in ${RNAA}/core/effects and ${RNAA}/dsp, which carry Google, Chromium and Apple notices`,
    text: [
      { source: `${RNAA}/core/effects/BiquadFilterNode.h`, leading: true },
      { source: `${RNAA}/core/effects/PeriodicWave.h`, leading: true },
      { source: `${RNAA}/core/effects/IIRFilterNode.h`, leading: true },
      { source: `${RNAA}/dsp/VectorMath.h`, leading: true },
    ] },
  { name: 'base64 (René Nyffenegger)', version: '2.rc.09', license: 'Zlib', in: 'react-native-audio-api', found: `${RNAA}/libs/base64`,
    text: [{ source: `${RNAA}/libs/base64/base64.h`, leading: true }] },
  { name: 'ConcurrentQueue', version: null, license: 'BSD-2-Clause OR BSL-1.0', in: 'react-native-audio-api', found: `${RNAA}/libs/concurrentqueue`,
    text: [{ source: `${RNAA}/libs/concurrentqueue/concurrentqueue.h`, leading: true }] },
  { name: 'LightweightSemaphore', version: null, license: 'Zlib', in: 'react-native-audio-api',
    found: `${RNAA}/libs/concurrentqueue/lightweightsemaphore.h, an extension of Jeff Preshing's semaphore`,
    text: [
      { source: `${RNAA}/libs/concurrentqueue/lightweightsemaphore.h`, leading: true },
      { cache: 'preshing-semaphore.txt', url: 'https://raw.githubusercontent.com/preshing/cpp11-on-multicore/master/LICENSE' },
    ] },

  // expo-sqlite compiles its own copy of SQLite (ios/sqlite3.c) unless SQLCipher or libSQL is chosen.
  { name: 'SQLite', version: { define: ['expo-sqlite/ios/sqlite3.h', 'SQLITE_VERSION'] }, license: 'blessing', in: 'expo-sqlite',
    found: 'expo-sqlite/ios/sqlite3.c, the amalgamation its pod compiles',
    linked: { file: 'Podfile.lock', contains: 'ExpoSQLite' },
    text: [{ source: 'expo-sqlite/ios/sqlite3.h', from: 'The author disclaims copyright to this source code.', to: 'May you share freely, never taking more than you give.' }] },

  // The epub.js build and the JSZip build @epubjs-react-native/core embeds as strings
  // (lib/commonjs/epubjs.js, lib/commonjs/jszip.js). epub.js reports version "0.3"; the build
  // carries core-js 3.18.3 ("version: 3.18.3"); JSZip's banner says v3.1.5.
  npm('epub.js', '0.3.93', 'BSD-2-Clause', { text: [{ npm: 'epubjs@0.3.93' }], note: EMBEDDED_EPUBJS }),
  npm('JSZip', '3.1.5', 'MIT OR GPL-3.0-or-later', { text: [{ npm: 'jszip@3.1.5' }], note: `${EMBEDDED_EPUBJS} Available under either licence; the text carries both.` }),
  npm('core-js', '3.18.3', 'MIT', { text: [{ npm: 'core-js@3.18.3' }], note: `${EMBEDDED_EPUBJS} JSZip's build also carries core-js 2.3.0, under the same licence.` }),
  npm('@xmldom/xmldom', '0.7.13', 'MIT'),
  npm('d', '1.0.2', 'ISC'),
  npm('es5-ext', '0.10.64', 'ISC'),
  npm('es6-iterator', '2.0.3', 'MIT'),
  npm('es6-promise', '3.0.2', 'MIT'),
  npm('es6-symbol', '3.1.4', 'ISC'),
  npm('esniff', '2.0.1', 'ISC'),
  npm('event-emitter', '0.3.5', 'MIT'),
  npm('ext', '1.7.0', 'ISC'),
  npm('immediate', '3.0.6', 'MIT'),
  npm('inherits', '2.0.4', 'ISC'),
  npm('isarray', '1.0.0', 'MIT'),
  npm('core-util-is', '1.0.3', 'MIT'),
  npm('lie', '3.1.1', 'MIT'),
  npm('localForage', '1.10.0', 'Apache-2.0', { text: [{ npm: 'localforage@1.10.0' }] }),
  npm('lodash', '4.18.1', 'MIT'),
  npm('marks-pane', '1.0.9', 'MIT', {
    text: [{ spdx: 'MIT', holder: 'Fred Chasen' }],
    note: `${EMBEDDED_BY_EPUBJS} The package ships no licence text, so this is the standard MIT licence with the author its package.json names.`,
  }),
  npm('next-tick', '1.1.0', 'ISC'),
  npm('pako', '1.0.11', 'MIT AND Zlib'),
  npm('path-webpack', '0.0.3', 'MIT', {
    text: [{ spdx: 'MIT', holder: 'Fred Chasen' }, { spdx: 'MIT', holder: 'Joyent, Inc. and other Node contributors' }],
    note: `${EMBEDDED_BY_EPUBJS} It is Node.js's path module packaged for webpack and ships no licence text, so these are the standard MIT licence for its author and for Node.js's.`,
  }),
  npm('process-nextick-args', '1.0.7', 'MIT'),
  npm('readable-stream', '2.0.6', 'MIT'),
  npm('safe-buffer', '5.1.2', 'MIT'),
  npm('setimmediate', '1.0.5', 'MIT'),
  npm('string_decoder', '0.10.31', 'MIT'),
  npm('type', '2.7.3', 'ISC'),
  npm('util-deprecate', '1.0.2', 'MIT'),
];

/**
 * Shipped packages with no licence file of their own, and the text that stands
 * in for it: the licence file of the project the package belongs to, under the
 * same licence and copyright holder.
 */
export const MISSING_LICENSE_FILES = [
  { match: /^@react-native\//, from: { package: 'react-native' },
    note: 'This package ships no licence file. It is part of React Native, under React Native\'s MIT licence, which follows.' },
  { match: /^@expo\/ui$/, from: { package: 'expo' },
    note: 'This package ships no licence file. It is part of Expo, under Expo\'s MIT licence, which follows.' },
  { match: /^react-native-audio-api$/, from: { cache: 'react-native-audio-api.txt', url: 'https://raw.githubusercontent.com/software-mansion/react-native-audio-api/0.13.5/LICENSE' },
    note: 'The npm package ships no licence file. This is the licence file of its repository at the same release.' },
];
