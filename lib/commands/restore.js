// agentvault restore: machine -> components -> date -> mode.
//   dry-run   shows what would be restored and where (touches nothing)
//   scratch   restores into a separate folder to look at (touches nothing live)
//   in-place  puts files back; every file it overwrites is copied aside first
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, hasPassword } from '../config.js';
import { Restic, latestByComponent } from '../restic.js';
import { readAll } from '../registry.js';
import { makeCtx, forRestore } from '../components/index.js';
import { resolveEntry, snapshotPath, normHost, isRoot } from '../platform.js';
import { overlay, newStats } from '../overlay.js';
import { META, writeLog } from './backup.js';
import { ask, choose, mkdirp, stamp, table, fmtAge, exists } from '../util.js';
import { list } from '../args.js';

const MODES = [
  { key: 'dry-run', label: 'dry-run: show what would be restored and where' },
  { key: 'scratch', label: 'scratch: restore into a separate folder to look at' },
  { key: 'in-place', label: 'in-place: put the files back where they belong' },
];

const isWinPath = (p) => /^[A-Za-z]:[\\/]/.test(p);
const snapPath = (abs) => snapshotPath(abs, isWinPath(abs) ? 'windows' : 'linux');

// Where a path from the snapshot lands inside a restic restore target.
export function landed(target, abs) {
  return path.join(target, ...snapPath(abs).split('/').filter(Boolean));
}

// Where each backed-up path goes on this machine. Machine-specific components only restore in place on the same OS.
export function targetsFor(meta, ctx) {
  const portable = meta.crossOS || meta.os === ctx.os;
  return meta.entries.map((e) => ({ ...e, target: portable ? (e.root === 'abs' ? e.rel : resolveEntry(e, ctx)) : null }));
}

function stagingOf(snap, id) {
  return (snap.paths || []).find((p) => { const s = p.split(/[\\/]/); return s[s.length - 1] === id && s[s.length - 2] === 'staging'; });
}

function readMeta(restic, snap, id) {
  const st = stagingOf(snap, id);
  if (!st) throw new Error(`snapshot ${snap.short_id} has no agentvault metadata`);
  const r = restic.exec(['dump', snap.id, `${snapPath(st)}/${META}`]);
  if (!r.ok) throw new Error(`could not read metadata from ${snap.short_id}: ${r.stderr.trim().split('\n').pop()}`);
  return { ...JSON.parse(r.stdout), _staging: st };
}

// Repositories to try, in order. This machine: local backups first, then the copy.
// Another machine: its off-site (rclone) repositories first, since its local folder is usually elsewhere.
export function repoCandidates(cfg, host, fleet, o) {
  if (o.repo) return [String(o.repo)];
  let primary = cfg.repository;
  let copy = cfg.copyTo || null;
  if (host !== cfg.host) {
    const e = fleet.find((f) => f.host === host);
    // Same layout for every machine: <root>/<machine>. Swap our name for theirs.
    const guess = (r) => {
      const m = /^(.*[\\/])([^\\/]+)$/.exec(String(r || ''));
      return m && m[2] === cfg.host ? m[1] + host : null;
    };
    primary = e ? e.repository : guess(cfg.repository);
    copy = e ? e.copyTo || null : guess(cfg.copyTo);
  }
  const src = o.source ? String(o.source) : null;
  if (src && !['local', 'copy', 'drive'].includes(src)) throw new Error('--source must be local or copy (drive)');
  if (src === 'local') return [primary].filter(Boolean);
  if (src) { if (!copy) throw new Error(`${host} has no copy destination`); return [copy]; }
  const list = [primary, copy].filter(Boolean);
  if (host !== cfg.host) list.sort((a, b) => Number(String(b).startsWith('rclone:')) - Number(String(a).startsWith('rclone:')));
  if (!list.length) throw new Error(`no repository known for ${host}: pass --repo`);
  return list;
}

// Open the first repository that works; say so when falling back.
export function openFirst(cfg, repos) {
  const errors = [];
  for (const repo of repos) {
    try {
      const rs = new Restic({ ...cfg, repository: repo });
      const snaps = rs.snapshots(['av:1']);
      if (errors.length) console.log(`Could not open ${errors.map((e) => e.repo).join(', ')}; using ${repo}.`);
      return { restic: rs, snaps, repo };
    } catch (e) {
      errors.push({ repo, msg: e.message });
    }
  }
  throw new Error(`could not open the backups:\n  ${errors.map((e) => `${e.repo}: ${e.msg}`).join('\n  ')}`);
}

