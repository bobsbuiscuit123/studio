import { writeFileSync } from 'node:fs';

export const podfileTemplate = `source 'https://cdn.cocoapods.org/'
platform :ios, '15.0'

project 'App.xcodeproj'

target 'App' do
  use_modular_headers!
  pod 'FirebaseCore'
  pod 'FirebaseMessaging'
end

post_install do |installer|
  installer.target_installation_results.pod_target_installation_results.each do |_pod_name, target_installation_result|
    target_installation_result.resource_bundle_targets.each do |resource_bundle_target|
      resource_bundle_target.build_configurations.each do |config|
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
      end
    end
  end
end
`;

export function ensureRootPodfile(rootPodfile) {
  writeFileSync(rootPodfile, podfileTemplate);
}
