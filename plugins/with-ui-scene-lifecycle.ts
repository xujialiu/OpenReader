import { IOSConfig, withAppDelegate, withInfoPlist, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Adopt the UIScene life cycle on iOS, which iOS 27 requires of every app built
 * against its SDK.
 *
 * Without this the app does not launch at all. UIKit asserts inside
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` and the
 * process is killed with `EXC_BREAKPOINT` before a line of JavaScript runs, so
 * the failure presents as "OpenReader quit unexpectedly" and a crash report —
 * not as an error with a message anyone would search for. The launch log says
 * only `UIScene life cycle is required for apps built with this SDK`.
 *
 * Expo SDK 57.0.24 ships the hard half of this and connects none of it. The
 * Expo pod contains `ExpoAppSceneDelegate`
 * (node_modules/expo/ios/AppDelegates/ExpoAppSceneDelegate.swift), whose own
 * doc comment says it is "Required by the iOS 27, which asserts at launch
 * unless the app adopts the scene-based life cycle" — while the prebuild
 * template still generates a window-based `AppDelegate` and an Info.plist with
 * no `UIApplicationSceneManifest`. Nothing under `expo/` or `@expo/` writes
 * that key; this plugin is the only thing that does.
 *
 * ADR 0018 is why that gap is filled here rather than by waiting for Expo or by
 * committing `ios/`.
 *
 * ## Three edits, and the second one is the one that is easy to miss
 *
 * Adopting the scene life cycle is not one change but three, and getting two of
 * them right fails in a way that looks like progress: the crash moves from
 * UIKit's assert into `ExpoAppSceneDelegate.scene(_:willConnectTo:)`, which is
 * a different stack for the same symptom of "does not launch". The three are
 * the manifest, the app delegate, and the scene delegate, below in that order.
 *
 * ## Every mismatch here fails the build on purpose
 *
 * Each edit asserts that it found exactly what it expected in the generated
 * project and throws otherwise. That is deliberate and it is the whole design:
 * a prebuild prints hundreds of lines, so a warning is not a signal, and the
 * failure being warned about is one whose only symptom is a crash report with a
 * single symbol name in it. A build that stops is the only message that arrives.
 * When Expo fixes this upstream, this plugin will fail the build rather than
 * quietly fight the template — and that failure is the notice to delete it.
 */

/** Fail the prebuild unless `find` occurs exactly once, then replace it. */
function replaceExactlyOnce(contents: string, find: string, replace: string, what: string): string {
  const occurrences = contents.split(find).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      `[with-ui-scene-lifecycle] Expected exactly one ${what} in the generated ` +
        `AppDelegate.swift, but found ${occurrences}.\n\n` +
        `Expo's prebuild template has changed. Either it now adopts the UIScene ` +
        `life cycle itself — in which case delete plugins/with-ui-scene-lifecycle.ts, ` +
        `its line in app.config.ts, and ADR 0018 — or it has been reshaped and this ` +
        `plugin needs updating to match. The build is stopped rather than continued ` +
        `because the symptom of getting this wrong is a launch-time crash with no ` +
        `JavaScript stack and no error message (ADR 0018).\n\n` +
        `Looked for:\n${find}`
    );
  }

  return contents.replace(find, replace);
}

/**
 * Edit 1 of 3 — the Info.plist declares that the app adopts the scene life
 * cycle at all. Without it UIKit never reaches any of the code below.
 *
 * `UISceneDelegateClassName` keeps the `$(PRODUCT_MODULE_NAME)` build variable
 * rather than the expanded `OpenReader.SceneDelegate`, so that renaming the app
 * cannot leave the Info.plist pointing at a class that no longer exists — the
 * generated Info.plist already carries variables of this shape, and Xcode
 * expands it at build time. The app was renamed from OwnReader on 2026-09-19
 * and not a line of this plugin changed, which is the whole of what that buys.
 *
 * `UISceneClassName` is omitted on purpose: UIKit defaults to `UIWindowScene`
 * for the application role, and stating it adds a second thing to keep right.
 */
const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
      },
    ],
  },
};

const withSceneManifest: ConfigPlugin = (config) =>
  withInfoPlist(config, (infoPlistConfig) => {
    if (infoPlistConfig.modResults.UIApplicationSceneManifest) {
      throw new Error(
        '[with-ui-scene-lifecycle] The generated Info.plist already contains a ' +
          'UIApplicationSceneManifest, so something else is writing it now.\n\n' +
          'Two writers of one Info.plist key is the failure app.config.ts already ' +
          'warns about for UIBackgroundModes, and this key decides whether the app ' +
          'launches at all. Find the other writer — most likely Expo, having fixed ' +
          'this upstream — and delete either it or this plugin, ADR 0018 and the ' +
          'line in app.config.ts. Nothing is merged and nothing is overwritten here ' +
          'on purpose: the outcome of guessing wrong is invisible until launch.'
      );
    }

    infoPlistConfig.modResults.UIApplicationSceneManifest = SCENE_MANIFEST;
    return infoPlistConfig;
  });

/**
 * Edit 2 of 3 — the app delegate. This is the edit whose absence looks like
 * success: with the manifest and the scene delegate in place but not this one,
 * the app gets all the way into `ExpoAppSceneDelegate.scene(_:willConnectTo:)`
 * and dies there on a `fatalError`, because that method needs both things below
 * and the template provides neither.
 */

