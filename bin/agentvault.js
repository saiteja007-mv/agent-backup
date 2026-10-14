#!/usr/bin/env node
// agentvault: encrypted backups of AI agent setups and server configs (restic + rclone), with restore.
import { parseArgs } from '../lib/args.js';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`agentvault needs Node.js 18.17 or newer (this is ${process.versions.node}).`);
  process.exit(1);
}

const COMMANDS = ['scan', 'enroll', 'backup', 'status', 'restore', 'fleet', 'check', 'diff', 'selftest', 'schedule', 'component', 'slack', 'skill'];
const BOOLS = new Set(['apply', 'yes', 'scheduled', 'prune', 'dry-run', 'alert', 'full', 'no-schedule', 'no-backup', 'help', 'version']);

const help = (v) => `agentvault ${v}: back up and restore AI agent setups and server configs

Start here
  agentvault scan                       what this machine has that can be backed up (changes nothing)
  agentvault enroll                     show the setup plan for this machine (changes nothing)
  agentvault enroll --apply             do it: storage, tools, password, repository, schedule, first backup
      [--storage local|gdrive|both] [--path <local folder>]   (asked when not given)
      [--copy-to <restic repo>] [--repo <restic repo>] [--registry <folder|rclone:remote:path>]
      [--time 03:00] [--no-schedule] [--no-backup] [--password-file <file>] [--yes]
      storage: local = a folder (default ~/AgentVault-backups), gdrive = Google Drive,
               both = local folder + a copy on Google Drive. OneDrive and iCloud: coming soon.

Every day
  agentvault backup [--only a,b] [--prune] [--dry-run]
  agentvault status                     last backup, newest snapshot of each component, scheduled jobs
  agentvault fleet [--alert]            all machines on your Tailscale network and their backup state
  agentvault fleet ignore|unignore <machine>   hide a device that needs no backup (router, gadget)
  agentvault diff <component>           what changed between its last two backups

Restore (with no flags it asks: machine, components, date, mode)
  agentvault restore [--from <machine>] [--component <id>[,<id>]|all] [--date YYYY-MM-DD | --snapshot <id>]
      [--mode dry-run|scratch|in-place] [--target <folder>] [--include <restic pattern>] [--yes]
      [--source local|copy]   (default: local backups, falling back to the copy if they cannot be opened)

Health
  agentvault check [--full]             verify the backups and the copy (5% of the data, or all of it)
  agentvault selftest [--component <id>] [--source local|copy]
                                        restore one component to a temp folder and verify it (tests the copy if there is one)

Setup
  agentvault schedule install|remove|show [--time 03:00]
  agentvault component list | enable <id> | disable <id> | remove <id>
  agentvault component add <id> <path>... [--exclude a,b]
  agentvault component add <id> --command "<command>" [--file <name>]
  agentvault component set <id> key=value...   (consistency=stop|live, includeBinds=/a,/b, exclude=x,y)
  agentvault slack set|test|remove
  agentvault skill install [--dir <skills folder>]

Global: --home <folder> uses another config folder (default ~/.config/agentvault).
Docs: https://www.npmjs.com/package/agent-backup`;

async function main() {
  const { cmd, pos, opts } = parseArgs(process.argv.slice(2), BOOLS);
  if (opts.home) process.env.AGENTVAULT_HOME = String(opts.home);
  const { VERSION } = await import('../lib/app.js');
  if (opts.version || cmd === 'version') { console.log(VERSION); return 0; }
  if (!cmd || cmd === 'help' || opts.help) { console.log(help(VERSION)); return 0; }
  if (!COMMANDS.includes(cmd)) { console.error(`Unknown command "${cmd}". Run "agentvault help".`); return 2; }
  const mod = await import(`../lib/commands/${cmd}.js`);
  return mod.default(opts, pos);
}

main().then(
  (code) => { process.exitCode = code ?? 0; },
  (e) => {
    console.error(`agentvault: ${e.message || e}`);
    if (process.env.AGENTVAULT_DEBUG) console.error(e.stack);
    process.exitCode = 1;
  },
);
