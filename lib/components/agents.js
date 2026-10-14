// AI agent setups. All are cross-OS: on restore their paths are re-rooted on the target machine.
//
// Component shape (shared by every component type):
//   id, title, kind, crossOS, entries: [{root, rel}], needsRoot?
//   detect(ctx) -> bool               is it on this machine?
//   excludes(ctx) -> [pattern|abs]     passed to restic --exclude
//   pre(ctx, staging) -> {ok, notes}   before backup (dumps, consistent copies); staging is backed up too
//   post(ctx, preResult) -> notes      after backup (restart what pre stopped)
//   beforeRestore(ctx) / afterRestore(ctx) -> notes
//   restoreNotes: [string]             manual follow-ups printed after a restore
import fs from 'node:fs';
import path from 'node:path';
import { home, appdata, hermes, under, linkedChildren, sqliteCopies, existingEntries, JUNK } from './common.js';
import { resolveEntry } from '../platform.js';
import { run, exists, mkdirp } from '../util.js';

function agent(def) {
  const { skip = {}, extraExcludes, ...rest } = def;
  return {
    kind: 'agent',
    crossOS: true,
    detect(ctx) { return existingEntries(def.entries, ctx).length > 0; },
    excludes(ctx) {
      const out = [...JUNK];
      for (const e of existingEntries(def.entries, ctx)) out.push(...under(e.abs, skip[e.rel] || []));
      if (extraExcludes) out.push(...extraExcludes(ctx));
      return out;
    },
    ...rest,
  };
}

export const claude = agent({
  id: 'claude',
  title: 'Claude Code',
  entries: [home('.claude'), home('.claude.json')],
  skip: { '.claude': ['plugins/cache', 'plugins/marketplaces', 'plugins/.trash', 'debug', 'shell-snapshots', 'statsig', 'ide', 'cache', 'downloads', 'telemetry', 'worktrees'] },
  // Skills linked in from a shared hub are backed up by the skills-hub component.
  extraExcludes: (ctx) => linkedChildren(resolveEntry(home('.claude/skills'), ctx)),
  restoreNotes: ['Open Claude Code; run /login if it asks (logins are tied to the machine they were made on).'],
});

export const codex = agent({
  id: 'codex',
  title: 'OpenAI Codex CLI',
  entries: [home('.codex')],
  skip: { '.codex': ['log', 'tmp', '.tmp', 'cache', '.sandbox', '.sandbox-bin', 'packages', 'plugins/cache', 'plugins/.plugin-appserver'] },
  extraExcludes: (ctx) => linkedChildren(resolveEntry(home('.codex/skills'), ctx)),
  restoreNotes: ['Run "codex login status"; run "codex login" if it is signed out.'],
});

export const gemini = agent({
  id: 'gemini',
  title: 'Gemini CLI',
  entries: [home('.gemini')],
  skip: {
    '.gemini': ['tmp', 'cache', 'antigravity-browser-profile',
      ...['antigravity', 'antigravity-ide', 'antigravity-cli'].flatMap((d) => [`${d}/browser_recordings`, `${d}/bin`, `${d}/log`])],
  },
  restoreNotes: ['Run "gemini" once and sign in again if prompted.'],
});

export const opencode = agent({
  id: 'opencode',
  title: 'opencode',
  entries: [home('.config/opencode'), home('.local/share/opencode')],
  skip: { '.local/share/opencode': ['bin', 'log'] },
});

export const cursor = agent({
  id: 'cursor',
  title: 'Cursor',
  entries: [home('.cursor'), appdata('Cursor/User/settings.json'), appdata('Cursor/User/keybindings.json'), appdata('Cursor/User/snippets')],
  skip: { '.cursor': ['extensions', 'logs', 'worktrees'] },
});

export const skillsHub = agent({
  id: 'skills-hub',
  title: 'Shared skills hub (~/.agents)',
  entries: [home('.agents')],
  skip: { '.agents': ['dist', 'build'] },
  restoreNotes: ['Re-link the skills into each agent (your hub link script, e.g. "skills.ps1 link").'],
});

const HERMES_SKIP = ['hermes-agent', 'tools', 'installs', 'bootstrap-cache', 'cache', 'audio_cache', 'image_cache', 'logs', 'backups', 'models_dev_cache.json'];

export const hermesAgent = agent({
  id: 'hermes',
  title: 'Hermes Agent',
  entries: [hermes('')],
  skip: { '': HERMES_SKIP },
  async pre(ctx, staging) {
    const root = resolveEntry(hermes(''), ctx);
    const skipDirs = HERMES_SKIP.concat(['node_modules']).map((d) => path.join(root, d));
    const r = sqliteCopies(root, staging, { skip: (p) => skipDirs.some((d) => p.startsWith(d)) });
    return { ok: true, notes: r.notes.concat(r.copied ? [`${r.copied} SQLite databases copied consistently`] : []) };
  },
  beforeRestore(ctx) {
    if (ctx.os === 'linux') run('systemctl', ['--user', 'stop', 'hermes-gateway']);
    return [];
  },
  // The live database files were restored with everything else; replace them with the consistent copies.
  restoreData(ctx, staging) {
    const src = path.join(staging, 'sqlite');
    if (!exists(src)) return [];
    const root = resolveEntry(hermes(''), ctx);
    let n = 0;
    const walk = (dir) => {
      for (const it of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) { walk(p); continue; }
        const dst = path.join(root, path.relative(src, p));
        mkdirp(path.dirname(dst));
        fs.copyFileSync(p, dst);
        for (const s of ['-wal', '-shm']) fs.rmSync(dst + s, { force: true });
        n++;
      }
    };
    walk(src);
    return n ? [`${n} SQLite databases put back from consistent copies`] : [];
  },
  afterRestore(ctx) {
    if (ctx.os === 'linux' && exists(path.join(ctx.home, '.config', 'systemd', 'user', 'hermes-gateway.service'))) {
      run('systemctl', ['--user', 'start', 'hermes-gateway']);
      return ['Started hermes-gateway again; check with "hermes status".'];
    }
    return [];
  },
  restoreNotes: ['Run "hermes status" to confirm the gateway, model login and cron jobs.'],
});

export const AGENTS = [claude, codex, gemini, opencode, cursor, hermesAgent, skillsHub];