/**
 * `ExpoAppSceneDelegate` looks up its factory with
 * `appDelegate as? ExpoReactNativeFactoryProvider`, and `ExpoAppDelegate` does
 * not conform to that protocol — it is declared `UIResponder,
 * UIApplicationDelegate` and nothing more. The cast returns nil and the guard
 * calls `fatalError`.
 *
 * Only the conformance is added. All three of the protocol's members — `window`,
 * `reactNativeFactory` and `reactNativeFactoryModuleName` — are already
 * satisfied by the template's own properties and the protocol's default, so
 * declaring it is genuinely all that is missing.
 */
const APP_DELEGATE_CLASS = 'class AppDelegate: ExpoAppDelegate {';
const APP_DELEGATE_CLASS_CONFORMING = 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

/**
 * The template starts React Native into a window it builds itself from
 * `UIScreen.main.bounds`. Under the scene life cycle `SceneDelegate` does that
 * from the connecting `UIWindowScene`, so leaving this in place produces two
 * windows and two React roots rather than an error — which is why it is removed
 * rather than left as harmless.
 *
 * `UIScreen.main` is also the API the scene life cycle exists to replace: it
 * answers for "the" screen in a world that no longer has exactly one.
 */
const START_REACT_NATIVE_BLOCK = `#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
`;

const START_REACT_NATIVE_REMOVED = `    // Removed by plugins/with-ui-scene-lifecycle.ts (ADR 0018). Under the
    // UIScene life cycle SceneDelegate creates the window from the connecting
    // UIWindowScene and starts React Native into it; doing it here as well
    // produces a second window and a second React root.
`;

const withFactoryProvidingAppDelegate: ConfigPlugin = (config) =>
  withAppDelegate(config, (appDelegateConfig) => {
    if (appDelegateConfig.modResults.language !== 'swift') {
      throw new Error(
        `[with-ui-scene-lifecycle] Expected a Swift AppDelegate, found ` +
          `"${appDelegateConfig.modResults.language}". This plugin edits Swift source ` +
          `and has nothing to say about an Objective-C app delegate.`
      );
    }

    let contents = appDelegateConfig.modResults.contents;

    contents = replaceExactlyOnce(
      contents,
      APP_DELEGATE_CLASS,
      APP_DELEGATE_CLASS_CONFORMING,
      'AppDelegate class declaration'
    );

    contents = replaceExactlyOnce(
      contents,
      START_REACT_NATIVE_BLOCK,
      START_REACT_NATIVE_REMOVED,
      'startReactNative block'
    );

    appDelegateConfig.modResults.contents = contents;
    return appDelegateConfig;
  });

/**
 * Edit 3 of 3 — the scene delegate the manifest names.
 *
 * `ExpoAppSceneDelegate` already does the entire job: it builds the `UIWindow`
 * from the connecting `UIWindowScene`, starts React Native into it, rebuilds the
 * launch options that `Linking.getInitialURL()` reads from the scene's
 * connection options, and re-feeds URL, user-activity and quick-action events
 * back to the app delegate. There is nothing to add and nothing to override.
 *
 * The subclass exists only because `UISceneDelegateClassName` has to name a
 * class in this app's own module: Expo's is `EXExpoAppSceneDelegate`, namespaced
 * to the Expo pod, and naming it there would couple the Info.plist to Expo's
 * Objective-C symbol rather than to anything this project controls.
 *
 * `internal import` matches the generated `AppDelegate.swift` beside it, which
 * is the Swift 6 form the template already compiles under.
 */
const SCENE_DELEGATE_SWIFT = `internal import Expo

/// Generated by plugins/with-ui-scene-lifecycle.ts (ADR 0018). Editing this
/// file in ios/ does nothing: ios/ is regenerated and never committed.
///
/// Everything is inherited. See ExpoAppSceneDelegate in the Expo pod.
class SceneDelegate: ExpoAppSceneDelegate {}
`;

/**
 * Writes `ios/OpenReader/SceneDelegate.swift` and adds it to the target's Sources
 * build phase. Both halves are needed and only one is visible: a file on disk
 * that is not in the Xcode project compiles into nothing, and
 * `NSClassFromString("OpenReader.SceneDelegate")` then returns nil at launch —
 * which UIKit reports as the same missing-scene-adoption assert as having no
 * manifest at all. `withBuildSourceFile` does both, which is the reason to use
 * it over writing the file directly; the hand-done version of this fix needed a
 * third edit, to `project.pbxproj`, and that is the one a person forgets.
 *
 * `overwrite` is on so that this plugin owns the file outright. A stale
 * SceneDelegate left by an earlier version of this plugin is a worse outcome
 * than losing a hand edit that ADR 0001 says cannot last.
 */
const withSceneDelegate: ConfigPlugin = (config) =>
  IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: 'SceneDelegate.swift',
    contents: SCENE_DELEGATE_SWIFT,
    overwrite: true,
  });

const withUISceneLifecycle: ConfigPlugin = (config) =>
  withSceneDelegate(withFactoryProvidingAppDelegate(withSceneManifest(config)));

export default withUISceneLifecycle;
