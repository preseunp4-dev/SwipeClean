Pod::Spec.new do |s|
  s.name           = 'FileSizeModule'
  s.version        = '1.0.0'
  s.summary        = 'Native module for fast batch file size fetching'
  s.description    = 'Uses PHAssetResource to get file sizes from metadata without loading images'
  s.author         = 'SwipeClean'
  s.homepage       = 'https://github.com/swipeclean'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
  s.swift_version = '5.4'
end
