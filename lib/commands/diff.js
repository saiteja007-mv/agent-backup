// agent-backup diff <component>: what changed between its last two backups on this machine.
import { loadConfig } from '../config.js';
import { Restic } from '../restic.js';

export default async function diff(o, pos) {
  const id = pos[0] || o.component;
  if (!id) throw new Error('usage: agent-backup diff <component>');
  const cfg = loadConfig({ required: true });
  const restic = new Restic(cfg);
  const snaps = restic.snapshots([`component:${id}`])
    .filter((s) => s.hostname === cfg.host)
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (snaps.length < 2) { console.log(`${snaps.length} backup(s) of ${id} so far: nothing to compare yet.`); return 0; }
  const [a, b] = snaps.slice(-2);
  console.log(`${id}: ${a.time.slice(0, 16)} -> ${b.time.slice(0, 16)}\n`);
  const r = restic.diff(a.id, b.id);
  console.log((r.stdout || r.stderr).trim());
  return r.ok ? 0 : 1;
}
