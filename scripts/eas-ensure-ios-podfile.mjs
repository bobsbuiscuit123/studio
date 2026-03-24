import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureRootPodfile } from './ios-podfile-template.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPodfile = path.join(repoRoot, 'ios', 'Podfile');

ensureRootPodfile(rootPodfile);
console.log('Ensured ios/Podfile contains the iOS resource bundle signing workaround.');
