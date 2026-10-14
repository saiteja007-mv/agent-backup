// One run at a time per machine. A lock older than 6 hours, or whose process is gone, is stale.
import fs from 'node:fs';
import path from 'node:path';
import { mkdirp } from './util.js';

const STALE_MS = 6 * 3600 * 1000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function acquire(dir) {
  mkdirp(dir);
  const file = path.join(dir, 'agent-backup.lock');
  if (fs.existsSync(file)) {
    let info = {};
    try { info = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* corrupt lock */ }
    const old = Date.now() - (info.time || 0) > STALE_MS;
    if (info.pid && alive(info.pid) && !old) {
      throw new Error(`another agent-backup run is active (pid ${info.pid}, started ${new Date(info.time).toISOString()})`);
    }
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, time: Date.now() }));
  return () => { try { fs.unlinkSync(file); } catch { /* already gone */ } };
}
