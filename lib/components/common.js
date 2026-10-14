// Helpers shared by component definitions.
import fs from 'node:fs';
import path from 'node:path';
import { run, mkdirp, exists, isLink } from '../util.js';
import { resolveEntry } from '../platform.js';
import { findBinary } from '../restic.js';

export const home = (rel) => ({ root: 'home', rel });
export const appdata = (rel) => ({ root: 'appdata', rel });
export const localappdata = (rel) => ({ root: 'localappdata', rel });
export const hermes = (rel = '') => ({ root: 'hermes', rel });
export const abs = (p) => ({ root: 'abs', rel: p });

// Directory or file names skipped everywhere: reinstallable or regenerated.
export const JUNK = ['node_modules', '__pycache__', '.venv', 'venv', '.cache', '.pytest_cache', '.mypy_cache', '*.tmp', '*.lock'];

export function existingEntries(entries, ctx) {
  return entries.map((e) => ({ ...e, abs: resolveEntry(e, ctx) })).filter((e) => exists(e.abs));
}

// Absolute excludes under a resolved entry.
export function under(base, rels) { return rels.map((r) => path.join(base, ...r.split('/'))); }

// Children of a folder that are symlinks or junctions (e.g. skills linked from a shared hub).
export function linkedChildren(dir) {
  try { return fs.readdirSync(dir).map((n) => path.join(dir, n)).filter(isLink); } catch { return []; }
}

// Consistent copies of SQLite databases (live files can be mid-write). Needs the sqlite3 CLI;
// without it the live files are still in the snapshot, just not guaranteed consistent.
export function sqliteCopies(rootDir, stagingDir, { maxDepth = 4, skip = () => false } = {}) {
  const sqlite = findBinary('sqlite3');
  const notes = [];
  if (!sqlite) return { copied: 0, notes: ['sqlite3 not installed: databases copied live'] };
  let copied = 0;
  const walk = (dir, depth) => {
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (skip(p)) continue;
      if (it.isDirectory() && depth < maxDepth) walk(p, depth + 1);
      else if (it.isFile() && /\.(db|sqlite|sqlite3)$/i.test(it.name)) {
        const rel = path.relative(rootDir, p);
        const dst = path.join(stagingDir, 'sqlite', rel);
        mkdirp(path.dirname(dst));
        const r = run(sqlite, [p, `.backup '${dst.replace(/'/g, "''")}'`]);
        if (r.ok) copied++; else notes.push(`sqlite backup failed for ${rel}: ${r.stderr.trim().slice(0, 120)}`);
      }
    }
  };
  walk(rootDir, 0);
  return { copied, notes };
}
