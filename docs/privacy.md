---
title: agent-backup privacy policy
---

# agent-backup privacy policy

Last updated: 14 October 2026

agent-backup is an open-source command-line tool that you run on your own computers. It has no server,
no user accounts and no analytics. Its developers never receive your data.

## What it accesses

When you choose Google Drive as a backup destination, agent-backup asks Google for the
**`drive.file`** permission ("See, edit, create and delete only the specific Google Drive files that
you use with this app"). With it, agent-backup can only see the files and folders it creates itself.
It cannot read any other file in your Google Drive.

It uses that access only to store and read your own backups in a folder named `agent-backup`.

## What it stores and where

- **Your backups** are encrypted on your computer with a password only you know, before anything is
  uploaded. Google Drive holds only the encrypted data.
- **Your Google sign-in** (an access and refresh token) is stored only on your computer, in
  `~/.config/agent-backup/rclone.conf`, readable only by your user account.
- **Nothing** is sent to the developers of agent-backup or to any third party other than Google, as
  part of storing files in your own Drive.

## Use of Google user data

agent-backup's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements. The data is used only to provide the backup and restore
features you run; it is not used for advertising, not sold, and not read by people.

## Removing access and data

- Withdraw agent-backup's access at any time in your Google Account under
  [Security > Third-party apps and services](https://myaccount.google.com/connections).
- Delete your backups by deleting the `agent-backup` folder from your Google Drive, and the local
  settings by deleting `~/.config/agent-backup`.

## Contact

Questions or concerns: open an issue at
[github.com/saiteja007-mv/agent-backup/issues](https://github.com/saiteja007-mv/agent-backup/issues).
