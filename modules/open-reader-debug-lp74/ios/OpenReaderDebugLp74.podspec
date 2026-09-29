# DEBUG-lp74: temporary diagnostics for issue #74. Remove with the fix.
Pod::Spec.new do |s|
  s.name = 'OpenReaderDebugLp74'
  s.version = '1.0.0'
  s.summary = 'Temporary long-press diagnostics for issue #74'
  s.description = s.summary
  s.license = 'MIT'
  s.author = ''
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.frameworks = 'UIKit', 'WebKit'
end
