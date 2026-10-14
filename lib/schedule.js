// Nightly backup, monthly self-test and the optional morning watchdog, per OS:
// systemd (root or --user), Windows Task Scheduler, macOS launchd. Renderers are pure and tested.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { run, mkdirp } from './util.js';
import { OS, isRoot } from './platform.js';

export const JOBS = {
  backup: { args: ['backup', '--scheduled'], desc: 'agentvault nightly backup' },
  selftest: { args: ['selftest', '--scheduled'], desc: 'agentvault monthly test restore' },
  watchdog: { args: ['fleet', '--alert'], desc: 'agentvault missed-backup watchdog' },
};

export function jobTimes(cfg) {
  const [h, m] = cfg.schedule.time.split(':').map(Number);
  return {
    backup: { daily: true, hour: h, minute: m },
    selftest: { monthDay: 1, hour: (h + 1) % 24, minute: m },
    watchdog: { daily: true, hour: 8, minute: 0 },
  };
}

const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

export function renderSystemd(name, execArgs, when, desc) {
  const cal = when.daily
    ? `*-*-* ${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')}:00`
    : `*-*-${String(when.monthDay).padStart(2, '0')} ${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')}:00`;
  return {
    service: `[Unit]\nDescription=${desc}\nWants=network-online.target\nAfter=network-online.target\n\n[Service]\nType=oneshot\nExecStart=${execArgs.map(q).join(' ')}\nNice=10\nIOSchedulingClass=idle\n`,
    timer: `[Unit]\nDescription=${desc} (timer)\n\n[Timer]\nOnCalendar=${cal}\nPersistent=true\nRandomizedDelaySec=300\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export function renderLaunchd(label, execArgs, when) {
  const cal = when.daily
    ? `<dict><key>Hour</key><integer>${when.hour}</integer><key>Minute</key><integer>${when.minute}</integer></dict>`
    : `<dict><key>Day</key><integer>${when.monthDay}</integer><key>Hour</key><integer>${when.hour}</integer><key>Minute</key><integer>${when.minute}</integer></dict>`;
  const args = execArgs.map((a) => `<string>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args}</array><key>StartCalendarInterval</key>${cal}<key>RunAtLoad</key><false/></dict></plist>\n`;
}

export function renderWindowsPs(taskName, execArgs, when, desc) {
  const exe = execArgs[0];
  const argStr = execArgs.slice(1).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ').replace(/'/g, "''");
  const t = `${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')}`;
  const trigger = when.daily
    ? `New-ScheduledTaskTrigger -Daily -At '${t}'`
    : `New-ScheduledTaskTrigger -Weekly -WeeksInterval 4 -DaysOfWeek Sunday -At '${t}'`;
  return [
    `$a = New-ScheduledTaskAction -Execute '${exe.replace(/'/g, "''")}' -Argument '${argStr}'`,
    `$t = ${trigger}`,
    `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 6)`,
    `Register-ScheduledTask -TaskName '${taskName}' -Action $a -Trigger $t -Settings $s -Description '${desc.replace(/'/g, "''")}' -Force | Out-Null`,
  ].join('; ');
}

function systemdDir() {
  return isRoot() ? '/etc/systemd/system' : path.join(os.homedir(), '.config', 'systemd', 'user');
}

export function install(cfg, execBase, jobs) {
  const times = jobTimes(cfg);
  const done = [];
  for (const job of jobs) {
    const execArgs = [...execBase, ...JOBS[job].args];
    const name = `agentvault-${job}`;
    if (OS === 'linux') {
      const dir = mkdirp(systemdDir());
      const u = renderSystemd(name, execArgs, times[job], JOBS[job].desc);
      fs.writeFileSync(path.join(dir, `${name}.service`), u.service);
      fs.writeFileSync(path.join(dir, `${name}.timer`), u.timer);
      const sc = isRoot() ? ['systemctl'] : ['systemctl', '--user'];
      run(sc[0], [...sc.slice(1), 'daemon-reload']);
      const r = run(sc[0], [...sc.slice(1), 'enable', '--now', `${name}.timer`]);
      done.push({ job, ok: r.ok, where: path.join(dir, `${name}.timer`), error: r.stderr.trim() });
    } else if (OS === 'macos') {
      const dir = mkdirp(path.join(os.homedir(), 'Library', 'LaunchAgents'));
      const file = path.join(dir, `com.agentvault.${job}.plist`);
      fs.writeFileSync(file, renderLaunchd(`com.agentvault.${job}`, execArgs, times[job]));
      run('launchctl', ['unload', file]);
      const r = run('launchctl', ['load', file]);
      done.push({ job, ok: r.ok, where: file, error: r.stderr.trim() });
    } else {
      const ps = renderWindowsPs(`AgentVault ${job}`, execArgs, times[job], JOBS[job].desc);
      const r = run('powershell.exe', ['-NoProfile', '-Command', ps]);
      done.push({ job, ok: r.ok, where: `Task Scheduler: AgentVault ${job}`, error: r.stderr.trim() });
    }
  }
  if (OS === 'linux' && !isRoot()) {
    const r = run('loginctl', ['show-user', os.userInfo().username, '--property=Linger']);
    if (!/Linger=yes/.test(r.stdout)) done.push({ job: 'linger', ok: false, error: `user timers stop when you log out; run: sudo loginctl enable-linger ${os.userInfo().username}` });
  }
  return done;
}

export function remove() {
  const out = [];
  for (const job of Object.keys(JOBS)) {
    const name = `agentvault-${job}`;
    if (OS === 'linux') {
      const sc = isRoot() ? ['systemctl'] : ['systemctl', '--user'];
      run(sc[0], [...sc.slice(1), 'disable', '--now', `${name}.timer`]);
      for (const ext of ['service', 'timer']) { try { fs.unlinkSync(path.join(systemdDir(), `${name}.${ext}`)); out.push(`${name}.${ext}`); } catch { /* not installed */ } }
    } else if (OS === 'macos') {
      const file = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.agentvault.${job}.plist`);
      run('launchctl', ['unload', file]);
      try { fs.unlinkSync(file); out.push(file); } catch { /* not installed */ }
    } else {
      const r = run('powershell.exe', ['-NoProfile', '-Command', `Unregister-ScheduledTask -TaskName 'AgentVault ${job}' -Confirm:$false -ErrorAction SilentlyContinue`]);
      if (r.ok) out.push(`AgentVault ${job}`);
    }
  }
  return out;
}

export function describe() {
  if (OS === 'linux') {
    const sc = isRoot() ? ['systemctl'] : ['systemctl', '--user'];
    return run(sc[0], [...sc.slice(1), 'list-timers', 'agentvault-*', '--all', '--no-pager']).stdout.trim();
  }
  if (OS === 'windows') {
    return run('powershell.exe', ['-NoProfile', '-Command', "Get-ScheduledTask -TaskName 'AgentVault*' -ErrorAction SilentlyContinue | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; '{0} | next {1} | last {2} (result {3})' -f $_.TaskName, $i.NextRunTime, $i.LastRunTime, $i.LastTaskResult }"]).stdout.trim();
  }
  return run('launchctl', ['list']).stdout.split('\n').filter((l) => l.includes('agentvault')).join('\n');
}
