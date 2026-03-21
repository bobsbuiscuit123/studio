import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const iosRoot = path.join(cwd, 'ios');
const appRoot = path.join(iosRoot, 'App');
const podfile = path.join(appRoot, 'Podfile');
const project = path.join(appRoot, 'App.xcodeproj');
const infoPlist = path.join(appRoot, 'App', 'Info.plist');

function listDir(dir) {
  if (!fs.existsSync(dir)) {
    console.log(`[eas-pre-install] MISSING DIR: ${dir}`);
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true }).map(entry =>
    `${entry.isDirectory() ? '[dir] ' : '[file]'} ${entry.name}`
  );

  console.log(`[eas-pre-install] ls ${dir}`);
  for (const entry of entries) {
    console.log(`  ${entry}`);
  }
}

console.log(`[eas-pre-install] cwd: ${cwd}`);
console.log(`[eas-pre-install] ios/App/Podfile exists: ${fs.existsSync(podfile)}`);
console.log(`[eas-pre-install] ios/App/App.xcodeproj exists: ${fs.existsSync(project)}`);
console.log(`[eas-pre-install] ios/App/App/Info.plist exists: ${fs.existsSync(infoPlist)}`);

listDir(iosRoot);
listDir(appRoot);
