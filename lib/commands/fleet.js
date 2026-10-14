// agentvault fleet: every machine on your Tailscale network, and whether it is backed up.
// --alert (the morning watchdog) sends one Slack message when any enrolled machine is stale or failing.
import { loadConfig, saveConfig } from '../config.js';
import { findBinary } from '../restic.js';
import { readAll } from '../registry.js';
import { slack } from '../notify.js';
import { normHost } from '../platform.js';
import { run, fmtAge, table } from '../util.js';

export function tailnetDevices(json) {
  const self = json.Self;
  return [self, ...Object.values(json.Peer || {})].filter(Boolean).map((p) => ({
    host: normHost(p.HostName || p.DNSName), os: p.OS || '', online: p === self || Boolean(p.Online), self: p === self,
  }));
}

export function stateOf(e, now, staleHours) {
  const limit = (e.staleHours || staleHours) * 3600e3;
  if (!e.time) return e.enrolled && now - Date.parse(e.enrolled) < limit ? 'waiting for first backup' : 'NO BACKUP YET';
  if (!e.ok) return 'LAST BACKUP FAILED';
  if (now - Date.parse(e.time) > limit) return 'STALE';
  return e.copyOk === false ? 'COPY FAILED' : 'ok';
}

export default async function fleet(o, pos = []) {
  const cfg = loadConfig();
  if (pos[0] === 'ignore' || pos[0] === 'unignore') {
    if (!pos[1]) throw new Error(`usage: agentvault fleet ${pos[0]} <machine>`);
    const h = normHost(pos[1]);
    const set = new Set((cfg.ignoreDevices || []).map(normHost));
    if (pos[0] === 'ignore') set.add(h); else set.delete(h);
    cfg.ignoreDevices = [...set];
    saveConfig(cfg);
    console.log(`${pos[0] === 'ignore' ? 'Hidden' : 'Showing again'}: ${h}`);
    return 0;
  }
  const ts = findBinary('tailscale', cfg);
  let devices = [];
  if (ts) { try { devices = tailnetDevices(JSON.parse(run(ts, ['status', '--json']).stdout)); } catch { /* tailscale down */ } }
  const ignore = new Set((cfg.ignoreDevices || []).map(normHost));
  devices = devices.filter((d) => !/^(ios|android)$/i.test(d.os) && !ignore.has(d.host));
  const byHost = new Map((cfg._exists ? readAll(cfg) : []).map((e) => [e.host, e]));
  const now = Date.now();
  const rows = [];
  const problems = [];
  const notEnrolled = [];
  for (const h of [...new Set([...devices.map((d) => d.host), ...byHost.keys()])].sort()) {
    const d = devices.find((x) => x.host === h);
    const e = byHost.get(h);
    const state = e ? stateOf(e, now, cfg.schedule.staleHours) : 'not enrolled';
    if (e && !['ok', 'waiting for first backup'].includes(state)) problems.push(`${h}: ${state}${e.time ? ` (last ${fmtAge(now - Date.parse(e.time))})` : ''}`);
    if (!e) notEnrolled.push(h);
    rows.push([h + (d?.self ? ' (this)' : ''), d?.os || e?.os || '', d ? (d.online ? 'online' : 'offline') : 'not on tailnet',
      e?.time ? fmtAge(now - Date.parse(e.time)) : '-', state]);
  }
  console.log(rows.length ? table(rows, ['machine', 'os', 'tailscale', 'last backup', 'state']) : 'No machines found.');
  if (!ts) console.log('\n(tailscale not found: showing enrolled machines only)');
  if (notEnrolled.length) console.log(`\nNot backed up: ${notEnrolled.join(', ')}. On each, run: npx agent-backup enroll`);
  if (!o.alert) return 0;
  if (problems.length) await slack(cfg, `:warning: agentvault fleet check from ${cfg.host}:\n${problems.map((p) => `• ${p}`).join('\n')}`);
  return problems.length ? 1 : 0;
}
