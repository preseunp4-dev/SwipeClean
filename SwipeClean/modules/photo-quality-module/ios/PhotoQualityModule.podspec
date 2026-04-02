Pod::Spec.new do |s|
  s.name           = 'PhotoQualityModule'
  s.version        = '1.0.0'
  s.summary        = 'Native module for photo quality analysis'
  s.description    = 'Uses Apple Vision framework for blur detection, face analysis, and image quality scoring'
  s.author         = 'SwipeClean'
  s.homepage       = 'https://github.com/swipeclean'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'Vision', 'CoreImage', 'Photos'

  s.source_files = '**/*.swift'
  s.swift_version = '5.4'
end
