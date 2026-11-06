# Adds a UI test target ATTACHED to the formal OpenReader app target into the
# generated formal-role Xcode project, plus a scheme whose LaunchAction names
# storekit/OpenReader.storekit, so `xcodebuild test` launches the app under the
# activated local StoreKit test environment (WWDC2020/10659 arrangement).
#
#   ruby test/manual-test/purchase/add-storekit-ui-target.rb PATH/TO/ios/OpenReader.xcodeproj
#
# The target bundles StoreKitSessionUI.swift and the .storekit file as
# resources. Idempotent: re-running replaces nothing and exits 0 when present.
require 'xcodeproj'
require 'fileutils'

project_path = ARGV[0]
abort 'usage: add-storekit-ui-target.rb ios/OpenReader.xcodeproj' unless project_path && File.directory?(project_path)
root = File.expand_path('../../..', __dir__)
project = Xcodeproj::Project.open(project_path)
if project.targets.any? { |t| t.name == 'StoreKitSessionUI' }
  puts 'StoreKitSessionUI target already present; refreshing build settings'
  target = project.targets.find { |t| t.name == 'StoreKitSessionUI' }
else
  source = File.join(root, 'test/manual-test/purchase/StoreKitSessionUI.swift')
  config = File.join(root, 'storekit/OpenReader.storekit')
  abort "missing #{source}" unless File.file?(source)
  abort "missing #{config}" unless File.file?(config)
  target = project.new_target(:ui_test_bundle, 'StoreKitSessionUI', :ios, '17.0')
  target.add_file_references([project.main_group.new_file(source)])
  target.add_resources([project.main_group.new_file(config)])
end
# Applied on every run: new targets AND repair of ones created by earlier runs
# (xcodeproj does not set PRODUCT_NAME for ui_test_bundle targets; without it
# the runner produces "-Runner.app/.xctest" and the build collides).
target.build_configurations.each do |bc|
  bc.build_settings.merge!({
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'top.xujialiu.openreader.storekit-ui',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'CODE_SIGNING_ALLOWED' => 'YES',
    'CODE_SIGN_IDENTITY' => '-',
    'CODE_SIGNING_REQUIRED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'IPHONEOS_DEPLOYMENT_TARGET' => '17.0',
    'TEST_TARGET_NAME' => 'OpenReader',
  })
end
project.save

# Scheme with the test target and the StoreKit configuration activated.
# Shared schemes live INSIDE the .xcodeproj package.
schemes_dir = File.join(project_path, 'xcshareddata/xcschemes')
FileUtils.mkdir_p(schemes_dir)
scheme = Xcodeproj::XCScheme.new
app = project.targets.find { |t| t.name == 'OpenReader' }
abort 'OpenReader target not found' unless app
scheme.add_build_target(app)
scheme.add_build_target(target)
scheme.set_launch_target(app)
scheme.add_test_target(target)
begin
  scheme.launch_action.store_kit_configuration = File.expand_path(File.join(root, 'storekit/OpenReader.storekit'))
rescue NoMethodError => e
  puts "xcodeproj lacks store_kit_configuration (#{e.class}); patching scheme XML"
end
scheme.save_as(project_path, 'StoreKitUI')
scheme_file = File.join(schemes_dir, 'StoreKitUI.xcscheme')
text = File.read(scheme_file)
unless text.include?('StoreKitConfigurationFileReference')
  storekit_path = File.expand_path(File.join(root, 'storekit/OpenReader.storekit'))
  text = text.sub('<LaunchAction ',
    "<LaunchAction selectedStoreKitConfigurationFile = \"#{storekit_path}\" ")
  text = text.sub('</LaunchAction>',
    "   <StoreKitConfigurationFileReference identifier = \"#{storekit_path}\"/>\n</LaunchAction>")
  File.write(scheme_file, text)
end
puts "scheme: #{scheme_file}"
puts File.read(scheme_file).lines.grep(/StoreKit/).join
