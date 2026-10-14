// Machine setup: SSH keys, dotfiles, tool configs, services, and lists of installed packages
// so tools can be reinstalled. Restores to the same OS (or to a scratch folder for reference).
import fs from 'node:fs';
import path from 'node:path';
import { home, appdata, existingEntries, JUNK } from './common.js';
import { run, runToFile, mkdirp, exists } from '../util.js';
import { configDir, isRoot, resolveEntry } from '../platform.js';
import { findBinary } from '../restic.js';

const COMMON = [home('.ssh'), home('.gitconfig'), home('.config/gh'), home('.config/tinyfish'), home('.npmrc')];

const LINUX = [home('.bashrc'), home('.profile'), home('.bash_aliases'), home('.zshrc'), home('.config/systemd/user'), home('.config/rclone')];
const MACOS = [home('.zshrc'), home('.zprofile'), home('Library/LaunchAgents'), home('.config/rclone')];
const WINDOWS = [home('Documents/PowerShell'), home('Documents/WindowsPowerShell'), appdata('rclone')];

function entriesFor(os) {
  return [...COMMON, ...(os === 'windows' ? WINDOWS : os === 'macos' ? MACOS : LINUX)];
}

// [file name, command, args]: each is run if the tool exists; stdout becomes a file in staging.
function lists(os) {
  const l = [
    ['npm-global.json', 'npm', ['ls', '-g', '--depth=0', '--json']],
    ['uv-tools.txt', 'uv', ['tool', 'list']],
    ['pipx.txt', 'pipx', ['list', '--short']],
    ['docker-images.txt', 'docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}']],
    ['tailscale-serve.json', 'tailscale', ['serve', 'status', '--json']],
  ];
  if (os === 'linux') {
    l.push(['apt-manual.txt', 'apt-mark', ['showmanual']], ['snaps.txt', 'snap', ['list']],
      ['crontab.txt', 'crontab', ['-l']], ['user-units.txt', 'systemctl', ['--user', 'list-unit-files', '--state=enabled', '--no-legend']]);
  } else if (os === 'macos') {
    l.push(['brew-bundle.txt', 'brew', ['bundle', 'dump', '--file=-']], ['crontab.txt', 'crontab', ['-l']]);
  } else {
    l.push(['scoop-export.json', 'scoop', ['export']]);
  }
  return l;
}

// Hand-made system services and a few well-known config folders (Linux). Copied, not linked.
function copyEtc(stagingDir) {
  const notes = [];
  const dst = mkdirp(path.join(stagingDir, 'etc'));
  const units = '/etc/systemd/system';
  try {
    for (const n of fs.readdirSync(units)) {
      const p = path.join(units, n);
      const st = fs.lstatSync(p);
      if (st.isFile() && /\.(service|timer|mount|path)$/.test(n) && !n.startsWith('snap.')) {
        mkdirp(path.join(dst, 'systemd'));
        try { fs.copyFileSync(p, path.join(dst, 'systemd', n)); } catch { notes.push(`unreadable: ${p}`); }
      }
    }
  } catch { /* no systemd */ }
  for (const p of ['/etc/hosts', '/etc/fstab', '/etc/caddy', '/etc/cron.d', '/etc/sudoers.d', '/etc/netplan', '/etc/docker/daemon.json']) {
    if (!exists(p)) continue;
    try { fs.cpSync(p, path.join(dst, p.replace(/^\/etc\//, '')), { recursive: true, dereference: false }); } catch { notes.push(`unreadable without root: ${p}`); }
  }
  return notes;
}

export const system = {
  id: 'system',
  title: 'System setup (SSH keys, dotfiles, services, package lists)',
  kind: 'system',
  crossOS: false,
  get entries() { return entriesFor(process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'); },
  detect: () => true,
  // The staging folder is backed up on purpose (it holds the package lists), so it is not excluded here.
  excludes(ctx) {
    const own = configDir();
    const docs = ['Documents/PowerShell/Modules', 'Documents/WindowsPowerShell/Modules'].map((r) => resolveEntry(home(r), ctx));
    return [...JUNK, ...docs, path.join(own, 'password'), path.join(own, 'slack-webhook'), path.join(own, 'tmp')];
  },
  async pre(ctx, staging) {
    const notes = [];
    const out = mkdirp(path.join(staging, 'lists'));
    for (const [file, cmd, args] of lists(ctx.os)) {
      const bin = findBinary(cmd, ctx.cfg);
      if (!bin) continue;
      const r = await runToFile(bin, args, path.join(out, file));
      if (!r.ok && !/crontab/.test(cmd)) notes.push(`${cmd}: ${r.stderr.trim().split('\n')[0]?.slice(0, 100) || 'failed'}`);
    }
    if (ctx.os === 'windows') {
      const wg = findBinary('winget', ctx.cfg);
      if (wg) run(wg, ['export', '-o', path.join(out, 'winget-export.json'), '--accept-source-agreements', '--disable-interactivity']);
      run('reg', ['export', 'HKCU\\Environment', path.join(out, 'user-environment.reg'), '/y']);
      // Scheduled tasks you created (not Microsoft's or vendors' under sub-folders).
      const ps = "$d='" + path.join(out, 'scheduled-tasks').replace(/'/g, "''") + "'; New-Item -ItemType Directory -Force -Path $d | Out-Null; " +
        "Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\\' -and $_.Author -notmatch 'Microsoft' } | ForEach-Object { Export-ScheduledTask -TaskName $_.TaskName | Out-File -Encoding unicode (Join-Path $d (($_.TaskName -replace '[\\\\/:*?\"<>|]','_') + '.xml')) }";
      run('powershell.exe', ['-NoProfile', '-Command', ps]);
    }
    if (ctx.os === 'linux') notes.push(...copyEtc(staging).slice(0, 8));
    if (ctx.os === 'linux' && !isRoot()) notes.push('not root: /etc files that need root were skipped');
    return { ok: true, notes };
  },
  restoreNotes: ['Package lists are in lists/ inside the restored folder: reinstall from them (winget import, apt, brew bundle).'],
};

export function systemEntries(ctx) { return existingEntries(entriesFor(ctx.os), ctx); }
