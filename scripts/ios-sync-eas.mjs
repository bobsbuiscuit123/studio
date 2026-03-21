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

const tempXcodeproj = path.join(iosRoot, '__tmp_App.xcodeproj');
const tempAppDir = path.join(iosRoot, '__tmp_App');
const tempSpmDir = path.join(iosRoot, '__tmp_CapApp-SPM');

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

function ensureScheme() {
  const schemeDir = path.join(rootXcodeproj, 'xcshareddata', 'xcschemes');
  const schemePath = path.join(schemeDir, 'App.xcscheme');
  mkdirSync(schemeDir, { recursive: true });

  if (!existsSync(schemePath)) {
    throw new Error('Shared App scheme was not present after flattening');
  }
}

runCapSync();
ensureExpectedNestedLayout();
clearPreviousFlatTargets();
flattenTree();
rewriteProjectPaths();
ensureScheme();

await import('./verify-ios-eas-layout.mjs');
