# The pod that carries this module's Swift into the generated Xcode project.
#
# Until this file exists, `expo-modules-autolinking search --platform apple`
# lists the module with **no `podspecPath`** and both `expo prebuild` and
# `pod install` succeed anyway — so the absence of the Swift is not reported by
# anything, and `requireNativeModule('OpenReaderNowPlaying')` is what throws at
# runtime. That is measured and written down in this directory's README.
#
# `s.name` is what the generated `ExpoModulesProvider.swift` imports, so it and
# the class's `public` are the two halves of the module being visible to the app
# target at all.
#
# No `package.json` to read a version out of: a local module in `modules/` has
# none, and inventing one would be a second version number to keep in step with
# `app.config.ts` and `package.json` for no reader's benefit.
Pod::Spec.new do |s|
  s.name           = 'OpenReaderNowPlaying'
  s.version        = '1.0.0'
  s.summary        = 'Lock screen, Control Centre and headphone controls (ADR 0016)'
  s.description    = 'Owns MPRemoteCommandCenter and MPNowPlayingInfoCenter. See modules/open-reader-now-playing/README.md.'
  s.license        = 'MIT'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # **Not ADR 0001's 17.2, and the difference is load-bearing.** Expo's
  # autolinking skips a pod whose own minimum exceeds the app's deployment
  # target, and it skips it with `UI.warn "[Expo] … was not linked"` — a warning,
  # in a prebuild that prints hundreds of lines — after which the app builds and
  # runs with no lock screen and nothing anywhere saying why
  # (expo-modules-autolinking/scripts/ios/autolinking_manager.rb, `supports_platform?`
  # and `platform_skip_reason`). Stating 17.2 here would sit exactly on that
  # boundary, so the day anyone lowered `ios.deploymentTarget` this module would
  # disappear silently. 16.4 is Expo SDK 57's own floor and cannot exceed it; the
  # app still builds at 17.2, and every MediaPlayer API used here predates both.
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
