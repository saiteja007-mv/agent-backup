// Several devices on one Google account (or one shared folder): each device has its own repository
// <root>/<device>, all share one password, and no two devices may share a name by accident.
import fs from 'node:fs';
import path from 'node:path';
import { Restic } from './restic.js';
import { normHost } from './platform.js';
import { ask, fmtAge } from './util.js';

// Give this device another name: its repositories move along (<root>/<old> -> <root>/<new>).
export function renameDevice(cfg, name) {
  const old = cfg.host;
  const swap = (r) => (r && /[\\/]/.test(r) && String(r).split(/[\\/]/).pop() === old ? String(r).slice(0, -old.length) + name : r);
  cfg.host = name;
  cfg.repository = swap(cfg.repository);
  cfg.copyTo = swap(cfg.copyTo);
  return cfg;
}

// A device that is not enrolled yet meets an existing device of the same name: same machine
// (e.g. reinstalled: continue its backups) or a different one (choose another name)?
export async function resolveName(cfg, fleet, o = {}) {
  for (;;) {
    const e = fleet.find((f) => f.host === cfg.host);
    if (!e) return;
    const last = e.time ? `last backup ${fmtAge(Date.now() - Date.parse(e.time))}` : 'no backup yet';
    if (o['same-machine']) { console.log(`Continuing the backups of "${cfg.host}" (${last}).`); return; }
    if (!process.stdin.isTTY) {
      throw new Error(`a device named "${cfg.host}" is already backed up here (${e.os || '?'}, ${last}). ` +
        'If this is that machine (e.g. after a reinstall), add --same-machine; otherwise choose another name with --name <name>.');
    }
    console.log(`\nA device named "${cfg.host}" is already backed up here (${e.os || '?'}, ${last}).`);
    const a = (await ask('Is this that same machine, e.g. after a reinstall? yes = continue its backups, no = use another name: ')).toLowerCase();
    if (a === 'y' || a === 'yes') return;
    const name = normHost(await ask('Name for this device: '));
    if (name && name !== 'host') renameDevice(cfg, name);
  }
}

export function passwordVerdict(r) {
  if (r.ok) return 'ok';
  return /wrong password|no key found/i.test(r.stderr) ? 'wrong' : 'unreachable';
}

// Does this password open the backups of the devices already here? Tries the most recent devices,
// off-site (rclone) repositories first. 'unreachable' means it could not tell.
export function checkPassword(cfg, fleet, pw) {
  const tmp = path.join(cfg._dir, `.password-check-${process.pid}`);
  fs.writeFileSync(tmp, pw, { mode: 0o600 });
  try {
    const when = (e) => Date.parse(e.time || e.enrolled || 0) || 0;
    let detail = '';
    for (const e of [...fleet].sort((a, b) => when(b) - when(a)).slice(0, 3)) {
      const repos = [e.copyTo, e.repository].filter(Boolean)
        .sort((a, b) => Number(String(b).startsWith('rclone:')) - Number(String(a).startsWith('rclone:')));
      for (const repo of repos) {
        const r = new Restic({ ...cfg, repository: repo, passwordFile: tmp }).exec(['cat', 'config']);
        const v = passwordVerdict(r);
        if (v !== 'unreachable') return { verdict: v, host: e.host };
        detail = r.stderr.trim().split('\n').pop();
      }
    }
    return { verdict: 'unreachable', detail };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
