// agent-backup status: settings, last runs, latest snapshot per component, scheduled jobs.
import path from 'node:path';
import { loadConfig, slackWebhook } from '../config.js';
import { Restic, latestByComponent } from '../restic.js';
import { describe } from '../schedule.js';
import { readJson, fmtAge, table } from '../util.js';

const age = (t) => (t ? fmtAge(Date.now() - Date.parse(t)) : 'never');

export default async function status() {
  const cfg = loadConfig();
  if (!cfg._exists) {
    console.log('Not enrolled on this machine. Run "agent-backup scan", then "agent-backup enroll".');
    return 1;
  }
  const state = readJson(path.join(cfg._dir, 'state.json'), {}) || {};
  const r = cfg.retention;
  const lb = state.lastBackup;
  const st = state.lastSelftest;
  console.log(`machine      ${cfg.host} (${cfg.os})`);
  const label = { local: 'local folder', gdrive: 'Google Drive', both: 'local + copy', custom: 'restic repository' }[cfg.storage] || cfg.storage;
  console.log(`storage      ${label}: ${cfg.repository}`);
  if (cfg.copyTo) {
    const c = lb?.copied;
    console.log(`copy         ${cfg.copyTo}${c == null ? '' : c ? ' (last copy ok)' : ' (LAST COPY FAILED)'}`);
  }
  console.log(`schedule     daily at ${cfg.schedule.time}; keep ${r.daily} daily, ${r.weekly} weekly, ${r.monthly} monthly`);
  console.log(`slack        ${slackWebhook(cfg) ? 'on' : 'off (agent-backup slack set)'}`);
  console.log(`last backup  ${age(lb?.time)}${lb ? (lb.ok ? ', ok' : ', HAD PROBLEMS (see logs/backup-last.log)') : ''}`);
  console.log(`last test    ${age(st?.time)}${st ? (st.ok ? `, passed: ${st.detail}` : `, FAILED: ${st.detail}`) : ''}`);
  try {
    const latest = latestByComponent(new Restic(cfg).snapshots(['av:1']), cfg.host);
    const rows = [...latest].sort().map(([id, s]) => [id, age(s.time), s.time.slice(0, 16).replace('T', ' '), s.short_id]);
    console.log(`\n${rows.length ? table(rows, ['component', 'age', 'time', 'snapshot']) : 'No snapshots yet.'}`);
  } catch (e) {
    console.log(`\nCould not read the repository: ${e.message}`);
  }
  console.log(`\nScheduled jobs:\n${describe() || '  none installed (agent-backup schedule install)'}`);
  return 0;
}
