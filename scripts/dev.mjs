import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const spawnCmd = isWindows ? 'cmd' : 'sh';

const run = (command, label, envOverrides = {}) => {
  const args = isWindows ? ['/c', command] : ['-c', command];
  const child = spawn(spawnCmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...envOverrides },
  });
  child.on('exit', code => {
    if (code && code !== 0) {
      process.stdout.write(`[dev] ${label} exited with code ${code}\n`);
    }
  });
  return child;
};

const nextDev = run('next dev --turbopack', 'next');
const genkitDev = run('node scripts/genkit-watch.mjs', 'genkit', {
  GENKIT_WATCH: '0',
});

const shutdown = () => {
  if (nextDev) nextDev.kill('SIGTERM');
  if (genkitDev) genkitDev.kill('SIGTERM');
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
