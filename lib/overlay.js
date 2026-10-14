// Put restored files back over a live folder. Every file about to be overwritten is copied aside
// first. Files that exist only in the live folder are left alone (overlay, not mirror), so caches
// and anything excluded from the backup survive a restore.
import fs from 'node:fs';
import path from 'node:path';
import { translateText, TEXT_EXT } from './xos.js';
import { snapshotPath } from './platform.js';
import { mkdirp } from './util.js';

const MAX_TEXT = 5 * 1024 * 1024;

export function newStats() {
  return { written: 0, unchanged: 0, saved: 0, links: 0, skippedLinks: 0, rewrites: 0, attention: [], failed: [] };
}

function isText(file, size) {
  const n = path.basename(file);
  return size <= MAX_TEXT && (TEXT_EXT.has(path.extname(n).toLowerCase()) || TEXT_EXT.has(n));
}

function lstat(p) { try { return fs.lstatSync(p); } catch { return null; } }

function saveAside(dst, safetyRoot, stats) {
  const aside = path.join(safetyRoot, ...snapshotPath(dst).split('/').filter(Boolean));
  try {
    mkdirp(path.dirname(aside));
    fs.cpSync(dst, aside, { recursive: true, dereference: true });
    stats.saved++;
    return true;
  } catch (e) {
    stats.failed.push(`${dst}: could not save the current copy first (${e.code || e.message}); left as is`);
    return false;
  }
}

function sameContent(dst, src, st, data) {
  let d; try { d = fs.statSync(dst); } catch { return false; }
  if (!d.isFile()) return false;
  if (data != null) { const b = Buffer.from(data); return d.size === b.length && fs.readFileSync(dst).equals(b); }
  if (d.size !== st.size) return false;
  // ponytail: big files compare by size + mtime; byte compare if that ever proves too loose
  if (st.size > MAX_TEXT) return Math.floor(d.mtimeMs / 1000) === Math.floor(st.mtimeMs / 1000);
  return fs.readFileSync(dst).equals(fs.readFileSync(src));
}

// opts: { safetyRoot, xlate: {from:{os,home}, to:{os,home}} | null, stats, chown }
export function overlay(src, dst, opts) {
  const { safetyRoot, xlate, stats, chown } = opts;
  const st = lstat(src);
  if (!st) return;
  const own = (p) => { if (chown) { try { fs.lchownSync(p, st.uid, st.gid); } catch { /* best effort */ } } };
  const d = lstat(dst);

  if (st.isSymbolicLink()) {
    if (d) return;
    try { mkdirp(path.dirname(dst)); fs.symlinkSync(fs.readlinkSync(src), dst); own(dst); stats.links++; } catch { stats.skippedLinks++; }
    return;
  }

  if (st.isDirectory()) {
    if (d?.isSymbolicLink()) { stats.skippedLinks++; return; } // a linked folder (e.g. a shared skills hub): leave it
    if (d && !d.isDirectory()) {
      if (!saveAside(dst, safetyRoot, stats)) return;
      fs.rmSync(dst, { force: true });
    }
    if (!d || !d.isDirectory()) {
      mkdirp(dst);
      try { fs.chmodSync(dst, st.mode & 0o7777); } catch { /* Windows */ }
      own(dst);
    }
    for (const n of fs.readdirSync(src)) overlay(path.join(src, n), path.join(dst, n), opts);
    return;
  }

  let data = null;
  if (xlate && isText(src, st.size)) {
    const raw = fs.readFileSync(src);
    if (!raw.subarray(0, 8192).includes(0)) {
      const t = translateText(raw.toString('utf8'), xlate.from, xlate.to);
      if (t.changes) { data = t.text; stats.rewrites += t.changes; }
      for (const a of t.attention) stats.attention.push({ file: dst, ...a });
    }
  }

  if (d) {
    if (sameContent(dst, src, st, data)) { stats.unchanged++; return; }
    if (!saveAside(dst, safetyRoot, stats)) return;
    if (d.isDirectory()) fs.rmSync(dst, { recursive: true, force: true });
    // a symlinked file is written through, so dotfile-manager links keep working
  } else {
    mkdirp(path.dirname(dst));
  }
  if (data != null) fs.writeFileSync(dst, data, { mode: st.mode & 0o777 });
  else fs.copyFileSync(src, dst);
  try { fs.utimesSync(dst, st.atime, st.mtime); } catch { /* best effort */ }
  own(dst);
  stats.written++;
}
