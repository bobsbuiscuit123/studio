import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iosRoot = path.join(repoRoot, 'ios');
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));

const requiredPaths = [
  path.join(iosRoot, 'Podfile'),
  path.join(iosRoot, 'App.xcodeproj'),
  path.join(iosRoot, 'App.xcodeproj', 'xcshareddata', 'xcschemes', 'App.xcscheme'),
  path.join(iosRoot, 'App', 'Info.plist'),
  path.join(iosRoot, 'CapApp-SPM', 'Package.swift'),
  path.join(iosRoot, 'debug.xcconfig'),
];

const forbiddenPaths = [
  path.join(iosRoot, 'App', 'App.xcodeproj'),
];

for (const requiredPath of requiredPaths) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing required iOS path: ${path.relative(repoRoot, requiredPath)}`);
  }
}

for (const forbiddenPath of forbiddenPaths) {
  if (existsSync(forbiddenPath)) {
    throw new Error(`Unexpected nested iOS project remains: ${path.relative(repoRoot, forbiddenPath)}`);
  }
}

const packageSwiftPath = path.join(iosRoot, 'CapApp-SPM', 'Package.swift');
const packageSwift = readFileSync(packageSwiftPath, 'utf8');
const podfilePath = path.join(iosRoot, 'Podfile');
const podfile = readFileSync(podfilePath, 'utf8');

if (packageSwift.includes('\\')) {
  throw new Error('ios/CapApp-SPM/Package.swift still contains backslashes');
}

if (packageSwift.includes('../../../node_modules/')) {
  throw new Error('ios/CapApp-SPM/Package.swift still uses nested ../../../node_modules paths');
}

if (!packageSwift.includes('../../node_modules/@capacitor/app')) {
  throw new Error('ios/CapApp-SPM/Package.swift is not using the flattened ../../node_modules paths');
}

if (!podfile.includes("project 'App.xcodeproj'")) {
  throw new Error('ios/Podfile is not targeting the root App.xcodeproj');
}

if (!podfile.includes("target 'App' do")) {
  throw new Error("ios/Podfile is not declaring the App target");
}

if (!podfile.includes('post_install do |installer|')) {
  throw new Error('ios/Podfile is missing the post_install bundle-signing workaround');
}

if (!podfile.includes('target_installation_result.resource_bundle_targets.each do |resource_bundle_target|')) {
  throw new Error('ios/Podfile is not disabling signing specifically for CocoaPods resource bundle targets');
}

if (!podfile.includes("config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'")) {
  throw new Error("ios/Podfile is missing CODE_SIGNING_ALLOWED = 'NO' for pod targets");
}

if (!podfile.includes("config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'")) {
  throw new Error("ios/Podfile is missing CODE_SIGNING_REQUIRED = 'NO' for pod targets");
}

const reactNativePackageJsonPath = requireFromRepo.resolve('react-native/package.json');
const reactNativePackageJson = JSON.parse(readFileSync(reactNativePackageJsonPath, 'utf8'));

if (reactNativePackageJson.name !== 'react-native') {
  throw new Error('Resolved react-native package does not report the expected package name');
}

if (reactNativePackageJson.version !== '0.84.1') {
  throw new Error(`Resolved react-native shim version is ${reactNativePackageJson.version}, expected 0.84.1`);
}

console.log('Verified EAS iOS layout, Podfile signing workaround, and react-native shim: root App.xcodeproj, shared App scheme, root Podfile, flat App/, flat CapApp-SPM/, resource bundle signing disabled, react-native 0.84.1');
