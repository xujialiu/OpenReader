---
status: accepted
---

# UIScene adoption is a config plugin of ours

iOS 27 asserts at launch unless the app adopts the scene-based life cycle. Expo
SDK 57.0.24's prebuild template does not adopt it, so a freshly prebuilt
OwnReader builds, installs, and is killed before it runs. `plugins/with-ui-scene-lifecycle.js`
adopts it: an `UIApplicationSceneManifest` in the Info.plist and a one-line
`SceneDelegate` subclass added to the Xcode target.

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
this is a gap of about twenty lines between a finished component and the app,
not a missing feature — which is most of the reason writing those twenty lines
is preferable to the alternatives.

## Considered options

**Commit `ios/`.** The two-line fix would then simply stay fixed. Rejected: ADR
0001 makes `ios/` generated and untracked precisely because a committed native
directory stops `expo prebuild` from running again, and it stops it silently.
Trading every future native config change for one launch fix is the wrong side
of that bargain, and the `/ios` entry in .gitignore is described there as
load-bearing rather than tidy.

**Wait for Expo.** Rejected on timing rather than on principle. The app does not
launch — not "has a rough edge" — and this is day one, when the only thing being
built is the spike that proves the engine. A fix that arrives in SDK 58 is not a
plan for the week the project starts. It is, however, the expected end of this
plugin: see Consequences.

**Patch the template.** The prebuild template is fetched at prebuild time rather
than resolved from `node_modules`, so `patch-package` has nothing to bite on.
Not a decision so much as a door that is closed.

## Consequences

**This plugin is meant to be deleted.** It fills a gap that Expo will almost
certainly close, and when they do, two writers of `UIApplicationSceneManifest`
is the same failure mode app.config.ts already warns about for
`UIBackgroundModes`. So the plugin watches for its own obsolescence: if it finds
a manifest already in the Info.plist it prints a warning naming itself and this
ADR, and then overwrites anyway. Warning and then winning is deliberate — a
plugin that quietly deferred would hand the app back to whichever half-written
manifest got there first, and the app not launching is not a subtle symptom to
debug twice.

**The failure it prevents is unusually expensive to diagnose.** It produces a
`EXC_BREAKPOINT` crash report and a macOS "quit unexpectedly" dialog, with no
JavaScript stack, no Metro output and no Expo error — the entire signal is one
symbol name, `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, in
frame 0 of a crash log. That is the cost being bought off, and it is worth
naming here because it is invisible from the diff.

**Both halves of the fix are required and only one of them is visible.** A
`SceneDelegate.swift` written to disk but not added to the target's Sources
build phase compiles into nothing, `NSClassFromString` returns nil at launch,
and UIKit reports exactly the same assert as having no manifest at all. The
plugin uses `IOSConfig.XcodeProjectFile.withBuildSourceFile`, which does both;
the hand-done version of this fix needed a third edit, to `project.pbxproj`, and
that is the one a person forgets.

**test/app-config.test.ts asserts the plugin is still listed.** It is one line
in a config, it is not exercised by anything that runs under Node, and removing
it breaks the app completely at a moment — a native build — that is far from
where the line was deleted.
