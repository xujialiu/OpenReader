Pod::Spec.new do |s|
  s.name = 'OpenReaderDebugLog'
  s.version = '1.0.0'
  s.summary = 'The Debug Log line in the system log, and the build it was written by'
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
end
