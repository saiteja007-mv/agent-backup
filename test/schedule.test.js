import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSystemd, renderLaunchd, renderWindowsPs, jobTimes } from '../lib/schedule.js';

const cfg = { schedule: { time: '03:30' } };

test('jobTimes: nightly backup, monthly test an hour later, watchdog at 08:00', () => {
  const t = jobTimes(cfg);
  assert.deepEqual(t.backup, { daily: true, hour: 3, minute: 30 });
  assert.deepEqual(t.selftest, { monthDay: 1, hour: 4, minute: 30 });
  assert.deepEqual(t.watchdog, { daily: true, hour: 8, minute: 0 });
});

test('systemd units: daily and monthly calendars, catch up after downtime', () => {
  const t = jobTimes(cfg);
  const d = renderSystemd('agentvault-backup', ['/usr/bin/node', '/x/agentvault.js', 'backup', '--scheduled'], t.backup, 'nightly');
  assert.match(d.timer, /OnCalendar=\*-\*-\* 03:30:00/);
  assert.match(d.timer, /Persistent=true/);
  assert.match(d.service, /ExecStart=\/usr\/bin\/node \/x\/agentvault\.js backup --scheduled/);
  const m = renderSystemd('agentvault-selftest', ['node', 'a.js', 'selftest'], t.selftest, 'monthly');
  assert.match(m.timer, /OnCalendar=\*-\*-01 04:30:00/);
});

test('systemd quotes arguments with spaces', () => {
  const d = renderSystemd('x', ['/opt/my node/node', 'a.js'], { daily: true, hour: 1, minute: 0 }, 'd');
  assert.match(d.service, /ExecStart="\/opt\/my node\/node" a\.js/);
});

test('launchd plist carries the calendar and arguments', () => {
  const p = renderLaunchd('com.agentvault.backup', ['/usr/local/bin/node', 'a.js', 'backup'], { daily: true, hour: 3, minute: 0 });
  assert.match(p, /<key>Hour<\/key><integer>3<\/integer>/);
  assert.match(p, /<string>backup<\/string>/);
});

test('Windows task: daily trigger, catch-up, quoted paths', () => {
  const ps = renderWindowsPs('AgentVault backup', ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\a\\av\\agentvault.js', 'backup'], { daily: true, hour: 3, minute: 30 }, 'nightly');
  assert.match(ps, /-Execute 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(ps, /-Daily -At '03:30'/);
  assert.match(ps, /-StartWhenAvailable/);
  const m = renderWindowsPs('AgentVault selftest', ['node.exe', 'a.js', 'selftest'], { monthDay: 1, hour: 4, minute: 30 }, 'monthly');
  assert.match(m, /-Weekly -WeeksInterval 4/);
});
