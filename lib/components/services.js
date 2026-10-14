// Native Linux services with a data folder. Stopped briefly during backup by default
// (set components.options.<id>.consistency = "live" to skip that). Need root to read their data.
import { abs, existingEntries, under, JUNK } from './common.js';
import { run } from '../util.js';
import { isRoot } from '../platform.js';

const active = (unit) => run('systemctl', ['is-active', '--quiet', unit]).ok;

function nativeService({ id, title, unit, entries, skip = [] }) {
  return {
    id,
    title,
    kind: 'service',
    crossOS: false,
    needsRoot: true,
    entries,
    detect(ctx) { return ctx.os === 'linux' && existingEntries(entries, ctx).length > 0; },
    excludes() { return [...JUNK, ...skip]; },
    async pre(ctx) {
      if (!isRoot()) return { ok: false, notes: ['needs root to read its data: run agent-backup as root on this machine'] };
      const mode = ctx.options(id).consistency || 'stop';
      if (mode === 'stop' && active(unit)) {
        const ok = run('systemctl', ['stop', unit]).ok;
        return { ok: true, stopped: ok, notes: [ok ? `${unit} stopped during backup` : `could not stop ${unit}; copied live`] };
      }
      return { ok: true, notes: [] };
    },
    async post(_ctx, pre) {
      if (pre?.stopped) return run('systemctl', ['start', unit]).ok ? [`${unit} started again`] : [`WARNING: ${unit} did not start`];
      return [];
    },
    beforeRestore() { run('systemctl', ['stop', unit]); return [`${unit} stopped for restore`]; },
    afterRestore() { return run('systemctl', ['start', unit]).ok ? [`${unit} started`] : [`${unit} start FAILED`]; },
  };
}

export const jellyfin = nativeService({
  id: 'jellyfin',
  title: 'Jellyfin (config, library database, metadata)',
  unit: 'jellyfin',
  entries: [abs('/etc/jellyfin'), abs('/var/lib/jellyfin')],
  skip: under('/var/lib/jellyfin', ['transcodes']),
});

export const navidrome = nativeService({
  id: 'navidrome',
  title: 'Navidrome (config and database)',
  unit: 'navidrome',
  entries: [abs('/etc/navidrome'), abs('/var/lib/navidrome')],
  skip: under('/var/lib/navidrome', ['cache']),
});

export const SERVICES = [jellyfin, navidrome];
