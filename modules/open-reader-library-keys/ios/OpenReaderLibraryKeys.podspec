Pod::Spec.new do |s|
  s.name = 'OpenReaderLibraryKeys'
  s.version = '1.0.0'
  s.summary = 'Command-F and Escape on a Library or Folder page'
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
