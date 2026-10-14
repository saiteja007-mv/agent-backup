# agent-backup design

## Goals

1. Survive a dead disk or a lost laptop: everything needed to rebuild agents and servers is off-site.
2. Move to a new machine: reinstall the OS, run two commands, get the same agents back.
3. Undo a bad change: restore one component from a chosen day without touching the rest.

Non-goals: backing up media libraries, git repositories with remotes, or whole disks.

## Shape

```
bin/agent-backup.js        argument parsing, dispatch
lib/commands/*.js        one file per command; each exports default (opts, positional) -> exit code
lib/components/*.js      what to back up: agents, system, services, docker (discovered), custom
lib/restic.js            restic/rclone wrapper (binary discovery, JSON parsing)
lib/overlay.js           in-place restore: copy over live files, save what is replaced
lib/xos.js               cross-OS path rewriting and "only works on the old OS" detection
lib/schedule.js          systemd / Task Scheduler / launchd renderers + install
lib/registry.js          fleet status files (local folder or rclone remote)
```

No npm dependencies. Node 18.17+ (built-in `fetch`, `fs.cpSync`, `node:test`).

## Storage

- One restic repository per machine: `agent-backup/<machine>` on Google Drive via rclone.
  Per-machine repositories keep locks, pruning and failures independent.
- One snapshot per component per run, tagged `av:1` and `component:<id>`, host = machine name.
  Retention runs with `--group-by host,tags`, so each component keeps its own 7/4/6 history.
- The fleet registry is one small JSON per machine next to the repositories
  (`agent-backup/_fleet/<machine>.json`): last run, result, repository location. It holds no secrets.

## Component contract

```
id, title, kind, crossOS, entries: [{root, rel}], needsRoot?
detect(ctx) -> bool
excludes(ctx) -> [name | glob | absolute path]
pre(ctx, staging) -> {ok, notes}      dumps / consistent copies into staging
post(ctx, preResult) -> notes         restart what pre stopped
beforeRestore(ctx) / afterRestore(ctx) -> notes
restoreData(ctx, stagingDir, meta) -> notes    volumes, database reloads, SQLite copies
restoreNotes: [string]
info?                                  extra metadata saved with the backup (docker)
```

Entries use logical roots (`home`, `appdata`, `localappdata`, `hermes`, `abs`) so the same entry
resolves to the right place on the target OS.

Each backup also includes a staging folder with `_agent-backup.json` (component id, source OS, source
home, resolved entry paths, component info). Restore reads it with `restic dump` before restoring
anything, so dry-run needs no download of file contents.

## Backup run

1. Lock (`agent-backup.lock`, stale after 6 h or when the PID is gone).
2. Per component: fresh owner-only staging folder, metadata, `pre`, `restic backup` of entries +
   staging, `post`, delete staging. A failing component does not stop the others.
3. `restic forget` nightly; on Sundays also `--prune` and `check --read-data-subset=5%`.
4. `state.json`, `logs/backup-last.log`, fleet registry entry, Slack message. Exit 1 on any failure.

## Restore run

1. Choose machine (fleet registry gives each machine's repository), components, snapshot (latest,
   `--date`, or `--snapshot`), mode.
2. Read metadata; map each entry to its target on this machine. Machine-specific components map
   only on the same OS.
3. `dry-run`: print the mapping and file counts from `restic ls`.
   `scratch`: `restic restore` into the target folder.
   `in-place`: `restic restore` into a private temp folder, then `beforeRestore`, overlay each entry
   (save replaced files, rewrite home paths in text configs when OS or home differs, collect
   OS-specific lines), `restoreData`, `afterRestore`, delete the temp folder.
4. On Windows, permissions of restored files are reset to inherited ones, because restic also
   restores the ACLs of parent folders such as `C:\Users`.

## Scheduling

The scheduler runs `node <config>/app/<version>/bin/agent-backup.js <job>`: a copy made at enroll or
`schedule install`, so a cleared npx cache or no network at 3 a.m. cannot stop a backup. Binaries
are pinned in `config.json` because schedulers have a short PATH.

## Testing

`npm test` runs unit tests for path rewriting, path mapping, overlay, schedule renderers, Docker
mount handling, argument parsing and fleet state. The end-to-end check is a real backup and restore
against a local repository with `--home` pointing at a throwaway config folder.
