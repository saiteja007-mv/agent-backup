// Docker Compose stacks, discovered automatically. Each stack is one component: its compose folder,
// named volumes (exported through a throwaway alpine container, no sudo), and database dumps.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, runToFile, dirSize, exists, sleep } from '../util.js';
import { findBinary } from '../restic.js';
import { abs, JUNK } from './common.js';

const HELPER_IMAGE = 'alpine:3';
const DENY_BIND = [/^\/(proc|sys|dev|run|var\/run|tmp)(\/|$)/, /docker\.sock$/, /^\/etc\/(localtime|timezone|hostname|hosts|resolv\.conf)$/];
const MAX_BIND_BYTES = 2 * 1024 ** 3;

export function parseComposeLs(text) {
  let arr = [];
  try { arr = JSON.parse(text || '[]'); } catch { return []; }
  return arr.map((s) => {
    const files = String(s.ConfigFiles || '').split(',').map((f) => f.trim()).filter(Boolean);
    return { name: s.Name, status: s.Status || '', configFiles: files, dir: files[0] ? path.dirname(files[0]) : null };
  }).filter((s) => s.name && s.dir);
}

export function dbKind(image) {
  const i = String(image || '').toLowerCase();
  if (/(^|\/)(postgres|postgis|timescaledb|pgvector)/.test(i)) return 'postgres';
  if (/(^|\/)(mysql|mariadb)/.test(i)) return 'mysql';
  return null;
}

// Docker Desktop on Windows reports bind sources as Linux paths; turn them back into drive paths.
export function hostPath(src, os) {
  if (os !== 'windows') return src;
  const m = /^\/(?:run\/desktop\/mnt\/host|host_mnt|mnt)\/([a-z])(?:\/(.*))?$/i.exec(src);
  return m ? `${m[1].toUpperCase()}:\\${(m[2] || '').replace(/\//g, '\\')}` : src;
}

