import { spawn } from 'node:child_process';
import { watch, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const watchDir = path.join(projectRoot, 'src', 'ai');
const watchEnabled = String(process.env.GENKIT_WATCH ?? '1') !== '0';
const lockPath = path.join(projectRoot, '.genkit-dev.lock');
const command = process.platform === 'win32' ? 'cmd' : 'sh';
const commandArgs =
  process.platform === 'win32'
    ? ['/c', 'genkit start -- tsx src/ai/dev.ts']
    : ['-c', 'genkit start -- tsx src/ai/dev.ts'];

let child = null;
let restarting = false;
let restartTimer = null;
let watcher = null;

const log = message => {
  process.stdout.write(`[genkit-watch] ${message}\n`);
};

const isProcessAlive = pid => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readLock = () => {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.pid === 'number' ? parsed : null;
  } catch {
    return null;
  }
};

const writeLock = pid => {
  try {
    writeFileSync(lockPath, JSON.stringify({ pid, startedAt: Date.now() }));
  } catch (error) {
    log(`Failed to write lock file: ${error.message}`);
  }
};

const clearLock = () => {
  try {
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  } catch (error) {
    log(`Failed to remove lock file: ${error.message}`);
  }
};

const killChild = () =>
  new Promise(resolve => {
    if (!child || child.killed) {
      resolve();
      return;
    }

    const pid = child.pid;
    const onExit = () => resolve();
    child.once('exit', onExit);

    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
        .on('exit', onExit)
        .on('error', onExit);
      return;
    }

    child.kill('SIGTERM');
    setTimeout(() => {
      if (child && !child.killed) {
        child.kill('SIGKILL');
      }
    }, 2000);
  });

const startChild = () => {
  log('Starting Genkit server...');
  child = spawn(command, commandArgs, {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  if (child.pid) {
    writeLock(child.pid);
  }
  child.on('exit', code => {
    clearLock();
    if (!restarting) {
      log(`Genkit exited (${code ?? 'unknown'}).`);
    }
  });
};

const scheduleRestart = () => {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    restarting = true;
    log('Restarting Genkit server...');
    await killChild();
    startChild();
    restarting = false;
  }, 300);
};

const startWatcher = () => {
  if (!watchEnabled) {
    log('Watch disabled. Running a single Genkit server.');
    return;
  }
  watcher = watch(watchDir, { recursive: true }, (_eventType, filename) => {
    if (!filename) return;
    scheduleRestart();
  });
  watcher.on('error', error => {
    log(`Watcher error: ${error.message}`);
  });
};

const shutdown = async () => {
  log('Shutting down...');
  if (watcher) watcher.close();
  await killChild();
  clearLock();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', clearLock);

const existing = readLock();
if (existing && isProcessAlive(existing.pid)) {
  log(`Another Genkit server is already running (pid ${existing.pid}).`);
  process.exit(0);
} else if (existing) {
  clearLock();
}

startChild();
startWatcher();
