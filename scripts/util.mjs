// Shared helpers for the dev/build scripts. No dependencies besides Node itself.
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Locate the TypeScript compiler: local node_modules first, then a global `tsc`. */
export function tscCommand() {
  try {
    const req = createRequire(import.meta.url);
    return { cmd: process.execPath, args: [req.resolve('typescript/bin/tsc')] };
  } catch {
    return { cmd: process.platform === 'win32' ? 'tsc.cmd' : 'tsc', args: [] };
  }
}

export function runTscOnce(extra = []) {
  const { cmd, args } = tscCommand();
  // تمت إضافة shell: true هنا
  return spawnSync(cmd, [...args, '-p', 'tsconfig.json', ...extra], { cwd: root, stdio: 'inherit', shell: true });
}

export function runTscWatch() {
  const { cmd, args } = tscCommand();
  // وتمت إضافة shell: true هنا أيضاً
  return spawn(cmd, [...args, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { cwd: root, stdio: 'inherit', shell: true });
}