// Split container mounts into named volumes, extra bind folders to back up, and skipped ones.
export function classifyMounts(mounts, projectDir, homeDir, sizeOf = () => 0, os = 'linux') {
  const volumes = new Set();
  const binds = new Set();
  const skipped = [];
  for (const m of mounts || []) {
    if (m.Type === 'volume' && m.Name) {
      if (/^[0-9a-f]{64}$/.test(m.Name)) skipped.push(`anonymous volume ${m.Name.slice(0, 12)}`);
      else volumes.add(m.Name);
    } else if (m.Type === 'bind' && m.Source) {
      const src = hostPath(m.Source, os);
      if (src.startsWith(projectDir)) continue;
      if (DENY_BIND.some((r) => r.test(src))) continue;
      const allowed = (homeDir && src.startsWith(homeDir)) || (os !== 'windows' && /^\/(srv|opt|data|mnt)\//.test(src));
      if (!allowed) { skipped.push(`bind ${src} (outside home; add it with includeBinds)`); continue; }
      if (sizeOf(src) > MAX_BIND_BYTES) { skipped.push(`bind ${src} (over 2 GB, add it with includeBinds)`); continue; }
      binds.add(src);
    }
  }
  return { volumes: [...volumes], binds: [...binds], skipped };
}

function inspectContainers(dk, project) {
  const ids = run(dk, ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`]).stdout.split(/\s+/).filter(Boolean);
  if (!ids.length) return [];
  const r = run(dk, ['inspect', ...ids]);
  try { return JSON.parse(r.stdout); } catch { return []; }
}

function makeStack(stack, ctx, dk) {
  const id = `docker-${stack.name}`;
  const opts = ctx.options(id);
  const containers = inspectContainers(dk, stack.name);
  const mounts = containers.flatMap((c) => c.Mounts || []);
  const sizeOf = (p) => (exists(p) ? dirSize(p, () => false, 3000).bytes : 0);
  const { volumes, binds, skipped } = classifyMounts(mounts, stack.dir, ctx.home, sizeOf, ctx.os);
  for (const b of opts.includeBinds || []) if (!binds.includes(b)) binds.push(b);
  const dbs = containers
    .map((c) => ({ container: c.Name.replace(/^\//, ''), service: c.Config?.Labels?.['com.docker.compose.service'], kind: dbKind(c.Config?.Image), running: c.State?.Running }))
    .filter((d) => d.kind);
  const consistency = opts.consistency || (dbs.length ? 'live' : 'stop');
  const compose = ['compose', '-p', stack.name, ...stack.configFiles.flatMap((f) => ['-f', f])];

  return {
    id,
    title: `Docker stack ${stack.name}`,
    kind: 'docker',
    crossOS: false,
    entries: [abs(stack.dir), ...binds.map(abs)],
    detect: () => true,
    excludes: () => JUNK,
    info: { project: stack.name, configFiles: stack.configFiles, volumes, dbs, consistency, skipped },
    async pre(_ctx, staging) {
      const notes = [...skipped];
      await runToFile(dk, [...compose, 'config'], path.join(staging, 'compose.resolved.yml'));
      for (const d of dbs) {
        if (!d.running) { notes.push(`${d.container} not running: no dump`); continue; }
        const cmd = d.kind === 'postgres'
          ? 'pg_dumpall -U "${POSTGRES_USER:-postgres}" --clean --if-exists'
          : 'exec mysqldump --all-databases --single-transaction -uroot -p"${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"';
        const r = await runToFile(dk, ['exec', d.container, 'sh', '-c', cmd], path.join(staging, `db-${d.container}.sql`));
        if (!r.ok) notes.push(`dump of ${d.container} failed: ${r.stderr.trim().slice(0, 140)}`);
      }
      let stopped = false;
      const running = containers.some((c) => c.State?.Running);
      if (consistency === 'stop' && running) {
        stopped = run(dk, [...compose, 'stop']).ok;
        notes.push(stopped ? 'stack stopped during backup' : 'could not stop stack; copied live');
      }
      let ok = true;
      for (const v of volumes) {
        const r = run(dk, ['run', '--rm', '-v', `${v}:/v:ro`, '-v', `${staging}:/out`, HELPER_IMAGE, 'tar', '-C', '/v', '-cf', `/out/volume-${v}.tar`, '.']);
        if (!r.ok) { ok = false; notes.push(`volume ${v} export failed: ${r.stderr.trim().slice(0, 140)}`); }
      }
      return { ok, notes, stopped };
    },
    async post(_ctx, pre) {
      if (pre?.stopped) return run(dk, [...compose, 'start']).ok ? ['stack started again'] : ['WARNING: stack did not start again'];
      return [];
    },
    beforeRestore() { run(dk, [...compose, 'stop']); return ['stack stopped for restore']; },
    async restoreData(ctx, stagingDir, meta) {
      const notes = [];
      const info = meta.info || {};
      for (const f of fs.readdirSync(stagingDir).filter((n) => n.startsWith('volume-') && n.endsWith('.tar'))) {
        const v = f.slice('volume-'.length, -'.tar'.length);
        // Compose labels, so "compose up" adopts the volume instead of warning that it is foreign.
        const proj = info.project;
        const labels = proj && v.startsWith(`${proj}_`)
          ? ['--label', `com.docker.compose.project=${proj}`, '--label', `com.docker.compose.volume=${v.slice(proj.length + 1)}`]
          : [];
        run(dk, ['volume', 'create', ...labels, v]);
        const r = run(dk, ['run', '--rm', '-v', `${v}:/v`, '-v', `${stagingDir}:/in:ro`, HELPER_IMAGE, 'sh', '-c', `find /v -mindepth 1 -delete; tar -C /v -xf /in/${f}`]);
        notes.push(r.ok ? `volume ${v} restored` : `volume ${v} FAILED: ${r.stderr.trim().slice(0, 120)}`);
      }
      const dumps = (info.dbs || []).filter((d) => exists(path.join(stagingDir, `db-${d.container}.sql`)));
      if (dumps.length) {
        run(dk, [...compose, 'up', '-d', ...dumps.map((d) => d.service).filter(Boolean)]);
        await sleep(8000);
        for (const d of dumps) {
          const fd = fs.openSync(path.join(stagingDir, `db-${d.container}.sql`), 'r');
          const cmd = d.kind === 'postgres'
            ? 'psql -q -U "${POSTGRES_USER:-postgres}" -d postgres'
            : 'mysql -uroot -p"${MYSQL_ROOT_PASSWORD:-$MARIADB_ROOT_PASSWORD}"';
          const r = spawnSync(dk, ['exec', '-i', d.container, 'sh', '-c', cmd], { stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8' });
          fs.closeSync(fd);
          notes.push(r.status === 0 ? `database ${d.container} reloaded` : `database ${d.container} reload FAILED: ${String(r.stderr).slice(0, 140)}`);
        }
      }
      return notes;
    },
    afterRestore() {
      const up = run(dk, [...compose, 'up', '-d']);
      const ps = run(dk, [...compose, 'ps', '--format', '{{.Name}} {{.State}} {{.Health}}']);
      return [up.ok ? 'stack started' : `stack start FAILED: ${up.stderr.trim().slice(0, 140)}`, ...ps.stdout.trim().split('\n').filter(Boolean)];
    },
  };
}

// Rebuild a stack component from backup metadata (for restoring onto a machine that lacks the stack).
export function stackFromInfo(info, ctx) {
  const dk = findBinary('docker', ctx.cfg);
  if (!dk) throw new Error('docker is not installed on this machine');
  const files = info.configFiles || [];
  return makeStack({ name: info.project, configFiles: files, dir: path.dirname(files[0] || '.') }, ctx, dk);
}

export function discoverStacks(ctx) {
  const dk = findBinary('docker', ctx.cfg);
  if (!dk) return [];
  const r = run(dk, ['compose', 'ls', '--all', '--format', 'json']);
  if (!r.ok) return [];
  return parseComposeLs(r.stdout).map((s) => makeStack(s, ctx, dk));
}
