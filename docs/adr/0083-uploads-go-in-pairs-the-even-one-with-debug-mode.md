---
status: accepted
---

# Uploads go in pairs, and the even one has Debug Mode

_Issue #310. The owner's decisions of 2026-10-21 are in its body. The terms are
CONTEXT.md's **Build Number**, **Beta** and **Debug Mode**. This replaces
[ADR 0070](0070-the-version-line-names-the-upload-it-leads-to.md)'s rule that
each upload takes the next number, and keeps the rest of it. The steps are in
`docs/release-to-app-store.md`; the rule an agent follows after an app change is
in `MEMORY/app-change.md`. The App Store Connect readings are in
`notes/NOTES_2026-10-21.md`._

A build with Debug Mode (ADR 0054) reached the owner's iPhone only by cable from
the Mac, and the release guide forbade uploading one. Away from the Mac, the
only update was a TestFlight build without Debug Mode, and installing it
deleted the Debug Log the phone held (ADR 0082) and stopped the log until the
next cable install.

## The rule

- **Every upload is a pair from one commit.** The odd Build Number is the build
  without Debug Mode, for testers and App Review. The even number after it is
  the same code with Debug Mode, for the owner's phone. The first pair is
  1.0.0 (9) and 1.0.0 (10)-debug.
- **`APP_VERSION` holds the odd number.** A build with Debug Mode, uploaded or
  installed by cable, names the even number after it: `buildVersion` in
  `src/debug/mode.ts` raises the bracketed number by one, and `shownVersion`
  adds `-debug`. So `1.0.0 (9)` shows `1.0.0 (10)-debug`, and the next change,
  `1.0.0 (11)-beta1`, shows `1.0.0 (12)-beta1-debug` on the phone and in the
  simulator. The Debug Log's launch line and its `version.txt` use the same
  number.
- **`app.config.ts` refuses an even `n`**, and writes `n + 1` as
  `CFBundleVersion` when the prebuild runs with
  `EXPO_PUBLIC_OPENREADER_DEBUG_MODE=1`, exactly `1`, the same test as
  `DEBUG_MODE`.
- **The first change after a pair raises `n` by two.** A pair re-uploaded with
  nothing changed does the same.
- **One annotated tag per pair**, named by the higher number, `1.0.0(10)`, on
  the commit both builds came from. Its message names both builds.
- **The Debug Mode build goes to the internal group only.** Its TestFlight
  "What to Test" says so. The owner alone adds a build to the external group or
  submits one for review.

## Why the Debug Mode build takes the higher number

The owner's Apple account is a tester in both groups: the internal `owner`
group, which gets every build, and the external `public` group, which gets a
build when the owner adds it. TestFlight offers a tester the newest build of
every group the tester is in. With the Debug Mode build on the odd number, the
build without it would be the newer one as soon as it reached `public`, and
TestFlight would offer to replace the phone's Debug Mode build with it, which
deletes the Debug Log. On the higher number, the Debug Mode build stays the
newest on the owner's phone, and neither group needs changing.

## Why the prebuild decides the native number

Expo writes `CFBundleVersion` into `Info.plist` as a literal when it prebuilds:
`@expo/config-plugins` 57's `ios/Version.js` sets it to `ios.buildNumber`, and
the generated `Info.plist` holds `<string>9</string>`, not a build setting. So
an `xcodebuild` setting cannot give the second archive a different number; the
second archive needs its own prebuild. The guide already starts every archive
from `npx expo prebuild --platform ios --clean`, so the Debug Mode one runs it
with the switch, and its archive is checked for both `DEBUG_MODE = true` in the
bundle and the even number in `Info.plist`. One switch, passed to both
commands, decides both.

A build installed by cable or from Metro is not prebuilt for each change (ADR
0070), so its native number can lag behind what Settings shows; the launch
line's `native` pair shows it, as before.

## Why one commit and one literal

- **The two builds are the same code.** One commit, two archives, with only
  Debug Mode's switch between them, so a fault seen in the Debug Mode build is a
  fault of the build testers and App Review get.
- **`APP_VERSION` stays one literal in git**, the odd number. Every other number
  is derived from it and tested: `test/app-config.test.ts` prebuilds both ways,
  `test/debug/mode.test.ts` holds `buildVersion` and `shownVersion`.
- **One tag names both.** The tag carries the higher number because that is the
  last upload of the pair; its message names the odd one.

## Turned down

- **The Debug Mode build on the odd number** (the owner's first proposal,
  1.0.0 (9)-debug and 1.0.0 (10)). TestFlight would replace it on the owner's
  phone with the newer build without Debug Mode, as above. Keeping it would have
  meant taking the owner's account out of `public` and giving `owner` only odd
  builds, so the owner could no longer install what testers get, or turning off
  TestFlight's updates and choosing a build by hand each time.
- **Two commits per pair**, each with its own literal. No code change, but the
  two builds would not provably be the same code, and one tag would not name
  both.
- **`APP_VERSION` holding the even number**, with the build without Debug Mode
  one lower. It would have left the Debug Mode line exactly `APP_VERSION` plus
  `-debug`, and only the archive without Debug Mode derived. The owner chose the
  odd number.
- **Only one Debug Mode upload, with no rule.** The owner's phone is away from
  the Mac often; without a rule, each such upload would be argued again.

## Not verified here

- Whether `devicectl device copy from --domain-type appDataContainer`, which
  `test/manual-test/kit/debug-log.py` uses, can copy a TestFlight build's
  container. Apple's forum answers suggest container access needs a build signed
  for development, which a TestFlight build is not; if so, the Debug Log of a
  TestFlight install can be read only through the system log (`debug-log.py
  --syslog`), and the walkthrough harness cannot be driven on it.
- How TestFlight chooses the build it offers when two are uploaded minutes apart
  in the order odd, then even. The rule relies on the even one being both the
  higher number and the later upload.
