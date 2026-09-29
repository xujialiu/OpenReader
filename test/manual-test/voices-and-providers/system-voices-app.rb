# Creates a disposable Xcode project for SystemVoicesApp.swift, the phone's
# system-voice probe (recipe in system-voices.md). Requires the xcodeproj gem
# used by CocoaPods.
#
#   ruby test/manual-test/voices-and-providers/system-voices-app.rb OUTPUT_DIR TEAM_ID
#
# TEAM_ID is the Personal Team's (`defaults read com.apple.dt.Xcode
# IDEProvisioningTeamByIdentifier`). The app's bundle id is
# top.xujialiu.openreader.systemvoices and it shows as "System Voices".
require 'xcodeproj'
output, team = ARGV
abort 'usage: system-voices-app.rb OUTPUT_DIR TEAM_ID' unless output && team
source = File.expand_path('SystemVoicesApp.swift', __dir__)
project = Xcodeproj::Project.new(File.join(output, 'SystemVoices.xcodeproj'))
target = project.new_target(:application, 'SystemVoices', :ios, '17.0')
target.add_file_references([project.main_group.new_file(source)])
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'top.xujialiu.openreader.systemvoices',
    'PRODUCT_NAME' => 'SystemVoices',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_KEY_CFBundleDisplayName' => 'System Voices',
    'INFOPLIST_KEY_UIApplicationSceneManifest_Generation' => 'YES',
    'INFOPLIST_KEY_UILaunchScreen_Generation' => 'YES',
    'INFOPLIST_KEY_UISupportedInterfaceOrientations' => 'UIInterfaceOrientationPortrait',
    'MARKETING_VERSION' => '1.0', 'CURRENT_PROJECT_VERSION' => '1',
    'SWIFT_VERSION' => '5.0', 'TARGETED_DEVICE_FAMILY' => '1',
    'CODE_SIGN_STYLE' => 'Automatic', 'DEVELOPMENT_TEAM' => team,
  })
end
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(project.path, 'SystemVoices')
project.save
