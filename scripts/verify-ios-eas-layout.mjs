import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iosRoot = path.join(repoRoot, 'ios');
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));

const rootPodfile = path.join(iosRoot, 'Podfile');
const rootXcodeproj = path.join(iosRoot, 'App.xcodeproj');
const rootScheme = path.join(rootXcodeproj, 'xcshareddata', 'xcschemes', 'App.xcscheme');
const rootPbxprojPath = path.join(rootXcodeproj, 'project.pbxproj');
const nestedWrapper = path.join(iosRoot, 'App');
const nestedAppDir = path.join(nestedWrapper, 'App');
const nestedInfoPlist = path.join(nestedAppDir, 'Info.plist');
const nestedDebugEntitlements = path.join(nestedAppDir, 'App.entitlements');
const nestedReleaseEntitlements = path.join(nestedAppDir, 'AppRelease.entitlements');
const nestedXcodeproj = path.join(nestedWrapper, 'App.xcodeproj');
const nestedCapAppSpm = path.join(nestedWrapper, 'CapApp-SPM');
const nestedPackageSwiftPath = path.join(nestedCapAppSpm, 'Package.swift');
const rootDebugXcconfig = path.join(iosRoot, 'debug.xcconfig');

const requiredPaths = [
  rootPodfile,
  rootXcodeproj,
  rootScheme,
  rootPbxprojPath,
  nestedWrapper,
  nestedAppDir,
  nestedInfoPlist,
  nestedDebugEntitlements,
  nestedReleaseEntitlements,
  nestedXcodeproj,
  nestedCapAppSpm,
  nestedPackageSwiftPath,
  rootDebugXcconfig,
];

const forbiddenPaths = [
  path.join(iosRoot, '__tmp_App'),
  path.join(iosRoot, '__tmp_App.xcodeproj'),
  path.join(iosRoot, '__tmp_CapApp-SPM'),
];

for (const requiredPath of requiredPaths) {
  if (!existsSync(requiredPath)) {
    throw new Error(`Missing required iOS path: ${path.relative(repoRoot, requiredPath)}`);
  }
}

for (const forbiddenPath of forbiddenPaths) {
  if (existsSync(forbiddenPath)) {
    throw new Error(`Unexpected temporary iOS path remains: ${path.relative(repoRoot, forbiddenPath)}`);
  }
}

const packageSwift = readFileSync(nestedPackageSwiftPath, 'utf8');
const podfile = readFileSync(rootPodfile, 'utf8');
const rootPbxproj = readFileSync(rootPbxprojPath, 'utf8');

if (packageSwift.includes('\\')) {
  throw new Error('ios/App/CapApp-SPM/Package.swift still contains backslashes');
}

if (!packageSwift.includes('../../../node_modules/@capacitor/app')) {
  throw new Error(
    'ios/App/CapApp-SPM/Package.swift is not using the nested ../../../node_modules paths'
  );
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

if (
  !podfile.includes(
    'target_installation_result.resource_bundle_targets.each do |resource_bundle_target|'
  )
) {
  throw new Error(
    'ios/Podfile is not disabling signing specifically for CocoaPods resource bundle targets'
  );
}

if (!podfile.includes("config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'")) {
  throw new Error("ios/Podfile is missing CODE_SIGNING_ALLOWED = 'NO' for pod targets");
}

if (!podfile.includes("config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'")) {
  throw new Error("ios/Podfile is missing CODE_SIGNING_REQUIRED = 'NO' for pod targets");
}

if (!rootPbxproj.includes('path = App/App;')) {
  throw new Error('ios/App.xcodeproj is not pointing at the nested App/App sources');
}

if (!rootPbxproj.includes('INFOPLIST_FILE = App/App/Info.plist;')) {
  throw new Error('ios/App.xcodeproj is not using App/App/Info.plist');
}

if (!rootPbxproj.includes('CODE_SIGN_ENTITLEMENTS = App/App/App.entitlements;')) {
  throw new Error('ios/App.xcodeproj is not using App/App/App.entitlements for Debug');
}

if (!rootPbxproj.includes('CODE_SIGN_ENTITLEMENTS = App/App/AppRelease.entitlements;')) {
  throw new Error('ios/App.xcodeproj is not using App/App/AppRelease.entitlements for Release');
}

if (!rootPbxproj.includes('relativePath = "App/CapApp-SPM";')) {
  throw new Error('ios/App.xcodeproj is not pointing at App/CapApp-SPM');
}

const reactNativePackageJsonPath = requireFromRepo.resolve('react-native/package.json');
const reactNativePackageJson = JSON.parse(readFileSync(reactNativePackageJsonPath, 'utf8'));

if (reactNativePackageJson.name !== 'react-native') {
  throw new Error('Resolved react-native package does not report the expected package name');
}

if (reactNativePackageJson.version !== '0.84.1') {
  throw new Error(
    `Resolved react-native shim version is ${reactNativePackageJson.version}, expected 0.84.1`
  );
}

console.log(
  'Verified EAS iOS layout, Podfile signing workaround, and react-native shim: root App.xcodeproj for EAS, nested App/App + App/CapApp-SPM for Capacitor, shared App scheme, root Podfile, and resource bundle signing disabled.'
);
