// agent-backup backup: one restic snapshot per component, then retention, fleet registry and Slack.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, hasPassword, DEFAULT_REMOTE } from '../config.js';
import { Progress, fmtDur } from '../progress.js';
import { Restic } from '../restic.js';
import { makeCtx, active, excludesOf } from '../components/index.js';
import { existingEntries } from '../components/common.js';
import { acquire } from '../lock.js';
import { writeEntry } from '../registry.js';
import { slack } from '../notify.js';
import { mkdirp, writeJson, readJson, fmtBytes, table } from '../util.js';
import { OS, isRoot } from '../platform.js';
import { VERSION } from '../app.js';
import { list } from '../args.js';

export const META = '_agent-backup.json';

export function updateState(cfg, patch) {
  const file = path.join(cfg._dir, 'state.json');
  writeJson(file, { ...(readJson(file, {}) || {}), ...patch });
}

export function writeLog(cfg, name, text) {
  const dir = mkdirp(path.join(cfg._dir, 'logs'));
  fs.writeFileSync(path.join(dir, `${name}-last.log`), `${new Date().toISOString()}\n${text}\n`);
}

async function backupOne(c, ctx, restic, progress) {
  const { cfg } = ctx;
  const notes = [];
  if (c.needsRoot && !isRoot()) return { id: c.id, ok: false, notes: ['needs root: run this machine\'s backup as root (sudo)'] };
  // Staging holds dumps and the metadata file; it can contain secrets, so it is private and deleted after.
  const staging = path.join(cfg._dir, 'staging', c.id);
  fs.rmSync(staging, { recursive: true, force: true });
  mkdirp(staging, 0o700);
  const entries = existingEntries(c.entries, ctx);
  writeJson(path.join(staging, META), {
    version: VERSION, id: c.id, title: c.title, kind: c.kind, crossOS: Boolean(c.crossOS),
    host: cfg.host, os: OS, home: ctx.home, // no timestamp: restic has it, and diffs stay quiet
    entries: entries.map(({ root, rel, abs }) => ({ root, rel, abs })), info: c.info || null,
  });
  let pre = null;
  try {
    if (c.pre) {
      progress.phase('preparing (database copies, dumps, package lists)');
      pre = await c.pre(ctx, staging);
      notes.push(...(pre?.notes || []));
    }
    progress.phase('backing up');
    const r = await restic.backup([...entries.map((e) => e.abs), staging], {
      tags: ['av:1', `component:${c.id}`], host: cfg.host, excludes: excludesOf(c, ctx),
      onStatus: (m) => progress.update(m),
    });
    if (r.errors.length) notes.push(...r.errors.slice(0, 5).map((e) => `unreadable: ${e}`));
    if (!r.ok) notes.push(`restic failed: ${r.stderr.trim().split('\n').slice(-2).join(' | ')}`);
    const s = r.summary || {};
    return {
      id: c.id, ok: r.ok && pre?.ok !== false, snapshot: s.snapshot_id?.slice(0, 8),
      files: s.total_files_processed, bytes: s.total_bytes_processed, added: s.data_added, notes,
    };
  } catch (e) {
    notes.push(String(e.message || e));
    return { id: c.id, ok: false, notes };
  } finally {
    if (c.post) { try { notes.push(...(await c.post(ctx, pre))); } catch (e) { notes.push(`after-backup step failed: ${e.message}`); } }
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export default async function backup(o) {
  const cfg = loadConfig({ required: true });
  if (!hasPassword(cfg)) throw new Error(`no backup password at ${cfg.passwordFile}. Run "agent-backup enroll --apply".`);
  const ctx = makeCtx(cfg);
  const comps = active(ctx, list(o.only));
  if (o['dry-run']) {
    for (const c of comps) {
      console.log(`${c.id}  (${c.title})`);
      for (const e of existingEntries(c.entries, ctx)) console.log(`    ${e.abs}`);
    }
    return 0;
  }
  const restic = new Restic(cfg);
  const release = acquire(cfg._dir);
  const started = Date.now();
  const results = [];
  const maint = [];
  let copied = null; // null: no copy target
  const where = (r) => (String(r).startsWith(`rclone:${DEFAULT_REMOTE}:`) ? 'Google Drive' : r);
  console.log(`Backing up ${comps.length} components to ${where(cfg.repository)}${cfg.copyTo ? `, then copying to ${where(cfg.copyTo)}` : ''}.\n`);
  const progress = new Progress(cfg, comps.length);
  const took = (t) => fmtDur((Date.now() - t) / 1000);
  try {
    for (const [i, c] of comps.entries()) {
      const t = Date.now();
      progress.begin(i + 1, c.id);
      const r = await backupOne(c, ctx, restic, progress);
      progress.say(r.ok
        ? `- ${c.id}: ok, ${(r.files || 0).toLocaleString('en-US')} files (${fmtBytes(r.bytes || 0)}), ${fmtBytes(r.added || 0)} new, ${took(t)}`
        : `- ${c.id}: FAILED: ${(r.notes || []).slice(-1)[0] || 'see the report below'}`);
      results.push(r);
    }
    progress.begin(0, 'final steps');
    // Copy new snapshots to the second destination before retention runs, so nothing is dropped uncopied.
    if (cfg.copyTo) {
      const t = Date.now();
      progress.phase(`copying new snapshots to ${where(cfg.copyTo)}`);
      const cp = await restic.withRepo(cfg.copyTo).copyFrom(cfg.repository);
      copied = cp.ok;
      progress.say(`- copy to ${where(cfg.copyTo)}: ${cp.ok ? 'ok' : 'FAILED'}, ${took(t)}`);
      if (!cp.ok) maint.push(`copy to ${cfg.copyTo} FAILED: ${cp.stderr.trim().split('\n').pop()}`);
    }
    // Nightly: drop snapshots past retention. Sundays (or --prune): free the space and spot-check 5% of the data.
    const prune = Boolean(o.prune) || new Date().getDay() === 0;
    const repos = [[restic, 'backups'], ...(cfg.copyTo && copied ? [[restic.withRepo(cfg.copyTo), 'copy']] : [])];
    for (const [rs, name] of repos) {
      progress.phase(`${name}: removing snapshots past retention${prune ? ' and freeing space' : ''}`);
      const f = await rs.forget(cfg.retention, { prune });
      if (!f.ok) maint.push(`${name}: retention failed: ${f.stderr.trim().split('\n').pop()}`);
      if (prune) {
        progress.phase(`${name}: checking 5% of the stored data`);
        const ch = await rs.check('5%');
        if (!ch.ok) maint.push(`${name}: repository check FAILED: ${ch.stderr.trim().split('\n').pop()}`);
      }
    }
  } finally {
    release();
    progress.end();
  }

  const ok = results.length > 0 && results.every((r) => r.ok) && !maint.length;
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  const added = results.reduce((a, r) => a + (r.added || 0), 0);
  const report = [
    table(results.map((r) => [r.id, r.ok ? 'ok' : 'FAILED', r.files ?? '', fmtBytes(r.added || 0), r.snapshot || '',
      (r.notes || []).join('; ').slice(0, 140)]), ['component', 'result', 'files', 'new data', 'snapshot', 'notes']),
    ...maint,
  ].join('\n');
  console.log(`\n${report}\n\n${ok ? 'Backup finished' : 'Backup finished with problems'} in ${mins} min.`);
  fs.appendFileSync(progress.log, `\n${report}\n`);
  const time = new Date().toISOString();
  updateState(cfg, { lastBackup: { time, ok, results, maintenance: maint, copied } });

  const reg = writeEntry(cfg, {
    host: cfg.host, os: OS, version: VERSION, storage: cfg.storage, repository: cfg.repository,
    copyTo: cfg.copyTo || null, copyOk: copied, time, ok,
    staleHours: cfg.schedule.staleHours,
    components: Object.fromEntries(results.map((r) => [r.id, { ok: r.ok, snapshot: r.snapshot || null }])),
  });
  if (!reg.ok) console.log(`Fleet list not updated: ${reg.error}`);

  const failed = results.filter((r) => !r.ok);
  await slack(cfg, ok
    ? `:white_check_mark: agent-backup ${cfg.host}: backup ok, ${results.length} components, ${fmtBytes(added)} new, ${mins} min`
    : `:x: agent-backup ${cfg.host}: backup had problems\n${[
      ...failed.map((r) => `• ${r.id}: ${(r.notes || []).slice(-1)[0] || 'failed'}`),
      ...maint.map((m) => `• ${m}`),
    ].join('\n')}`);
  return ok ? 0 : 1;
}
