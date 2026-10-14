// Thin wrapper over the restic and rclone binaries.
import fs from 'node:fs';
import path from 'node:path';
import { run, which } from './util.js';
import { OS } from './platform.js';

function findExeIn(dir, name, depth = 2) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().startsWith(name) && e.name.toLowerCase().endsWith('.exe')) return p;
  }
  if (depth > 0) {
    for (const e of entries) if (e.isDirectory()) { const f = findExeIn(path.join(dir, e.name), name, depth - 1); if (f) return f; }
  }
  return null;
}

// restic/rclone/docker/tailscale: config pin, then PATH, then common install folders.
export function findBinary(name, cfg) {
  const pinned = cfg?.binaries?.[name];
  if (pinned && fs.existsSync(pinned)) return pinned;
  const w = which(name);
  if (w) return w;
  if (OS === 'windows') {
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const d of fs.readdirSync(pk)) {
        if (d.toLowerCase().startsWith(`${name}.`)) { const f = findExeIn(path.join(pk, d), name); if (f) return f; }
      }
    } catch { /* no winget packages dir */ }
    const extra = {
      tailscale: ['C:\\Program Files\\Tailscale\\tailscale.exe'],
      docker: ['C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'],
    }[name] || [];
    for (const p of extra) if (fs.existsSync(p)) return p;
  } else {
    for (const p of [`/usr/local/bin/${name}`, `/usr/bin/${name}`, `/opt/homebrew/bin/${name}`, `/snap/bin/${name}`]) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export class Restic {
  constructor(cfg) {
    this.cfg = cfg;
    this.bin = findBinary('restic', cfg);
    this.rclone = findBinary('rclone', cfg);
  }

  env(extra = {}) {
    return {
      ...process.env,
      RESTIC_REPOSITORY: this.cfg.repository,
      RESTIC_PASSWORD_FILE: this.cfg.passwordFile,
      RESTIC_PROGRESS_FPS: '0.1',
      ...extra,
    };
  }

  // --retry-lock (restic 0.16+): a manual command waits for a running backup instead of failing.
  baseArgs() {
    const rc = this.rclone && String(this.cfg.repository).startsWith('rclone:') ? ['-o', `rclone.program=${this.rclone}`] : [];
    return ['--retry-lock', '2m', ...rc];
  }

  exec(args, opts = {}) {
    if (!this.bin) throw new Error('restic is not installed (run "agentvault enroll --apply", or install restic).');
    const { env: extra, ...rest } = opts;
    return run(this.bin, [...this.baseArgs(), ...args], { ...rest, env: this.env(extra) });
  }

  json(args) {
    const r = this.exec([...args, '--json']);
    if (!r.ok) throw new Error(`restic ${args[0]} failed: ${r.stderr.trim().split('\n').slice(-3).join(' | ')}`);
    const out = r.stdout.trim();
    if (!out) return null;
    try { return JSON.parse(out); } catch { return out.split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
  }

  repoExists() { return this.exec(['cat', 'config']).ok; }

  init() { return this.exec(['init']); }

  snapshots(tags = []) {
    const args = ['snapshots'];
    for (const t of tags) args.push('--tag', t);
    return this.json(args) || [];
  }

  // Returns the summary line restic prints at the end of a JSON backup run.
  backup(paths, { tags = [], host, excludes = [] } = {}) {
    const args = ['backup', '--exclude-caches'];
    if (host) args.push('--host', host);
    for (const t of tags) args.push('--tag', t);
    for (const e of excludes) args.push('--exclude', e);
    args.push('--json', ...paths);
    const r = this.exec(args);
    const lines = r.stdout.split('\n').filter((l) => l.startsWith('{'));
    const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const summary = parsed.find((m) => m.message_type === 'summary') || null;
    const errors = parsed.filter((m) => m.message_type === 'error').map((m) => `${m.item || ''}: ${m.error?.message || ''}`.trim());
    // exit 3 = snapshot created but some files could not be read
    const ok = r.code === 0 || (r.code === 3 && summary);
    return { ok: Boolean(ok), code: r.code, summary, errors, stderr: r.stderr };
  }

  forget(ret, { prune = false } = {}) {
    const args = ['forget', '--tag', 'av:1', '--group-by', 'host,tags',
      '--keep-daily', String(ret.daily), '--keep-weekly', String(ret.weekly), '--keep-monthly', String(ret.monthly)];
    if (prune) args.push('--prune');
    return this.exec(args);
  }

  check(subset) {
    const args = ['check'];
    if (subset) args.push(`--read-data-subset=${subset}`);
    return this.exec(args);
  }

  restore(snapshotId, target, { includes = [], verify = false } = {}) {
    const args = ['restore', snapshotId, '--target', target];
    for (const i of includes) args.push('--include', i);
    if (verify) args.push('--verify');
    const r = this.exec(args);
    // On Windows restic also restores the permissions of parent folders like C:\Users, which leaves a
    // folder you cannot delete. Reset everything restored to normal inherited permissions.
    if (OS === 'windows') run('icacls', [target, '/reset', '/T', '/C', '/Q']);
    // Errors that only concern timestamps/permissions of folders are not data loss.
    const errs = r.stderr.split('\n').filter((l) => l.startsWith('ignoring error for'));
    if (!r.ok && errs.length && errs.every((l) => /failed to restore (timestamp|security descriptor|extended attributes|attributes)/i.test(l))) {
      return { ...r, ok: true, warnings: errs.length };
    }
    return r;
  }

  ls(snapshotId) {
    const r = this.exec(['ls', snapshotId, '--json']);
    if (!r.ok) throw new Error(`restic ls failed: ${r.stderr.trim()}`);
    return r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((n) => n.struct_type === 'node');
  }

  diff(a, b) { return this.exec(['diff', a, b]); }

  stats() {
    try { return this.json(['stats', '--mode', 'raw-data']); } catch { return null; }
  }
}

// Latest snapshot per component tag, for one host (or all hosts).
export function latestByComponent(snaps, host) {
  const out = new Map();
  for (const s of snaps) {
    if (host && s.hostname !== host) continue;
    const t = (s.tags || []).find((x) => x.startsWith('component:'));
    if (!t) continue;
    const id = t.slice('component:'.length);
    const prev = out.get(id);
    if (!prev || new Date(s.time) > new Date(prev.time)) out.set(id, s);
  }
  return out;
}
