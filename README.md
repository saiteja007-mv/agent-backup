# agentvault

Encrypted backups of your AI agent setups and home servers, and a restore that puts them back on
a new machine, including across Windows, macOS and Linux.

It backs up Claude Code, Codex, Gemini CLI, opencode, Cursor and Hermes configs, a shared skills
folder, SSH keys and dotfiles, Docker Compose stacks (with their volumes and databases), Jellyfin and
Navidrome, and any folders or commands you add. Every night, to your Google Drive, encrypted with a
password only you have.

Under the hood it is a thin, careful wrapper around [restic](https://restic.net) (encryption,
deduplication, snapshots) and [rclone](https://rclone.org) (Google Drive). No other dependencies.

```bash
npx agent-backup scan
```

## What you get

- **One snapshot per component.** Restore just Codex from last Tuesday without touching anything else.
- **Pick-and-choose restore** with three modes: `dry-run` (show), `scratch` (restore into a separate
  folder), `in-place` (put files back; every file it overwrites is saved aside first).
- **Cross-OS agent restore.** Back up Claude Code on Windows, restore it on Linux: home paths inside
  JSON/TOML/YAML/Markdown configs are rewritten, and lines that only work on the old OS (PowerShell
  hooks, `.exe` paths, `bash` scripts) are listed so you can fix them.
- **Consistent databases.** SQLite files are copied with `sqlite3 .backup`; Postgres and MySQL/MariaDB
  containers are dumped; Docker stacks without a database are stopped while their data is copied.
- **Nightly schedule** on every OS (systemd timers, Windows Task Scheduler, launchd), catching up if
  the machine was off. Keeps 7 daily, 4 weekly and 6 monthly snapshots.
- **Monthly test restore** that restores one component to a temp folder and verifies every byte.
- **Fleet view.** Lists every machine on your Tailscale network and whether it is backed up. An
  optional morning watchdog posts to Slack when a machine missed its backup.
- **Slack message after every run** (optional).
- **An agent skill**, so Claude Code, Codex and others can check and run backups for you safely.

## Requirements

- Node.js 18.17 or newer
- restic 0.16+ and rclone (`agentvault enroll --apply` installs them with winget, apt/dnf or brew)
- Optional: `sqlite3` (consistent SQLite copies), Docker, Tailscale

## Quick start

```bash
npx agent-backup scan            # what is here, how big (changes nothing)
npx agent-backup enroll          # the setup plan for this machine (changes nothing)
npx agent-backup enroll --apply  # do it
```

`enroll --apply` asks where backups go, installs the tools, connects Google Drive if you chose it
(you sign in in a browser; access is limited to files agentvault creates), asks for a backup
password, creates the repository, schedules the nightly backup and monthly test, and runs the
first backup.

### Where backups go

```
Where should backups go?
  1. Local folder                fast; on the same disk it does not survive a dead disk
  2. Google Drive                off-site, encrypted
  3. Local + Google Drive copy   fast local restores plus an off-site copy
  4. OneDrive                    (coming soon)
  5. iCloud Drive (Mac)          (coming soon)
```

| Choice | Backups | Copy | Fleet list |
|---|---|---|---|
| `local` | `~/AgentVault-backups/<machine>` (or the folder you type, e.g. an external drive) | none | next to the backups |
| `gdrive` | `Google Drive: AgentVault/<machine>` | none | `AgentVault/_fleet` on Drive |
| `both` | local folder | Google Drive, copied after every backup | `AgentVault/_fleet` on Drive |

Non-interactive: `enroll --apply --storage local|gdrive|both [--path <folder>]`. `--copy-to <restic repo>`
copies to any restic repository instead of Drive (a NAS, a second disk); `--repo` uses any restic
repository as the main one.

With `both`, restores read the local folder and switch to the Drive copy by themselves if the local
folder cannot be opened. `--source copy` forces the copy. The monthly test restores from the copy,
since that is the one you need when the disk dies, and the Sunday check covers both.

**Use the same password on every machine and keep it in your password manager.** Without it the
backups cannot be read, by you or anyone else. There is no recovery.

Then, optionally:

```bash
agentvault slack set      # paste a Slack incoming-webhook URL (typed hidden)
agentvault skill install  # teach your AI agents to use agentvault
```

The scheduler runs a copy of agentvault kept in `~/.config/agentvault/app/`, so nightly runs never
depend on `npx` or the network to start. For a permanent command: `npm install -g agent-backup`
(the command is `agentvault`; `agent-backup` works too).

On Linux, run `enroll` with `sudo` on a server to include services and system files (`/etc`); timers
then run as root. As a normal user you get user timers (`loginctl enable-linger` keeps them running
after logout; enroll tells you if it is needed).

## Restoring

With no flags, `agentvault restore` asks: which machine, which components, which date, which mode.

```bash
agentvault restore --component codex --mode dry-run
agentvault restore --component codex --date 2026-10-01 --mode in-place
agentvault restore --from old-laptop --component all --mode scratch --target ./old-laptop-files
```

| Mode | What it does |
|---|---|
| `dry-run` | Lists what would be restored, from where to where, and how many files. Changes nothing. |
| `scratch` | Restores into a separate folder (`--target`). Nothing live is touched. |
| `in-place` | Puts the files back. Files that would be overwritten are saved to `~/.config/agentvault/before-restore/<time>/`. Files that exist only on the machine (caches, anything excluded) are left alone. |

### Moving to a new machine

1. `npx agent-backup enroll --apply` on the new machine, with the same password.
2. `agentvault restore --from <old machine> --component all --mode dry-run`
3. `agentvault restore --from <old machine> --component all --mode in-place`
4. Do the follow-ups it prints (sign in to each agent again; logins are tied to the machine).

Agent components restore on any OS. Machine components (`system`, `docker-*`, services, custom
folders) restore in place only onto the same OS; use `scratch` to get their files elsewhere. The
`system` component keeps lists of installed packages (winget, apt, brew, npm -g, uv, pipx, Docker
images) that you can reinstall from.

## Components

| id | What | Restores across OSes |
|---|---|---|
| `claude` | `~/.claude`, `~/.claude.json` (not plugin caches, worktrees or skills linked from a hub) | yes |
| `codex` | `~/.codex` (not its app binaries, logs or caches) | yes |
| `gemini` | `~/.gemini` (not browser profiles or recordings) | yes |
| `opencode` | `~/.config/opencode`, `~/.local/share/opencode` | yes |
| `cursor` | `~/.cursor` and Cursor's user settings, keybindings and snippets (not extensions) | yes |
| `hermes` | Hermes Agent home, with consistent copies of its SQLite databases | yes |
| `skills-hub` | `~/.agents` | yes |
| `system` | SSH keys, git/gh/npm config, shell profiles, user services, rclone config, package lists; on Linux as root also custom systemd units and `/etc` files like hosts, fstab, caddy, sudoers.d, netplan | no |
| `docker-<project>` | Each Docker Compose project: its folder, named volumes, Postgres/MySQL dumps, bind folders in your home | no |
| `jellyfin`, `navidrome` | Config and database (Jellyfin metadata included, transcodes excluded); needs root | no |

Everything skips `node_modules`, virtualenvs, `__pycache__` and caches. Only components found on the
machine are backed up. See what is found with `agentvault scan` or `agentvault component list`.

### Your own components

```bash
agentvault component add notes ~/Documents/notes D:/Work/configs
agentvault component add router --command "ssh root@192.168.1.1 'sysupgrade -b -'" --file router.tar.gz
agentvault component disable cursor
agentvault component set claude exclude=skills/some-big-tool,projects/scratch
agentvault component set docker-immich consistency=stop
agentvault component set docker-media includeBinds=/srv/media/config
```

`exclude` takes names (`*.log`, `tmp`) or paths relative to the component's folders.
For Docker stacks, `consistency=stop` stops the stack during the copy (the default when it has no
database) and `live` copies it running (the default when the database is dumped).

## Commands

```
scan                             what can be backed up here (read-only)
enroll [--apply]                 plan / set up this machine
backup [--only a,b] [--prune] [--dry-run]
status                           last runs, newest snapshot per component, scheduled jobs
restore [...]                    see Restoring
fleet [--alert]                  machines on your tailnet and their backup state
fleet ignore|unignore <machine>  hide a router or gadget from the fleet view
diff <component>                 changes between the last two backups
check [--full]                   verify the repository (5% of the data, or all)
selftest [--component id]       test restore into a temp folder, verified
schedule install|remove|show [--time 03:00]
component list|enable|disable|add|remove|set
slack set|test|remove
skill install [--dir <skills folder>]
```

`--home <folder>` uses another config folder than `~/.config/agentvault` (handy for testing).

## Configuration

Everything lives in `~/.config/agentvault/` on each machine:

| File | What |
|---|---|
| `config.json` | settings (below) |
| `password` | the repository password, readable only by you |
| `slack-webhook` | the Slack webhook, readable only by you |
| `state.json`, `logs/` | last runs |
| `before-restore/` | files an in-place restore replaced |
| `app/<version>/` | the copy the scheduler runs |

`config.json` fields you may want to change:

| Field | Default |
|---|---|
| `storage` | `local`, `gdrive`, `both`, or `custom` (set by enroll) |
| `repository` | where backups go, set from `storage`. Any restic repository works (local folder, SFTP, S3...). |
| `copyTo` | the copy destination with `both` (Google Drive by default), else `null` |
| `registry` | where each machine writes its status for `fleet` |
| `schedule.time` | `03:00` (`03:30` on Windows) |
| `schedule.selftest` | `true`: monthly test restore |
| `schedule.watchdog` | `false`: set `true` on one always-on machine, then `agentvault schedule install`, for a daily 08:00 fleet check that posts problems to Slack |
| `schedule.staleHours` | `30`: a machine without a backup for this long counts as stale |
| `retention` | `{ "daily": 7, "weekly": 4, "monthly": 6 }` |
| `home` | your home folder; under `sudo`, the invoking user's home |

## Security

- Backups are encrypted by restic (AES-256, authenticated) before they leave the machine. Google
  sees only encrypted blobs. The password never leaves your machines.
- The repository password and Slack webhook are typed hidden and stored readable only by you
  (`chmod 600`, or an owner-only ACL on Windows). They are never backed up and never printed.
- Backups do contain your secrets (API keys in agent configs, SSH keys, `.env` files). That is
  intended: they are what you need on a new machine. Protect the password accordingly.
- Google Drive access uses the `drive.file` scope: rclone can only see files it created.
- Dumps and metadata are staged in `~/.config/agentvault/staging/` (owner-only) and deleted right
  after each component is backed up. Scratch restores may contain secrets; delete them when done.

## Limits

- An in-place restore adds and replaces files; it does not delete files that were created after the
  backup.
- Cross-OS rewriting covers the home folder. Other absolute paths, and commands that only work on the
  old OS, are listed for you rather than guessed at.
- The Windows monthly test runs every 4 weeks (Task Scheduler has no "monthly" trigger in PowerShell).
- Windows scheduled tasks run while you are signed in, and catch up at the next sign-in if missed.
- Logins (Claude, Codex, Gemini, OAuth tokens) are restored, but many are tied to the machine they
  were made on; expect to sign in again.

## License

MIT
