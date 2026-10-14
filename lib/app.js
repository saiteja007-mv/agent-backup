// Package version, and the stable copy of the app that schedulers run (never npx at 3 a.m.).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const VERSION = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version;

export function ensureAppCopy(cfg) {
  const dst = path.join(cfg._dir, 'app', VERSION);
  if (path.resolve(dst) !== PKG_ROOT) {
    fs.rmSync(dst, { recursive: true, force: true });
    for (const p of ['bin', 'lib', 'skill', 'package.json']) {
      fs.cpSync(path.join(PKG_ROOT, p), path.join(dst, p), { recursive: true });
    }
  }
  return path.join(dst, 'bin', 'agent-backup.js');
}

// The command a scheduler runs: this node binary + the stable copy (+ a custom config folder).
export function execBase(cfg) {
  const base = [process.execPath, ensureAppCopy(cfg)];
  if (process.env.AGENT_BACKUP_HOME) base.push('--home', process.env.AGENT_BACKUP_HOME);
  return base;
}
