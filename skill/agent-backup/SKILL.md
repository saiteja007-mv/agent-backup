---
name: agent-backup
description: Back up and restore AI agent setups (Claude Code, Codex, Gemini CLI, opencode, Cursor, Hermes, a shared skills hub) and server configs (SSH keys, dotfiles, Docker Compose stacks with their volumes and databases, Jellyfin/Navidrome, custom folders) with the agent-backup CLI. Use when the user asks to back up, restore, move their agents to a new machine, check whether backups are working, see which machines are protected, or add a machine to backups.
---

# agent-backup

`agent-backup` is a CLI on npm. Backups are encrypted restic snapshots, one per
component. Each machine stores them in a local folder, on Google Drive, or both (local + a Drive copy);
`agent-backup status` shows which. Run it as `agent-backup <command>` if it is installed, otherwise
`npx -y agent-backup <command>`.

## Safe to run any time (read-only)

| Want | Command |
|---|---|
| What can be backed up here, and how big | `agent-backup scan` |
| Is this machine backed up, when was the last run | `agent-backup status` |
| Which machines on the Tailscale network are protected | `agent-backup fleet` |
| What changed since the previous backup | `agent-backup diff <component>` |
| What a restore would do | `agent-backup restore --component <id> --mode dry-run` |
| Verify the backup storage | `agent-backup check` |
| Prove a restore works (temp folder, deleted after) | `agent-backup selftest` |

## Ask the user before running

- `agent-backup enroll --apply`: asks where backups go (local folder, Google Drive, or both; OneDrive
  and iCloud are listed as coming soon), installs restic/rclone, opens a Google sign-in if Drive is
  chosen, asks for the backup password, creates the repository, installs the nightly schedule. Ask the
  user which storage they want and pass it as `--storage local|gdrive|both` (`--path` for the folder). Show `agent-backup enroll` (the plan)
  first. The password and the Google sign-in are the user's to type: run it in a terminal they can
  type into, or give them the command. Never put a password on a command line.
- `agent-backup restore ... --mode in-place --yes`: overwrites live files (every overwritten file is
  saved under `~/.config/agent-backup/before-restore/<time>/` first). Always run the same restore with
  `--mode dry-run` first, show the result, and wait for a clear yes.
- `agent-backup backup`, `schedule install|remove`, `component add|disable|enable|remove|set`,
  `fleet ignore`, `slack set|remove`.

## Never

- Read, print, copy or upload `~/.config/agent-backup/password` or `~/.config/agent-backup/slack-webhook`.
- Run `restic forget`, `restic prune` or delete anything in the repository yourself.
- Restore machine-specific components (`system`, `docker-*`, services) onto a different OS. The CLI
  refuses; use `--mode scratch` to pull files out for reference instead.

## Common flows

**New machine, same agents as before**
1. `npx -y agent-backup enroll` (show the plan), then the user runs `npx -y agent-backup enroll --apply`
   with the SAME password as their other machines.
2. `agent-backup restore --from <old-machine> --component all --mode dry-run`, show it.
3. After a yes: the same command with `--mode in-place --yes`. Agent configs restore across
   Windows/macOS/Linux: home paths inside text configs are rewritten, and lines that only work on the
   old OS are listed for the user to fix by hand.
4. Tell the user the follow-ups the CLI prints (logins, re-linking skills).

**Add another device to the same Google account**
`npx -y agent-backup enroll --apply` on that device, same storage choice, same Google account, same
password (enroll rejects a different one). On a server without a browser, the user runs
`npx agent-backup authorize` on a computer that has one and pastes the result. If the device name is
already taken, ask the user whether it is the same machine (`--same-machine`) or pick `--name <name>`.

**"Is my backup working?"** `agent-backup status`; for a machine-wide view `agent-backup fleet`.
A failed or stale machine is also posted to Slack when the watchdog is on.

**Back up something extra** `agent-backup component add <id> <path>...`, or a command whose output
should be saved: `agent-backup component add router --command "ssh root@<router> 'sysupgrade -b -'" --file router.tar.gz`.

**Skip something big** `agent-backup component set <id> exclude=skills/big-tool,other/folder`.

## Reading results

Exit code 0 means success, 1 means something failed (the output names it). `status` shows the
last run; the full report of the last backup is in `~/.config/agent-backup/logs/backup-last.log`.
