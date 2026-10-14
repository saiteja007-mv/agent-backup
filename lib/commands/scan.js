// agent-backup scan: what this machine has that can be backed up. Read-only.
import path from 'node:path';
import { loadConfig } from '../config.js';
import { findBinary } from '../restic.js';
import { makeCtx, catalog, excludesOf } from '../components/index.js';
import { existingEntries } from '../components/common.js';
import { isRoot } from '../platform.js';
import { dirSize, fmtBytes, table } from '../util.js';

// Same exclude rules restic gets, for the size estimate: absolute paths, "*.ext" globs, or plain names.
export function skipper(excludes) {
  return (p) => {
    const base = path.basename(p);
    return excludes.some((ex) => {
      if (/[\\/]/.test(ex)) return p === ex || p.startsWith(ex + path.sep);
      if (ex.startsWith('*.')) return base.endsWith(ex.slice(1));
      return base === ex;
    });
  };
}

export default async function scan() {
  const cfg = loadConfig();
  const ctx = makeCtx(cfg);
  const disabled = new Set(cfg.components.disabled);
  console.log(`Scanning ${cfg.host} (${ctx.os}), home ${ctx.home}\n`);
  const rows = [];
  const missing = [];
  let total = 0;
  for (const c of catalog(ctx)) {
    let found = false;
    try { found = c.detect(ctx); } catch { /* treat as absent */ }
    if (!found) { missing.push(c.id); continue; }
    const skip = skipper(excludesOf(c, ctx));
    let bytes = 0; let files = 0; let partial = false;
    for (const e of existingEntries(c.entries, ctx)) {
      const s = dirSize(e.abs, skip, 8000);
      bytes += s.bytes; files += s.files; partial ||= s.partial;
    }
    total += bytes;
    const extra = c.info ? ` + ${c.info.volumes.length} volumes, ${c.info.dbs.length} databases` : '';
    const state = disabled.has(c.id) ? 'disabled' : c.needsRoot && !isRoot() ? 'needs root' : 'yes';
    rows.push([c.id, c.title, `${fmtBytes(bytes)}${partial ? '+' : ''}${extra}`, files, state]);
  }
  console.log(table(rows, ['component', 'what', 'size', 'files', 'backed up']));
  console.log(`\nAbout ${fmtBytes(total)} before compression and deduplication.`);
  if (missing.length) console.log(`Not on this machine: ${missing.join(', ')}`);
  const tools = ['restic', 'rclone', 'docker', 'sqlite3', 'tailscale'].map((t) => `${t} ${findBinary(t, cfg) ? 'found' : 'missing'}`);
  console.log(`Tools: ${tools.join(', ')}`);
  console.log(cfg._exists ? `\nEnrolled. Repository: ${cfg.repository}` : '\nNot enrolled yet. Next: agent-backup enroll');
  return 0;
}
