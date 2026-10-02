Pod::Spec.new do |s|
  s.name = 'OpenReaderPalette'
  s.version = '1.0.0'
  s.summary = 'The system colour palette embedded in Highlight'
  s.description = s.summary
  s.license = 'MIT'
  s.author = ''
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '17.2' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
