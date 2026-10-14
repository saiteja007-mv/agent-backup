// Components you define in config.json "custom":
//   { "id": "credentials", "paths": ["D:\\Credentials"], "exclude": ["*.bak"] }
//   { "id": "router", "command": "ssh root@192.168.1.1 'sysupgrade -b -'", "file": "router-config.tar.gz" }
import path from 'node:path';
import { abs, existingEntries, JUNK } from './common.js';
import { runToFile } from '../util.js';

function shell(cmd) {
  return process.platform === 'win32' ? ['powershell.exe', ['-NoProfile', '-Command', cmd]] : ['/bin/sh', ['-c', cmd]];
}

export function customComponents(cfg) {
  return (cfg.custom || []).filter((c) => c && c.id).map((c) => {
    if (c.command) {
      return {
        id: c.id,
        title: c.title || `${c.id} (command output)`,
        kind: 'command',
        crossOS: false,
        entries: [],
        detect: () => true,
        excludes: () => [],
        async pre(_ctx, staging) {
          const [bin, args] = shell(c.command);
          const r = await runToFile(bin, args, path.join(staging, c.file || `${c.id}.out`));
          return { ok: r.ok, notes: r.ok ? [] : [`command failed: ${r.stderr.trim().slice(0, 160)}`] };
        },
        restoreNotes: [c.restoreNote || `The captured output is in the restored folder; apply it by hand (${c.id}).`],
      };
    }
    const entries = (c.paths || []).map(abs);
    return {
      id: c.id,
      title: c.title || c.id,
      kind: 'custom',
      crossOS: false,
      entries,
      detect: (ctx) => existingEntries(entries, ctx).length > 0,
      excludes: () => [...JUNK, ...(c.exclude || [])],
      restoreNotes: c.restoreNote ? [c.restoreNote] : [],
    };
  });
}
