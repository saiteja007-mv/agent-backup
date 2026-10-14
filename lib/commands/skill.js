// agent-backup skill install [--dir <skills folder>]: copy the agent-backup skill where agents look for skills.
// A shared ~/.agents/skills hub wins (most agents read it); otherwise Claude Code (and Codex, if present).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PKG_ROOT } from '../app.js';
import { exists } from '../util.js';

export default async function skill(o, pos) {
  if ((pos[0] || 'install') !== 'install') throw new Error('usage: agent-backup skill install [--dir <skills folder>]');
  const home = os.homedir();
  const hub = path.join(home, '.agents', 'skills');
  const dirs = o.dir ? [path.resolve(String(o.dir))]
    : exists(hub) ? [hub]
      : [path.join(home, '.claude', 'skills'), ...(exists(path.join(home, '.codex')) ? [path.join(home, '.codex', 'skills')] : [])];
  for (const d of dirs) {
    const dst = path.join(d, 'agent-backup');
    fs.cpSync(path.join(PKG_ROOT, 'skill', 'agent-backup'), dst, { recursive: true });
    console.log(`Installed: ${dst}`);
  }
  if (dirs[0] === hub) console.log('Agents that read ~/.agents/skills have it now; link it into Claude Code if your setup does that.');
  return 0;
}
