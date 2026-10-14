// agent-backup selftest: restore one component (random, or --component) into a temp folder,
// verify the contents and the file count, then delete it. Runs monthly when scheduled.
// With a copy destination it tests the copy by default: that is the one you need when the disk dies.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { Restic, latestByComponent } from '../restic.js';
import { slack } from '../notify.js';
import { updateState } from './backup.js';
import { mkdirp, stamp, dirSize } from '../util.js';

export default async function selftest(o) {
  const cfg = loadConfig({ required: true });
  const src = o.source ? String(o.source) : cfg.copyTo ? 'copy' : 'local';
  if (!['local', 'copy', 'drive'].includes(src)) throw new Error('--source must be local or copy (drive)');
  const repo = src === 'local' ? cfg.repository : cfg.copyTo;
  if (!repo) throw new Error('this machine has no copy destination');
  const restic = new Restic({ ...cfg, repository: repo });
  const latest = latestByComponent(restic.snapshots(['av:1']), cfg.host);
  if (!latest.size) throw new Error(`nothing backed up yet in ${repo}`);
  const ids = [...latest.keys()];
  const id = o.component ? String(o.component) : ids[Math.floor(Math.random() * ids.length)];
  const snap = latest.get(id);
  if (!snap) throw new Error(`no backup of ${id} on ${cfg.host}`);
  const tmp = path.join(cfg._dir, 'tmp', `selftest-${stamp()}`);
  mkdirp(tmp, 0o700);
  let ok = false;
  let detail = '';
  try {
    console.log(`Test-restoring ${id} from ${snap.time.slice(0, 16)} (${snap.short_id}) out of ${repo}...`);
    const r = restic.restore(snap.id, tmp, { verify: true });
    const expected = restic.ls(snap.id).filter((n) => n.type === 'file').length;
    const got = dirSize(tmp, () => false, 3600e3).files;
    ok = r.ok && got === expected;
    detail = `${id} from ${snap.time.slice(0, 10)} (${src === 'local' ? 'local backups' : 'copy'}): ${got}/${expected} files` +
      (r.ok ? ', contents verified' : `, restic: ${r.stderr.trim().split('\n').pop()}`);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* reported below */ }
  }
  console.log(ok ? `Passed: ${detail}` : `FAILED: ${detail}`);
  updateState(cfg, { lastSelftest: { time: new Date().toISOString(), ok, detail } });
  await slack(cfg, `${ok ? ':white_check_mark:' : ':x:'} agent-backup ${cfg.host}: test restore ${ok ? 'passed' : 'FAILED'} (${detail})`);
  return ok ? 0 : 1;
}
