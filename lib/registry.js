// Fleet registry: one small JSON per enrolled machine, stored next to the repositories.
// Location is either "rclone:<remote>:<path>" or a plain local folder.
import fs from 'node:fs';
import path from 'node:path';
import { run, readJson, writeJson, mkdirp } from './util.js';
import { findBinary } from './restic.js';

function parse(loc) {
  if (String(loc).startsWith('rclone:')) return { kind: 'rclone', target: loc.slice('rclone:'.length) };
  return { kind: 'local', target: loc };
}

export function writeEntry(cfg, entry) {
  const loc = parse(cfg.registry);
  const body = JSON.stringify(entry, null, 2) + '\n';
  if (loc.kind === 'local') {
    mkdirp(loc.target);
    writeJson(path.join(loc.target, `${entry.host}.json`), entry);
    return { ok: true };
  }
  const rclone = findBinary('rclone', cfg);
  if (!rclone) return { ok: false, error: 'rclone not installed' };
  const r = run(rclone, ['rcat', `${loc.target}/${entry.host}.json`], { input: body });
  return { ok: r.ok, error: r.stderr.trim() };
}

export function readAll(cfg) {
  const loc = parse(cfg.registry);
  if (loc.kind === 'local') {
    if (!fs.existsSync(loc.target)) return [];
    return fs.readdirSync(loc.target).filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(loc.target, f))).filter(Boolean);
  }
  const rclone = findBinary('rclone', cfg);
  if (!rclone) return [];
  const ls = run(rclone, ['lsjson', loc.target]);
  if (!ls.ok) return [];
  let files = [];
  try { files = JSON.parse(ls.stdout); } catch { return []; }
  return files.filter((f) => !f.IsDir && f.Name.endsWith('.json')).map((f) => {
    const r = run(rclone, ['cat', `${loc.target}/${f.Name}`]);
    try { return JSON.parse(r.stdout); } catch { return null; }
  }).filter(Boolean);
}
