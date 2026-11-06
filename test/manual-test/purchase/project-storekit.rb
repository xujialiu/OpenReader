# Creates the disposable XCTest project for StoreKitSessionProbe; same shape as
# kit/project.rb, plus `storekit/OpenReader.storekit` added as a target
# resource so SKTestSession(contentsOf:) can find it in the runner bundle.
# purchase/run-storekit-probe.sh is the usual way in.
require 'xcodeproj'
output, target_bundle, expect_player, mode, source = ARGV
abort 'usage: project-storekit.rb OUTPUT TARGET_BUNDLE YES|NO [MODE] [SOURCE]' unless output && target_bundle && %w[YES NO].include?(expect_player)
project = Xcodeproj::Project.new(File.join(output, 'ManualTests.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'StoreKitSessionProbe', :ios, '17.0')
source ||= 'StoreKitSessionProbe.swift'
root = File.expand_path('../../..', __dir__)
found = if source.include?('/')
  [File.expand_path(source)].select { |path| File.file?(path) }
else
  Dir.glob(File.join(root, 'test', 'manual-test', '**', source)).reject { |path| path.include?('/archive/') }
end
abort "no probe #{source} under #{root}/test/manual-test" if found.empty?
config = File.expand_path('OpenReader.storekit', File.join(root, 'storekit'))
abort "missing #{config}" unless File.file?(config)
target.add_file_references([project.main_group.new_file(found[0])])
target.add_resources([project.main_group.new_file(config)])
plist = File.join(output, 'Probe-Info.plist')
Xcodeproj::Plist.write_to_path({
  'ManualTargetBundleIdentifier' => target_bundle,
  'ManualExpectPlayer' => expect_player,
  'ManualMode' => mode || 'inspect',
}, plist)
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'top.xujialiu.openreader.manualtests.storekit',
    'GENERATE_INFOPLIST_FILE' => 'YES', 'INFOPLIST_FILE' => plist,
    'SWIFT_VERSION' => '5.0', 'CODE_SIGNING_ALLOWED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'IPHONEOS_DEPLOYMENT_TARGET' => '17.0',
  })
end
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(project.path, 'StoreKitSessionProbe')
project.save
