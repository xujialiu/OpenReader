---
status: accepted
---

# UIScene adoption is a config plugin of ours

iOS 27 asserts at launch unless the app adopts the scene-based life cycle. Expo
SDK 57.0.24's prebuild template does not adopt it, so a freshly prebuilt
OwnReader builds, installs, and is killed before it runs.
`plugins/with-ui-scene-lifecycle.ts` adopts it, in three edits to the generated
project.

## What is actually missing upstream

Expo has already written the difficult part. The Expo pod ships
`ExpoAppSceneDelegate`, which builds the `UIWindow` from the connecting
`UIWindowScene`, starts React Native into it, rebuilds the launch options that
`Linking.getInitialURL()` reads out of the scene's connection options, and
forwards URL, user-activity and quick-action events back to the app delegate.
Its own doc comment says it is "Required by the iOS 27, which asserts at launch
unless the app adopts the scene-based life cycle."

Nothing wires it up. The template still generates a window-based `AppDelegate`,
and no file under `expo/` or `@expo/` writes `UIApplicationSceneManifest`. So
this is a gap between a finished component and the app, not a missing feature —
which is most of the reason filling it is preferable to the alternatives.

## Considered options

**Commit `ios/`.** The fix would then simply stay fixed. Rejected: ADR 0001
makes `ios/` generated and untracked precisely because a committed native
directory stops `expo prebuild` from running again, and it stops it silently.
Trading every future native config change for one launch fix is the wrong side
of that bargain, and the `/ios` entry in .gitignore is described there as
load-bearing rather than tidy.

**Wait for Expo.** Rejected on timing rather than on principle. The app does not
launch — not "has a rough edge" — and this is day one, when the only thing being
built is the spike that proves the engine. `expo@57.0.24` is the newest release
on the `sdk-57` tag, so there is no patch to wait for, and SDK 58 is still in
preview. It is, however, the expected end of this plugin: see Consequences.

**Patch the template.** The prebuild template is fetched at prebuild time rather
than resolved from `node_modules`, so `patch-package` has nothing to bite on.
Not a decision so much as a door that is closed.

## Three edits, and the middle one is the one that looks optional

The manifest is the edit everyone finds, because it is the one the error message
is about. It is not sufficient, and the way it fails next is the reason this
section exists.

1. **`UIApplicationSceneManifest` in the Info.plist**, naming
   `$(PRODUCT_MODULE_NAME).SceneDelegate`. Without it UIKit kills the process in
   `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before any
   scene code runs.
2. **Two changes to the generated `AppDelegate.swift`**: declare conformance to
   `ExpoReactNativeFactoryProvider`, and delete the block that builds a
   `UIWindow` from `UIScreen.main.bounds` and calls `startReactNative` into it.
3. **A `SceneDelegate.swift`** — one line, `class SceneDelegate:
   ExpoAppSceneDelegate {}` — written and added to the target's Sources build
   phase.

Edit 2 is the one that reads like tidying and is not. `ExpoAppSceneDelegate`
finds its factory with `appDelegate as? ExpoReactNativeFactoryProvider`, and
`ExpoAppDelegate` does not conform to that protocol — it is declared
`UIResponder, UIApplicationDelegate` and nothing more. With edits 1 and 3 only,
the app gets all the way into `scene(_:willConnectTo:)` and dies on Expo's own
`fatalError` there. **The crash moves and the symptom does not**: the stack
changes from a UIKit assert to a Swift assertion failure, while the app still
simply fails to launch. Deleting the `startReactNative` block is required for a
different reason — under the scene life cycle `SceneDelegate` creates the window,
so leaving the template's copy in place yields two windows and two React roots
rather than an error.

## Consequences

**This plugin is meant to be deleted**, and it is built to announce that day
rather than to be remembered. Each of the three edits asserts that the generated
project still looks the way it expects — no existing scene manifest, exactly one
match for each of the two `AppDelegate` replacements — and **throws, failing the
prebuild**, when it does not.

Failing rather than warning is the whole design. A prebuild prints hundreds of
lines, so a warning is not a signal; and the defect being guarded against has no
other signal at all. There is no JavaScript stack, no Metro output and no Expo
error — the entire evidence is one symbol name in frame 0 of a crash report, and
a macOS "quit unexpectedly" dialog. Against a failure that invisible, a build
that stops is the only message that arrives. The cost is a broken build on the
day Expo fixes this upstream, and on that day the correct action is to delete
this plugin, its line in app.config.ts and this ADR — which is what the error
text says.

**Both halves of edit 3 are required and only one of them is visible.** A
`SceneDelegate.swift` written to disk but not added to the target's Sources build
phase compiles into nothing, `NSClassFromString` returns nil at launch, and UIKit
reports exactly the same assert as having no manifest at all. The plugin uses
`IOSConfig.XcodeProjectFile.withBuildSourceFile`, which does both; the hand-done
version of this fix needed a separate edit to `project.pbxproj`, and that is the
one a person forgets.

**The plugin is TypeScript, which costs one line elsewhere.** Expo loads a
path-resolved plugin through plain `require`, so `app.config.ts` opens with
`import 'tsx/cjs'` and `tsx` is a devDependency. The alternative was a `.js`
plugin outside `npm run typecheck` — cheaper, but this file's failure mode is a
launch-time crash with no message, which is the last place to give up a compiler.

**test/app-config.test.ts asserts the plugin is still listed.** It is one line
in a config, it is not exercised by anything that runs under Node, and removing
it breaks the app completely at a moment — a native build — far from where the
line was deleted.

## Verified

`npx expo prebuild --clean` followed by `npx expo run:ios`, 2026-09-19: all three
edits land in the generated project, the app launches on the iOS 27.0 simulator,
and JavaScript runs — the engine spike reported `Hermes 250829098.0.17` from a
project generated entirely by this plugin. See `notes/NOTES_2026-09-19.md`.