function pickSnapshot(snaps, host, id, o) {
  const mine = snaps
    .filter((s) => s.hostname === host && (s.tags || []).includes(`component:${id}`))
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  if (o.snapshot) return mine.find((s) => s.id.startsWith(String(o.snapshot)));
  if (o.date) {
    const end = Date.parse(`${o.date}T23:59:59`);
    if (Number.isNaN(end)) throw new Error('--date must look like 2026-10-13');
    return mine.find((s) => Date.parse(s.time) <= end);
  }
  return mine[0];
}

async function pickMany(title, items, fmt) {
  console.log(`\n${title}`);
  items.forEach((it, i) => console.log(`  ${String(i + 1).padStart(2)}. ${fmt(it)}`));
  for (;;) {
    const a = (await ask('Numbers (e.g. 1,3) or "all": ')).toLowerCase();
    if (a === 'all') return items;
    const nums = a.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.length && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= items.length)) return [...new Set(nums)].map((n) => items[n - 1]);
  }
}

const componentOf = (s) => (s.tags || []).find((t) => t.startsWith('component:')).slice('component:'.length);

export default async function restore(o) {
  const cfg = loadConfig({ required: true });
  if (!hasPassword(cfg)) throw new Error(`no backup password at ${cfg.passwordFile}. Run "agentvault enroll --apply" first.`);
  const tty = Boolean(process.stdin.isTTY);
  const ctx = makeCtx(cfg);
  let fleet = [];
  try { fleet = readAll(cfg); } catch { /* registry unreachable: this host only */ }

  let host = o.from ? normHost(o.from) : cfg.host;
  if (!o.from && !o.component && tty) {
    const hosts = [...new Set([cfg.host, ...fleet.map((f) => f.host)])];
    if (hosts.length > 1) host = await choose('Restore from which machine?', hosts, (h) => (h === cfg.host ? `${h} (this machine)` : h));
  }
  const { restic, snaps, repo } = openFirst(cfg, repoCandidates(cfg, host, fleet, o));
  console.log(`Reading backups from ${repo}`);
  const latest = latestByComponent(snaps, host);
  if (!latest.size) throw new Error(`no backups found for ${host}`);

  let ids = list(o.component);
  if (ids.includes('all')) ids = [...latest.keys()];
  if (!ids.length) {
    if (!tty) throw new Error('say what to restore: --component <id>[,<id>] or --component all');
    const picked = await pickMany('What do you want to restore?', [...latest.values()],
      (s) => `${componentOf(s).padEnd(22)} last backup ${fmtAge(Date.now() - Date.parse(s.time))}`);
    ids = picked.map(componentOf);
  }
  if (tty && !o.date && !o.snapshot && !o.component) {
    const d = await ask('Which date? Enter for the latest, or YYYY-MM-DD: ');
    if (d) o = { ...o, date: d };
  }
  let mode = o.mode ? String(o.mode) : o['dry-run'] ? 'dry-run' : null;
  if (!mode) mode = tty ? (await choose('How?', MODES, (m) => m.label)).key : 'dry-run';
  if (!MODES.some((m) => m.key === mode)) throw new Error(`--mode must be one of: ${MODES.map((m) => m.key).join(', ')}`);

  const items = ids.map((id) => {
    const snap = pickSnapshot(snaps, host, id, o);
    if (!snap) throw new Error(`no backup of ${id} on ${host}${o.date ? ` on or before ${o.date}` : ''}`);
    const meta = readMeta(restic, snap, id);
    const comp = forRestore(ctx, meta);
    const xlate = meta.crossOS && (meta.os !== ctx.os || meta.home !== ctx.home)
      ? { from: { os: meta.os, home: meta.home }, to: { os: ctx.os, home: ctx.home } } : null;
    return { id, snap, meta, comp, xlate, targets: targetsFor(meta, ctx) };
  });

  const rows = items.flatMap((it) => it.targets.map((t) => [
    it.id, `${it.snap.time.slice(0, 16).replace('T', ' ')} (${it.snap.short_id})`, t.abs,
    t.target ? `${t.target}${exists(t.target) ? '' : ' (new)'}` : '(other OS: scratch only)',
  ]));
  console.log(`\nFrom ${host}, mode ${mode}:\n${table(rows, ['component', 'backup', 'backed up from', 'restores to'])}`);
  for (const it of items) if (it.xlate) console.log(`${it.id}: paths inside text configs will be rewritten from ${it.meta.home} (${it.meta.os}) to ${ctx.home} (${ctx.os}).`);
  const includes = list(o.include);

  if (mode === 'dry-run') {
    for (const it of items) {
      const files = restic.ls(it.snap.id).filter((n) => n.type === 'file');
      for (const t of it.targets) {
        const sp = snapPath(t.abs);
        const n = files.filter((f) => f.path === sp || f.path.startsWith(`${sp}/`)).length;
        console.log(`  ${it.id}: ${n} files from ${t.abs}`);
      }
    }
    console.log('\nNothing was changed. Use --mode scratch to look at the files, or --mode in-place to put them back.');
    return 0;
  }

  if (mode === 'scratch') {
    const target = path.resolve(String(o.target || `agentvault-restore-${host}-${stamp()}`));
    for (const it of items) {
      const r = restic.restore(it.snap.id, target, { includes: includes.length ? [...includes, snapPath(it.meta._staging)] : [] });
      if (!r.ok) console.log(`${it.id}: restic reported problems: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
      console.log(`\n${it.id}:`);
      for (const t of it.targets) console.log(`  ${t.abs}\n    -> ${landed(target, t.abs)}`);
      console.log(`  extras (package lists, dumps, metadata) -> ${landed(target, it.meta._staging)}`);
    }
    console.log(`\nRestored into ${target}. Nothing live was touched. It may hold secrets; delete it when done.`);
    return 0;
  }

  // in-place
  const blocked = items.filter((it) => it.targets.some((t) => !t.target) || (it.comp.needsRoot && !isRoot()));
  if (blocked.length) {
    throw new Error(`cannot restore in place: ${blocked.map((it) => it.id).join(', ')} ` +
      '(machine-specific backups only go back onto the same OS, and services need root). Use --mode scratch.');
  }
  if (!o.yes) {
    if (!tty) throw new Error('in-place restore needs --yes when not run interactively');
    if ((await ask('\nType "yes" to put these files back: ')) !== 'yes') { console.log('Cancelled.'); return 1; }
  }
  const runStamp = stamp();
  const safetyRoot = path.join(cfg._dir, 'before-restore', runStamp);
  const log = [];
  let ok = true;
  for (const it of items) {
    const tmp = path.join(cfg._dir, 'tmp', `r-${runStamp}-${it.id}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    mkdirp(tmp, 0o700);
    try {
      const r = restic.restore(it.snap.id, tmp, { includes: includes.length ? [...includes, snapPath(it.meta._staging)] : [] });
      const notes = r.ok ? [] : [`restic reported problems: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`];
      if (it.comp.beforeRestore) notes.push(...(await it.comp.beforeRestore(ctx)));
      const stats = newStats();
      for (const t of it.targets) {
        const src = landed(tmp, t.abs);
        if (exists(src)) overlay(src, t.target, { safetyRoot, xlate: it.xlate, stats, chown: isRoot() });
      }
      const stg = landed(tmp, it.meta._staging);
      if (it.comp.restoreData) notes.push(...(await it.comp.restoreData(ctx, stg, it.meta)));
      if (it.comp.afterRestore) notes.push(...(await it.comp.afterRestore(ctx)));
      if (['system', 'command'].includes(it.meta.kind)) {
        const keep = path.join(cfg._dir, 'restored', `${host}-${it.id}-${runStamp}`);
        fs.cpSync(stg, keep, { recursive: true });
        notes.push(`package lists / command output kept in ${keep}`);
      }
      if (stats.failed.length) ok = false;
      const lines = [
        `${it.id}: ${stats.written} files written, ${stats.unchanged} already identical, ${stats.saved} previous versions saved` +
          `${stats.rewrites ? `, ${stats.rewrites} paths rewritten` : ''}${stats.skippedLinks ? `, ${stats.skippedLinks} links left alone` : ''}`,
        ...notes.map((n) => `  - ${n}`),
        ...stats.failed.map((f) => `  ! ${f}`),
        ...(it.comp.restoreNotes || []).map((n) => `  next: ${n}`),
      ];
      if (stats.attention.length) {
        lines.push(`  These lines may only work on ${it.meta.os}; check them by hand:`);
        for (const a of stats.attention.slice(0, 40)) lines.push(`    ${a.file}:${a.line}  ${a.text}`);
        if (stats.attention.length > 40) lines.push(`    ...and ${stats.attention.length - 40} more (logs/restore-last.log)`);
      }
      console.log(`\n${lines.join('\n')}`);
      log.push(...lines, ...stats.attention.slice(40).map((a) => `    ${a.file}:${a.line}  ${a.text}`));
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.log(`  could not delete temp folder ${tmp} (${e.code}); delete it by hand, it may hold secrets`); }
    }
  }
  if (exists(safetyRoot)) console.log(`\nPrevious versions of overwritten files: ${safetyRoot}`);
  writeLog(cfg, 'restore', log.join('\n'));
  return ok ? 0 : 1;
}
