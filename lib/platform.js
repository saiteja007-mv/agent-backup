// Where things live on this machine, and the logical "roots" used to restore across OSes.
import os from 'node:os';
import path from 'node:path';
import { run } from './util.js';

export const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';

export function normHost(h) {
  return String(h || '').toLowerCase().replace(/\..*$/, '').replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'host';
}

export const HOST = normHost(process.env.AGENTVAULT_HOST || os.hostname());

export function isRoot() {
  return OS !== 'windows' && typeof process.getuid === 'function' && process.getuid() === 0;
}

// The home of the person whose agents we protect. Under sudo, that is SUDO_USER, not root.
export function defaultHome() {
  if (OS !== 'windows' && isRoot() && process.env.SUDO_USER) {
    const r = run('getent', ['passwd', process.env.SUDO_USER]);
    const h = r.stdout.split(':')[5];
    if (h) return h.trim();
  }
  return os.homedir();
}

export function configDir() {
  return process.env.AGENTVAULT_HOME || path.join(os.homedir(), '.config', 'agentvault');
}

// Logical roots: a component path is {root, rel}. On restore the same root resolves on the target machine.
export function roots(ctx) {
  const home = ctx.home;
  const winApp = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const winLocal = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const os_ = ctx.os || OS;
  return {
    home,
    appdata: os_ === 'windows' ? winApp : os_ === 'macos' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config'),
    localappdata: os_ === 'windows' ? winLocal : os_ === 'macos' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.local', 'share'),
    hermes: os_ === 'windows' ? path.join(winLocal, 'hermes') : path.join(home, '.hermes'),
    abs: '',
  };
}

export function resolveEntry(entry, ctx) {
  if (entry.root === 'abs') return entry.rel;
  const base = roots(ctx)[entry.root];
  if (base == null) throw new Error(`unknown root ${entry.root}`);
  return entry.rel ? path.join(base, ...entry.rel.split('/')) : base;
}

// How restic stores an absolute path inside a snapshot (Windows C:\x\y -> /C/x/y).
export function snapshotPath(abs, os_ = OS) {
  if (os_ === 'windows') {
    const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(abs);
    if (m) return '/' + m[1].toUpperCase() + '/' + m[2].replace(/\\/g, '/');
    return abs.replace(/\\/g, '/');
  }
  return abs;
}
