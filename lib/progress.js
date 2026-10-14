// Live progress of a backup run, so it never looks stuck:
//   terminal  one line, rewritten about once a second
//   log       a line every 30 s in logs/backup-last.log (nightly runs have no terminal)
//   status    progress.json, read by `agent-backup status` (and agents) while the run is going
import fs from 'node:fs';
import path from 'node:path';
import { fmtBytes, writeJson, mkdirp, readJson } from './util.js';

export function fmtDur(s) {
  if (s == null || !Number.isFinite(s)) return '';
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

const tail = (p) => String(p || '').split(/[\\/]/).filter(Boolean).slice(-2).join('/');

// One line describing where the run is. Pure, so status and tests use the same text.
export function statusLine(s, now = Date.now()) {
  const head = s.index ? `[${s.index}/${s.total}] ${s.component}` : s.component;
  const since = fmtDur((now - (s.phaseStartedAt || now)) / 1000);
  if (s.phase !== 'backing up') return `${head}: ${s.phase}... ${since}`;
  if (!s.totalBytes) return `${head}: scanning files... ${fmtBytes(s.bytesDone || 0)} read, ${since}`;
  const pct = `${Math.floor((s.percent || 0) * 100)}%`.padStart(4);
  const files = `${(s.filesDone || 0).toLocaleString('en-US')}/${(s.totalFiles || 0).toLocaleString('en-US')} files`;
  const left = s.eta ? `~${fmtDur(s.eta)} left` : '';
  return [head, pct, `${fmtBytes(s.bytesDone)} / ${fmtBytes(s.totalBytes)}`, `${fmtBytes(s.speed || 0)}/s`, files, left, tail(s.current)]
    .filter(Boolean).join('  ');
}

// The running backup's progress, or null when none is running (stale file from a crashed run is ignored).
export function readProgress(cfg) {
  const p = readJson(path.join(cfg._dir, 'progress.json'));
  if (!p) return null;
  let alive = false;
  try { process.kill(p.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
  return alive && Date.now() - p.updatedAt < 120e3 ? p : null;
}

export class Progress {
  constructor(cfg, total, { quiet = false } = {}) {
    this.file = path.join(cfg._dir, 'progress.json');
    this.log = path.join(mkdirp(path.join(cfg._dir, 'logs')), 'backup-last.log');
    this.tty = Boolean(process.stdout.isTTY) && !quiet;
    this.s = { pid: process.pid, total, index: 0, component: '', phase: 'starting', startedAt: Date.now() };
    this.lastFile = 0;
    this.lastLog = 0;
    fs.writeFileSync(this.log, `${new Date().toISOString()} backup started (${total} components)\n`);
    this.timer = setInterval(() => this.render(), 1000);
    this.timer.unref?.();
  }

  begin(index, component) {
    Object.assign(this.s, { index, component, current: '', percent: 0, bytesDone: 0, totalBytes: 0, filesDone: 0, totalFiles: 0, eta: null, speed: 0 });
    this.phase('starting');
  }

  phase(name) { Object.assign(this.s, { phase: name, phaseStartedAt: Date.now() }); this.render(true); }

  // restic's status message
  update(m) {
    Object.assign(this.s, {
      phase: 'backing up', percent: m.percent_done, bytesDone: m.bytes_done, totalBytes: m.total_bytes,
      filesDone: m.files_done, totalFiles: m.total_files, eta: m.seconds_remaining,
      speed: m.seconds_elapsed ? (m.bytes_done || 0) / m.seconds_elapsed : 0,
      current: (m.current_files || [])[0] || this.s.current,
    });
    this.render();
  }

  render(force = false) {
    const line = statusLine(this.s);
    if (this.tty) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(line.slice(0, Math.max(20, (process.stdout.columns || 120) - 1)));
    }
    const now = Date.now();
    if (force || now - this.lastFile > 2000) {
      this.lastFile = now;
      try { writeJson(this.file, { ...this.s, updatedAt: now }); } catch { /* progress is best effort */ }
    }
    if (force || now - this.lastLog > 30e3) {
      this.lastLog = now;
      try { fs.appendFileSync(this.log, `${new Date(now).toISOString().slice(11, 19)} ${line}\n`); } catch { /* best effort */ }
    }
  }

  // A finished step: clear the live line and print a permanent one.
  say(text) {
    if (this.tty) { process.stdout.clearLine(0); process.stdout.cursorTo(0); }
    console.log(text);
    try { fs.appendFileSync(this.log, `${new Date().toISOString().slice(11, 19)} ${text}\n`); } catch { /* best effort */ }
  }

  end(report) {
    clearInterval(this.timer);
    if (this.tty) { process.stdout.clearLine(0); process.stdout.cursorTo(0); }
    fs.rmSync(this.file, { force: true });
    if (report) fs.appendFileSync(this.log, `\n${report}\n`);
  }
}
