---
name: agentvault
description: Back up and restore AI agent setups (Claude Code, Codex, Gemini CLI, opencode, Cursor, Hermes, a shared skills hub) and server configs (SSH keys, dotfiles, Docker Compose stacks with their volumes and databases, Jellyfin/Navidrome, custom folders) with the agentvault CLI. Use when the user asks to back up, restore, move their agents to a new machine, check whether backups are working, see which machines are protected, or add a machine to backups.
---

# agentvault

`agentvault` is a CLI (npm package `agent-backup`). Backups are encrypted restic snapshots, one per
component, usually stored on Google Drive through rclone. Run it as `agentvault <command>` if it is
installed, otherwise `npx -y agent-backup <command>`.

## Safe to run any time (read-only)

| Want | Command |
|---|---|
| What can be backed up here, and how big | `agentvault scan` |
| Is this machine backed up, when was the last run | `agentvault status` |
| Which machines on the Tailscale network are protected | `agentvault fleet` |
| What changed since the previous backup | `agentvault diff <component>` |
| What a restore would do | `agentvault restore --component <id> --mode dry-run` |
| Verify the backup storage | `agentvault check` |
| Prove a restore works (temp folder, deleted after) | `agentvault selftest` |

## Ask the user before running

- `agentvault enroll --apply`: installs restic/rclone, opens a Google sign-in, asks for the backup
  password, creates the repository, installs the nightly schedule. Show `agentvault enroll` (the plan)
  first. The password and the Google sign-in are the user's to type: run it in a terminal they can
  type into, or give them the command. Never put a password on a command line.
- `agentvault restore ... --mode in-place --yes`: overwrites live files (every overwritten file is
  saved under `~/.config/agentvault/before-restore/<time>/` first). Always run the same restore with
  `--mode dry-run` first, show the result, and wait for a clear yes.
- `agentvault backup`, `schedule install|remove`, `component add|disable|enable|remove|set`,
  `fleet ignore`, `slack set|remove`.

## Never

- Read, print, copy or upload `~/.config/agentvault/password` or `~/.config/agentvault/slack-webhook`.
- Run `restic forget`, `restic prune` or delete anything in the repository yourself.
- Restore machine-specific components (`system`, `docker-*`, services) onto a different OS. The CLI
  refuses; use `--mode scratch` to pull files out for reference instead.

## Common flows

**New machine, same agents as before**
1. `npx -y agent-backup enroll` (show the plan), then the user runs `npx -y agent-backup enroll --apply`
   with the SAME password as their other machines.
2. `agentvault restore --from <old-machine> --component all --mode dry-run`, show it.
3. After a yes: the same command with `--mode in-place --yes`. Agent configs restore across
   Windows/macOS/Linux: home paths inside text configs are rewritten, and lines that only work on the
   old OS are listed for the user to fix by hand.
4. Tell the user the follow-ups the CLI prints (logins, re-linking skills).

**"Is my backup working?"** `agentvault status`; for a machine-wide view `agentvault fleet`.
A failed or stale machine is also posted to Slack when the watchdog is on.

**Back up something extra** `agentvault component add <id> <path>...`, or a command whose output
should be saved: `agentvault component add router --command "ssh root@<router> 'sysupgrade -b -'" --file router.tar.gz`.

**Skip something big** `agentvault component set <id> exclude=skills/big-tool,other/folder`.

## Reading results

Exit code 0 means success, 1 means something failed (the output names it). `status` shows the
last run; the full report of the last backup is in `~/.config/agentvault/logs/backup-last.log`.
