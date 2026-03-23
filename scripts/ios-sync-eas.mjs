import fs from 'fs';
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.CAPACITOR_CONFIG = 'capacitor.config.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iosRoot = path.join(repoRoot, 'ios');
const nestedWrapper = path.join(iosRoot, 'App');
const nestedXcodeproj = path.join(nestedWrapper, 'App.xcodeproj');
const nestedAppDir = path.join(nestedWrapper, 'App');
const nestedSpmDir = path.join(nestedWrapper, 'CapApp-SPM');

const rootXcodeproj = path.join(iosRoot, 'App.xcodeproj');
const rootAppDir = path.join(iosRoot, 'App');
const rootSpmDir = path.join(iosRoot, 'CapApp-SPM');
const rootDebugXcconfig = path.join(iosRoot, 'debug.xcconfig');
const rootPodfile = path.join(iosRoot, 'Podfile');

const tempXcodeproj = path.join(iosRoot, '__tmp_App.xcodeproj');
const tempAppDir = path.join(iosRoot, '__tmp_App');
const tempSpmDir = path.join(iosRoot, '__tmp_CapApp-SPM');

const podfileTemplate = `source 'https://cdn.cocoapods.org/'
platform :ios, '15.0'

project 'App.xcodeproj'

target 'App' do
end
`;

function rewriteNestedProjectPaths() {
  const pbxprojPath = path.join(nestedXcodeproj, 'project.pbxproj');
  if (existsSync(pbxprojPath)) {
    const pbxproj = readFileSync(pbxprojPath, 'utf8').replaceAll('path = debug.xcconfig;', 'path = ../debug.xcconfig;');
    writeFileSync(pbxprojPath, pbxproj);
  }

  const packageSwiftPath = path.join(nestedSpmDir, 'Package.swift');
  if (existsSync(packageSwiftPath)) {
    let packageSwift = readFileSync(packageSwiftPath, 'utf8');
    packageSwift = packageSwift.replaceAll('\\', '/');
    packageSwift = packageSwift.replaceAll('../../node_modules/', '../../../node_modules/');
    writeFileSync(packageSwiftPath, packageSwift);
  }
}

function prepareNestedLayoutForCapSync() {
  const nestedLayoutExists = existsSync(nestedXcodeproj) && existsSync(nestedAppDir) && existsSync(nestedSpmDir);
  if (nestedLayoutExists) {
    rewriteNestedProjectPaths();
    return;
  }

  const flatLayoutExists = existsSync(rootXcodeproj) && existsSync(rootAppDir) && existsSync(rootSpmDir);
  if (!flatLayoutExists) {
    // 🔥 TEMP FIX: support __tmp_App layout
if (fs.existsSync(path.join(iosDir, '__tmp_App'))) {
  console.log('Using __tmp_App layout directly');
  return;
}
    throw new Error('Unable to prepare iOS sync because neither the flat nor nested Capacitor layout is present');
  }

  renameSync(rootXcodeproj, tempXcodeproj);
  renameSync(rootAppDir, tempAppDir);
  renameSync(rootSpmDir, tempSpmDir);

  mkdirSync(nestedWrapper, { recursive: true });

  renameSync(tempXcodeproj, nestedXcodeproj);
  renameSync(tempAppDir, nestedAppDir);
  renameSync(tempSpmDir, nestedSpmDir);

  rewriteNestedProjectPaths();
}

function runCapSync() {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'cmd' : 'npx';
  const args = isWindows ? ['/c', 'npx', 'cap', 'sync', 'ios'] : ['cap', 'sync', 'ios'];
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });

  if (result.status !== 0) {
    throw new Error(`cap sync ios failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function ensureExpectedNestedLayout() {
  const required = [nestedWrapper, nestedXcodeproj, nestedAppDir, nestedSpmDir, rootDebugXcconfig];
  for (const target of required) {
    if (!existsSync(target)) {
      throw new Error(`Expected Capacitor iOS output is missing: ${path.relative(repoRoot, target)}`);
    }
  }
}

function clearPreviousFlatTargets() {
  for (const target of [rootXcodeproj, rootSpmDir]) {
    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
  }
}

function flattenTree() {
  renameSync(nestedXcodeproj, tempXcodeproj);
  renameSync(nestedAppDir, tempAppDir);
  renameSync(nestedSpmDir, tempSpmDir);

  rmSync(nestedWrapper, { recursive: true, force: true });

  renameSync(tempXcodeproj, rootXcodeproj);
  renameSync(tempAppDir, rootAppDir);
  renameSync(tempSpmDir, rootSpmDir);
}

function rewriteProjectPaths() {
  const pbxprojPath = path.join(rootXcodeproj, 'project.pbxproj');
  const pbxproj = readFileSync(pbxprojPath, 'utf8').replaceAll('../debug.xcconfig', 'debug.xcconfig');
  writeFileSync(pbxprojPath, pbxproj);

  const packageSwiftPath = path.join(rootSpmDir, 'Package.swift');
  let packageSwift = readFileSync(packageSwiftPath, 'utf8');
  packageSwift = packageSwift.replaceAll('\\', '/');
  packageSwift = packageSwift.replaceAll('../../../node_modules/', '../../node_modules/');
  writeFileSync(packageSwiftPath, packageSwift);
}

function ensureRootPodfile() {
  writeFileSync(rootPodfile, podfileTemplate);
}

function ensureScheme() {
  const schemeDir = path.join(rootXcodeproj, 'xcshareddata', 'xcschemes');
  const schemePath = path.join(schemeDir, 'App.xcscheme');
  mkdirSync(schemeDir, { recursive: true });

  if (!existsSync(schemePath)) {
    throw new Error('Shared App scheme was not present after flattening');
  }
}

prepareNestedLayoutForCapSync();
runCapSync();
ensureExpectedNestedLayout();
flattenTree();
rewriteProjectPaths();
ensureRootPodfile();
ensureScheme();

await import('./verify-ios-eas-layout.mjs');
