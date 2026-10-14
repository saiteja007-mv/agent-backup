// agentvault enroll: show the plan; with --apply, set this machine up. The password and the
// Google sign-in are always typed by you, never passed on the command line.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadConfig, saveConfig, hasPassword } from '../config.js';
import { Restic, findBinary } from '../restic.js';
import { makeCtx, active } from '../components/index.js';
import { writeEntry } from '../registry.js';
import { install } from '../schedule.js';
import { execBase, VERSION } from '../app.js';
import { OS, isRoot } from '../platform.js';
import { run, which, mkdirp, ask, askHidden, lockDownFile } from '../util.js';

const WINGET_ID = { restic: 'restic.restic', rclone: 'Rclone.Rclone' };

function installCmd(pkg) {
  if (OS === 'windows') return ['winget', ['install', '-e', '--id', WINGET_ID[pkg], '--accept-package-agreements', '--accept-source-agreements']];
  if (OS === 'macos') return ['brew', ['install', pkg]];
  const pm = which('apt-get') ? ['apt-get', 'install', '-y', pkg] : which('dnf') ? ['dnf', 'install', '-y', pkg] : null;
  if (!pm) return null;
  return isRoot() ? [pm[0], pm.slice(1)] : ['sudo', pm];
}

const remoteOf = (loc) => (String(loc).startsWith('rclone:') ? String(loc).split(':')[1] : null);

function jobsFor(cfg) {
  return ['backup', ...(cfg.schedule.selftest ? ['selftest'] : []), ...(cfg.schedule.watchdog ? ['watchdog'] : [])];
}

export default async function enroll(o) {
  const cfg = loadConfig();
  if (o.repo) cfg.repository = String(o.repo);
  if (o.registry) cfg.registry = String(o.registry);
  if (o.time) cfg.schedule.time = String(o.time);
  if (!/^\d{1,2}:\d{2}$/.test(cfg.schedule.time)) throw new Error('--time must look like 03:00');

  const remotes = [...new Set([cfg.repository, cfg.registry].map(remoteOf).filter(Boolean))];
  const need = ['restic', ...(remotes.length ? ['rclone'] : [])].filter((b) => !findBinary(b, cfg));
  const rc = findBinary('rclone', cfg);
  const haveRemotes = rc ? run(rc, ['listremotes']).stdout.split(/\s+/) : [];
  const newRemotes = remotes.filter((r) => !haveRemotes.includes(`${r}:`));
  const comps = active(makeCtx(cfg));
  const rootOnly = comps.filter((c) => c.needsRoot && !isRoot()).map((c) => c.id);

  console.log(`Plan for ${cfg.host} (${OS}):\n`);
  console.log(`1. Tools: ${need.length ? `install ${need.join(' and ')}` : 'restic' + (remotes.length ? ' and rclone' : '') + ' already installed'}`);
  console.log(`2. Google Drive: ${!remotes.length ? 'not used (local repository)' : newRemotes.length
    ? `connect remote "${newRemotes.join('", "')}" (you sign in in a browser; access is limited to files agentvault creates)`
    : 'already connected'}`);
  console.log(`3. Password: ${hasPassword(cfg) ? 'already set' : 'you type it (use the SAME password on every machine and keep it in your password manager; without it the backups cannot be read)'}`);
  console.log(`4. Repository: ${cfg.repository}`);
  console.log(`5. Schedule: ${o['no-schedule'] ? 'skipped (--no-schedule)' : `daily at ${cfg.schedule.time}${cfg.schedule.selftest ? ', test restore on the 1st of each month' : ''}${OS === 'linux' ? (isRoot() ? ' (system timers)' : ' (user timers)') : ''}`}`);
  console.log(`6. First backup: ${o['no-backup'] ? 'skipped (--no-backup)' : comps.map((c) => c.id).join(', ')}`);
  console.log(`7. Fleet list: ${cfg.registry}`);
  if (rootOnly.length) console.log(`\nNote: ${rootOnly.join(', ')} need root. Run enroll with sudo to include them.`);

  if (!o.apply) {
    console.log('\nNothing has been changed. To do this, run: agentvault enroll --apply');
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

  for (const r of newRemotes) {
    const rclone = cfg.binaries.rclone;
    const headless = OS === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
    if (headless) {
      console.log(`\nThis machine has no browser. In the rclone menu that opens: "n" (new remote), name "${r}", storage "drive",`);
      console.log('leave client id/secret empty, scope "drive.file", then answer "n" to auto config and follow its "rclone authorize" step');
      console.log('on a computer with a browser. (Or copy the remote section from another machine\'s rclone.conf.)');
      spawnSync(rclone, ['config'], { stdio: 'inherit' });
    } else {
      console.log(`\nConnecting Google Drive as "${r}". Sign in in the browser window that opens.`);
      spawnSync(rclone, ['config', 'create', r, 'drive', 'scope=drive.file'], { stdio: 'inherit' });
    }
    if (!run(rclone, ['listremotes']).stdout.split(/\s+/).includes(`${r}:`)) throw new Error(`Google Drive remote "${r}" was not created`);
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
  saveConfig(cfg);

  const restic = new Restic(cfg);
  if (restic.repoExists()) {
    console.log('\nRepository found and opened with your password.');
  } else {
    const r = restic.init();
    if (!r.ok) {
      if (/already (exists|initialized)/i.test(r.stderr)) throw new Error('a repository exists there but this password does not open it. Use the password from your first machine.');
      throw new Error(`could not create the repository: ${r.stderr.trim().split('\n').pop()}`);
    }
    console.log('\nRepository created.');
  }

  const reg = writeEntry(cfg, {
    host: cfg.host, os: OS, version: VERSION, repository: cfg.repository, enrolled: new Date().toISOString(),
    time: null, ok: null, staleHours: cfg.schedule.staleHours, components: {},
  });
  if (!reg.ok) console.log(`Fleet list not updated: ${reg.error}`);

  if (!o['no-schedule']) {
    for (const d of install(cfg, execBase(cfg), jobsFor(cfg))) {
      console.log(d.ok ? `Scheduled ${d.job}: ${d.where}` : `Schedule ${d.job}: ${d.error}`);
    }
  }
  console.log('\nOptional: "agentvault slack set" to get a Slack message after every run.');
  if (o['no-backup']) return 0;
  console.log('\nFirst backup:');
  return (await import('./backup.js')).default({});
}
