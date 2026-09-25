# Creates a disposable XCTest project; requires the xcodeproj gem used by CocoaPods.
require 'xcodeproj'
output, target_bundle, expect_player, mode, source = ARGV
abort 'usage: project.rb OUTPUT TARGET_BUNDLE YES|NO' unless output && target_bundle && %w[YES NO].include?(expect_player)
project = Xcodeproj::Project.new(File.join(output, 'ManualTests.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'LockScreenProbe', :ios, '16.4')
source ||= 'LockScreenProbe.swift'
abort 'unknown probe source' unless %w[LockScreenProbe.swift ReaderProbe.swift OfflineProbe.swift LibraryOpenProbe.swift SecondVoiceProbe.swift LibraryActionsProbe.swift GeneralFontsProbe.swift OfflineFixProbe.swift FontSizeProbe.swift SyncProbe.swift VoiceListProbe.swift BracketsProbe.swift SettingsVersionProbe.swift AlignmentProbe.swift ScrollThemeReaderProbe.swift DownloadRingProbe.swift AzureProviderProbe.swift DesignShotsProbe.swift NativeReferenceProbe.swift ProviderFreezeProbe.swift PausedTransportProbe.swift BrowseTouchProbe.swift FlingProbe.swift TwoFingerProbe.swift PauseOrderProbe.swift LineColourProbe.swift PauseMenuProbe.swift DownloadConcurrencyProbe.swift PauseSuspendProbe.swift].include?(source)
target.add_file_references([project.main_group.new_file(File.expand_path(source, __dir__))])
plist = File.join(output, 'Probe-Info.plist')
Xcodeproj::Plist.write_to_path({
  'ManualTargetBundleIdentifier' => target_bundle,
  'ManualExpectPlayer' => expect_player,
  'ManualMode' => mode || 'inspect',
}, plist)
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'top.xujialiu.openreader.manualtests',
    'GENERATE_INFOPLIST_FILE' => 'YES', 'INFOPLIST_FILE' => plist,
    'SWIFT_VERSION' => '5.0', 'CODE_SIGNING_ALLOWED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1,2',
  })
end
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'LockScreenProbe')
project.save
