# Creates a disposable XCTest project; requires the xcodeproj gem used by CocoaPods.
# SOURCE is a probe's file name (`AlignmentProbe.swift`), found anywhere under
# test/manual-test, or a path to one there. kit/run-probe.sh is the usual way in.
require 'xcodeproj'
output, target_bundle, expect_player, mode, source = ARGV
abort 'usage: project.rb OUTPUT TARGET_BUNDLE YES|NO' unless output && target_bundle && %w[YES NO].include?(expect_player)
project = Xcodeproj::Project.new(File.join(output, 'ManualTests.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'LockScreenProbe', :ios, '16.4')
source ||= 'LockScreenProbe.swift'
root = File.expand_path('..', __dir__)
found = if source.include?('/')
  [File.expand_path(source)].select { |path| File.file?(path) }
else
  Dir.glob(File.join(root, '**', source)).reject { |path| path.include?('/archive/') }
end
abort "no probe #{source} under #{root}" if found.empty?
abort "#{source} names #{found.length} files: #{found.join(', ')}" if found.length > 1
abort "#{found[0]} is not a Swift file under #{root}" unless found[0].start_with?(root + '/') && found[0].end_with?('.swift')
target.add_file_references([project.main_group.new_file(found[0])])
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
