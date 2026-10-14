// agent-backup enroll: show the plan; with --apply, choose where backups go and set this machine up.
// The password and the Google sign-in are always typed by you, never passed on the command line.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, saveConfig, hasPassword, applyStorage, STORAGE, DEFAULT_LOCAL_ROOT } from '../config.js';
import { Restic, findBinary } from '../restic.js';
import { makeCtx, active } from '../components/index.js';
import { writeEntry } from '../registry.js';
import { install } from '../schedule.js';
import { execBase, VERSION } from '../app.js';
import { OS, isRoot } from '../platform.js';
import { clientArgs, needsReconnect } from '../google.js';
import { run, which, mkdirp, ask, askHidden, lockDownFile } from '../util.js';

const WINGET_ID = { restic: 'restic.restic', rclone: 'Rclone.Rclone' };

function installCmd(pkg) {
  if (OS === 'windows') return ['winget', ['install', '-e', '--id', WINGET_ID[pkg], '--accept-package-agreements', '--accept-source-agreements']];
  if (OS === 'macos') return ['brew', ['install', pkg]];
  const pm = which('apt-get') ? ['apt-get', 'install', '-y', pkg] : which('dnf') ? ['dnf', 'install', '-y', pkg] : null;
  if (!pm) return null;
  return isRoot() ? [pm[0], pm.slice(1)] : ['sudo', pm];
}

const remoteOf = (loc) => (String(loc || '').startsWith('rclone:') ? String(loc).split(':')[1] : null);

function jobsFor(cfg) {
  return ['backup', ...(cfg.schedule.selftest ? ['selftest'] : []), ...(cfg.schedule.watchdog ? ['watchdog'] : [])];
}

// A backup folder on the same disk as your files guards against mistakes, not against a dead disk.
export function sameDisk(p, home) {
  if (OS === 'windows') return path.parse(path.resolve(p)).root.toLowerCase() === path.parse(home).root.toLowerCase();
  let q = path.resolve(p);
  while (!fs.existsSync(q) && path.dirname(q) !== q) q = path.dirname(q);
  try { return fs.statSync(q).dev === fs.statSync(home).dev; } catch { return true; }
}

async function storageMenu() {
  console.log('\nWhere should backups go?');
  STORAGE.forEach((s, i) => console.log(`  ${i + 1}. ${s.label.padEnd(27)} ${s.soon ? '(coming soon)' : s.note}`));
  for (;;) {
    const s = STORAGE[Number(await ask(`Choose 1-${STORAGE.length}: `)) - 1];
    if (!s) continue;
    if (s.soon) { console.log(`${s.label} is coming in a future release. Pick another one for now.`); continue; }
    return s.key;
  }
}

// Decide storage: --repo (any restic repository) > --storage > current config > menu (with --apply).
async function chooseStorage(cfg, o) {
  if (o.repo) {
    cfg.storage = 'custom';
    cfg.repository = String(o.repo);
    if (o.registry) cfg.registry = String(o.registry);
    cfg.copyTo = o['copy-to'] ? String(o['copy-to']) : null;
    return true;
  }
  let storage = o.storage ? String(o.storage) : null;
  if (!storage && cfg._storageChosen) return true;
  if (!storage) {
    if (!o.apply) return false; // plan only: list the choices, ask at --apply
    if (!process.stdin.isTTY) throw new Error('choose where backups go: --storage local|gdrive|both');
    storage = await storageMenu();
  }
  let root = o.path ? String(o.path) : DEFAULT_LOCAL_ROOT;
  if (storage !== 'gdrive' && !o.path && o.apply && process.stdin.isTTY) {
    root = (await ask(`Folder for local backups [${DEFAULT_LOCAL_ROOT}]: `)) || DEFAULT_LOCAL_ROOT;
  }
  applyStorage(cfg, storage, root, o['copy-to'] ? String(o['copy-to']) : undefined);
  return true;
}

