<p align="center">
  <img src="https://raw.githubusercontent.com/saiteja007-mv/agent-backup/main/docs/hero.png" alt="Agent Backup: back up and restore agent configs, skills, MCPs and multi-device setups" width="100%">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-backup"><img src="https://img.shields.io/npm/v/agent-backup" alt="npm version"></a>
  <img src="https://img.shields.io/node/v/agent-backup" alt="node version">
  <img src="https://img.shields.io/npm/l/agent-backup" alt="license">
</p>

## What it does

- Backs up **Claude Code, Codex, Gemini CLI, opencode, Cursor and Hermes**, your skills folder, SSH keys,
  dotfiles and Docker Compose stacks.
- Encrypts everything with your password before it leaves the machine.
- Stores it in a **local folder, Google Drive, or both**.
- Runs every night on Windows, macOS and Linux, and tests a restore every month.
- Restores one thing or everything, even onto a different operating system.
- Keeps **every device on one Google account** in its own folder.

## Install

Needs [Node.js](https://nodejs.org) 18.17 or newer.

```bash
npm install -g agent-backup
```

Or run it without installing: `npx agent-backup <command>`.

## Quick start

```bash
agent-backup scan            # what can be backed up here (changes nothing)
agent-backup enroll --apply  # choose storage, sign in, set a password, first backup
agent-backup status          # what is backed up, and when
```

To restore, run `agent-backup restore` and pick the device, the components, the date and the mode.

## Learn more

The [full guide](https://github.com/saiteja007-mv/agent-backup/blob/main/docs/GUIDE.md) covers storage
options, adding devices, restoring, components, commands, configuration and security.

## License

MIT
