---
status: accepted
---

# The version line names the upload it leads to

_Issue #127. The owner's decisions are in its body; the terms are CONTEXT.md's
**Version**, **Build Number** and **Beta**. The rule an agent follows is in
`MEMORY/app-change.md`, and the upload steps are in `docs/release-to-app-store.md`._

`APP_VERSION` in `app-version.ts` is one string, `x.y.z (n)-betaN`, and
Settings shows it, with `-debug` added in Debug Mode (`shownVersion`, ADR 0054).
For example, `1.0.0 (5)-beta1-debug`. `app.config.ts` reads both native numbers
from it: `version` (`CFBundleShortVersionString`) is `x.y.z`, and
`ios.buildNumber` (`CFBundleVersion`) is `n`.

## Why

Before #127 the line was `x.y.z-betaN`, and an upload's line was `x.y.z`.
Builds 2, 3 and 4 all went up as 1.0.0, and each one said `1.0.0` on the phone.
App Store Connect calls them 1.0.0 (2), (3) and (4). Nothing on the device told
them apart.

The rule was "the next patch plus `-beta1` after a release". It did not say what
counted as a release. After build 3 was submitted, 1e734ab (#126) moved
`APP_VERSION` to `1.0.1-beta1`. The owner kept 1.0.0 for the replacement, and
98809b5 moved it back to `1.0.0`. Now the owner alone moves `x.y.z`, and
uploads move `n`.

## The rule (the owner's, 2026-10-03)

- **No `v`, and a space before the bracket**, as Apple writes `1.0.0 (4)`.
- **A beta carries the number of the upload it leads to.** After build 4, the next
  change is `1.0.0 (5)-beta1`, and the upload that follows is `1.0.0 (5)`. So a
  beta always sorts before its upload, as `-beta` versions do everywhere else.
- **The Beta counts changes since the last upload**, from 1 again after each
  upload.
- **Every upload drops the Beta**, TestFlight-only ones included. The Build
  Number already tells uploads apart.
- **Build numbers rise across all versions and are never reused.** A re-upload
  with nothing changed takes the next number with no Beta.
- **`x.y.z` is the owner's.** When the version is already live on the App Store
  (ITMS-90186 refuses further uploads to it), the agent asks for the next one
  before uploading.

## Why one string, in JavaScript

- **The native number goes stale.** `CFBundleVersion` reaches the installed app
  only through a prebuild. Neither a Metro reload nor the iPhone build runs one
  (#30's evidence; the comment on `version` in `app.config.ts`). Read from
  native at run time, the simulator would keep showing the number of its last
  prebuild. The Debug Log's launch line still writes the native pair beside
  `APP_VERSION` (`OpenReader 1.0.0 (5)-beta1, native 1.0.0 (4), …`), so a stale
  native build can still be seen there.
- **One edit per change.** An app change or an upload edits one line, and the
  tests hold everything else to it. Three constants for Version, Build Number
  and Beta would be three edits that could disagree.
- **The probes read it unchanged.** `SettingsVersionProbe.swift` and
  `PauseSuspendProbe.swift` read the line `export const APP_VERSION = '…'`
  between its quotes, and expect `Version <that>-debug`.
- **It is still a literal in git**, so git records which build went up, which
  is what `buildNumber: '4'` was a literal for.

`app.config.ts` throws when `APP_VERSION` is neither `x.y.z (n)` nor
`x.y.z (n)-betaN`, so a prebuild fails rather than writing a guess. Measured
2026-10-03: `npx expo config --type public --json` gave `version` `1.0.0` and
`ios.buildNumber` `5` for `1.0.0 (5)-beta1`. For `1.0.0-beta1` it stopped with
`APP_VERSION '1.0.0-beta1' is neither 'x.y.z (n)' nor 'x.y.z (n)-betaN'
(#127)`. test/app-config.test.ts checks the form, that `version` equals its
`x.y.z` and `package.json`, and that `buildNumber` equals its `n`.

## Turned down

- **A `v` prefix** (`v1.0.0(5)-beta1-debug`, the owner's first proposal). iOS
  apps do not use one, and VoiceOver would say "Version v…".
- **A beta carrying the last upload's number** (`1.0.0 (4)-beta1` after build
  4). It reads as a beta of build 4 although it comes after build 4, and the
  number it shows is never the number it uploads as.
- **One Beta count across uploads** (`1.0.0 (5)-beta13`). The Build Number already
  separates uploads, and a small count is easier to read off a phone.
- **Agents moving `x.y.z` after an upload or a submission.** This is what went
  wrong in 1e734ab.
- **Keeping the Beta on a TestFlight-only upload.** Two uploads are already
  told apart by their numbers.