function describeStorage(cfg) {
  const lines = [];
  if (cfg.storage === 'gdrive') lines.push(`Google Drive: ${cfg.repository}`);
  else if (cfg.storage === 'custom') lines.push(`restic repository: ${cfg.repository}`);
  else lines.push(`local folder: ${cfg.repository}`);
  if (cfg.copyTo) lines.push(`then copied to: ${cfg.copyTo}`);
  if (cfg.localRoot && sameDisk(cfg.localRoot, cfg.home)) {
    lines.push(cfg.copyTo
      ? 'note: the local folder is on the same disk as your files; the copy is what survives a dead disk'
      : 'WARNING: this folder is on the same disk as your files. It undoes mistakes but does not survive a dead disk. Use an external drive, or option 3 (Local + Google Drive copy).');
  }
  return lines;
}

export default async function enroll(o) {
  const cfg = loadConfig();
  if (o.time) cfg.schedule.time = String(o.time);
  if (!/^\d{1,2}:\d{2}$/.test(cfg.schedule.time)) throw new Error('--time must look like 03:00');
  const chosen = await chooseStorage(cfg, o);

  const remotes = chosen ? [...new Set([cfg.repository, cfg.copyTo, cfg.registry].map(remoteOf).filter(Boolean))] : ['agent-backup-gdrive'];
  const need = ['restic', ...(remotes.length ? ['rclone'] : [])].filter((b) => !findBinary(b, cfg));
  const rc = findBinary('rclone', cfg);
  const haveRemotes = rc ? run(rc, ['listremotes']).stdout.split(/\s+/) : [];
  const newRemotes = remotes.filter((r) => !haveRemotes.includes(`${r}:`));
  const oldClient = rc ? remotes.filter((r) => haveRemotes.includes(`${r}:`) && needsReconnect(rc, r)) : [];
  const comps = active(makeCtx(cfg));
  const rootOnly = comps.filter((c) => c.needsRoot && !isRoot()).map((c) => c.id);

  console.log(`\nPlan for ${cfg.host} (${OS}):\n`);
  if (chosen) {
    console.log('1. Storage:');
    for (const l of describeStorage(cfg)) console.log(`     ${l}`);
  } else {
    console.log('1. Storage: you choose at --apply (or pass --storage):');
    for (const s of STORAGE) console.log(`     ${s.key.padEnd(9)} ${s.label}${s.soon ? ' (coming soon)' : `: ${s.note}`}`);
  }
  console.log(`2. Tools: ${need.length ? `install ${need.join(' and ')}` : 'already installed'}`);
  console.log(`3. Google Drive: ${!remotes.length ? 'not used' : newRemotes.length
    ? `connect remote "${newRemotes.join('", "')}" if you pick it (you sign in in a browser; access is limited to files agent-backup creates)`
    : oldClient.length ? `sign in once more ("${oldClient.join('", "')}" was connected through rclone's retiring shared Google client)`
      : 'already connected'}`);
  console.log(`4. Password: ${hasPassword(cfg) ? 'already set' : 'you type it (use the SAME password on every machine and keep it in your password manager; without it the backups cannot be read)'}`);
  console.log(`5. Schedule: ${o['no-schedule'] ? 'skipped (--no-schedule)' : `daily at ${cfg.schedule.time}${cfg.schedule.selftest ? ', test restore on the 1st of each month' : ''}${OS === 'linux' ? (isRoot() ? ' (system timers)' : ' (user timers)') : ''}`}`);
  console.log(`6. First backup: ${o['no-backup'] ? 'skipped (--no-backup)' : comps.map((c) => c.id).join(', ')}`);
  console.log(`7. Fleet list: ${chosen ? cfg.registry : 'next to the backups'}${chosen && !remoteOf(cfg.registry) ? ' (local: the fleet view shows only machines that share this folder)' : ''}`);
  if (rootOnly.length) console.log(`\nNote: ${rootOnly.join(', ')} need root. Run enroll with sudo to include them.`);

  if (!o.apply) {
    console.log('\nNothing has been changed. To do this, run: agent-backup enroll --apply');
    return 0;
  }
  if (!o.yes) {
    if (!process.stdin.isTTY) throw new Error('enroll --apply asks for confirmation; add --yes when not running interactively');
    if ((await ask('\nProceed? (yes/no) ')).toLowerCase() !== 'yes') { console.log('Cancelled.'); return 1; }
  }

  mkdirp(cfg._dir, 0o700);
  for (const b of need) {
    const c = installCmd(b);
    if (!c) throw new Error(`install ${b} with your package manager, then run enroll again`);
    console.log(`\n> ${c[0]} ${c[1].join(' ')}`);
    spawnSync(c[0], c[1], { stdio: 'inherit' });
    if (!findBinary(b, cfg)) throw new Error(`${b} still not found after installing; install it by hand and run enroll again`);
  }
  // Pin binaries: schedulers run with a smaller PATH than your shell.
  for (const b of ['restic', 'rclone']) { const p = findBinary(b, cfg); if (p) cfg.binaries[b] = p; }

  // No browser here (a server): rclone prints an "rclone authorize" command to run on a computer that has
  // one, then asks for the token it prints.
  const headless = OS === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const signIn = headless
    ? 'This machine has no browser: run the "rclone authorize" command rclone shows on a computer that has one, then paste the result here.'
    : 'Sign in in the browser window that opens.';
  for (const r of newRemotes) {
    const rclone = cfg.binaries.rclone;
    console.log(`\nConnecting Google Drive as "${r}". ${signIn}`);
    spawnSync(rclone, ['config', 'create', r, 'drive', 'scope=drive.file', ...clientArgs(), ...(headless ? ['config_is_local=false'] : [])], { stdio: 'inherit' });
    if (!run(rclone, ['listremotes']).stdout.split(/\s+/).includes(`${r}:`)) throw new Error(`Google Drive remote "${r}" was not created`);
  }
  for (const r of oldClient) {
    const rclone = cfg.binaries.rclone;
    console.log(`\nMoving "${r}" to agent-backup's Google sign-in. ${signIn}`);
    run(rclone, ['config', 'update', r, ...clientArgs()]);
    const re = spawnSync(rclone, ['config', 'reconnect', `${r}:`], { stdio: 'inherit' });
    if (re.status !== 0) throw new Error(`Google Drive sign-in for "${r}" did not finish`);
  }

  if (!hasPassword(cfg)) {
    let pw;
    if (o['password-file']) pw = fs.readFileSync(String(o['password-file']), 'utf8').trim();
    else {
      if (!process.stdin.isTTY) throw new Error('the password is typed interactively (or pass --password-file)');
      pw = await askHidden('Backup password: ');
      if ((await askHidden('Same password again: ')) !== pw) throw new Error('the two passwords differ');
    }
    if (pw.length < 12) throw new Error('use at least 12 characters');
    fs.writeFileSync(cfg.passwordFile, pw, { mode: 0o600 });
    lockDownFile(cfg.passwordFile);
  }
  if (cfg.localRoot) mkdirp(cfg.localRoot);
  saveConfig(cfg);

  const restic = new Restic(cfg);
  const open = (rs, where, fromRepo) => {
    if (rs.repoExists()) { console.log(`\n${where}: found and opened with your password.`); return; }
    const r = rs.init({ fromRepo });
    if (!r.ok) {
      if (/already (exists|initialized)/i.test(r.stderr)) throw new Error(`${where}: a repository exists there but this password does not open it. Use the password from your first machine.`);
      throw new Error(`${where}: could not create the repository: ${r.stderr.trim().split('\n').pop()}`);
    }
    console.log(`\n${where}: repository created.`);
  };
  open(restic, 'Backups', undefined);
  if (cfg.copyTo) open(restic.withRepo(cfg.copyTo), 'Copy', cfg.repository);

  const reg = writeEntry(cfg, {
    host: cfg.host, os: OS, version: VERSION, storage: cfg.storage, repository: cfg.repository, copyTo: cfg.copyTo || null,
    enrolled: new Date().toISOString(), time: null, ok: null, staleHours: cfg.schedule.staleHours, components: {},
  });
  if (!reg.ok) console.log(`Fleet list not updated: ${reg.error}`);

  if (!o['no-schedule']) {
    for (const d of install(cfg, execBase(cfg), jobsFor(cfg))) {
      console.log(d.ok ? `Scheduled ${d.job}: ${d.where}` : `Schedule ${d.job}: ${d.error}`);
    }
  }
  console.log('\nOptional: "agent-backup slack set" to get a Slack message after every run.');
  if (o['no-backup']) return 0;
  console.log('\nFirst backup:');
  return (await import('./backup.js')).default({});
}
