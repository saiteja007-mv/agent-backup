// agentvault selftest: restore one component (random, or --component) into a temp folder,
// verify the contents and the file count, then delete it. Runs monthly when scheduled.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { Restic, latestByComponent } from '../restic.js';
import { slack } from '../notify.js';
import { updateState } from './backup.js';
import { mkdirp, stamp, dirSize } from '../util.js';

export default async function selftest(o) {
  const cfg = loadConfig({ required: true });
  const restic = new Restic(cfg);
  const latest = latestByComponent(restic.snapshots(['av:1']), cfg.host);
  if (!latest.size) throw new Error('nothing has been backed up yet');
  const ids = [...latest.keys()];
  const id = o.component ? String(o.component) : ids[Math.floor(Math.random() * ids.length)];
  const snap = latest.get(id);
  if (!snap) throw new Error(`no backup of ${id} on ${cfg.host}`);
  const tmp = path.join(cfg._dir, 'tmp', `selftest-${stamp()}`);
  mkdirp(tmp, 0o700);
  let ok = false;
  let detail = '';
  try {
    console.log(`Test-restoring ${id} from ${snap.time.slice(0, 16)} (${snap.short_id})...`);
    const r = restic.restore(snap.id, tmp, { verify: true });
    const expected = restic.ls(snap.id).filter((n) => n.type === 'file').length;
    const got = dirSize(tmp, () => false, 3600e3).files;
    ok = r.ok && got === expected;
    detail = `${id} from ${snap.time.slice(0, 10)}: ${got}/${expected} files` +
      (r.ok ? ', contents verified' : `, restic: ${r.stderr.trim().split('\n').pop()}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(ok ? `Passed: ${detail}` : `FAILED: ${detail}`);
  updateState(cfg, { lastSelftest: { time: new Date().toISOString(), ok, detail } });
  await slack(cfg, `${ok ? ':white_check_mark:' : ':x:'} agentvault ${cfg.host}: test restore ${ok ? 'passed' : 'FAILED'} (${detail})`);
  return ok ? 0 : 1;
}
