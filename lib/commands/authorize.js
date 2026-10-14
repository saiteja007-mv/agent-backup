// agent-backup authorize: Google sign-in for a device without a browser (a server). Run it on any
// computer that has a browser, sign in, and paste what it prints into the server's enroll, where rclone
// asks for "config_token".
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { findBinary } from '../restic.js';
import { authorizeBlob, hasClient } from '../google.js';

export default async function authorize() {
  if (!hasClient()) throw new Error('this version has no Google client built in');
  const rclone = findBinary('rclone', loadConfig());
  if (!rclone) throw new Error('rclone is not installed on this computer (see "Install restic and rclone" in the README)');
  console.log('Sign in with the Google account the other device should back up to.');
  console.log('Then copy what rclone prints between the ---> and <--- lines (one long {"access_token"... line)');
  console.log('and paste it into the other device. If your terminal breaks it over several lines, that is fine.\n');
  return spawnSync(rclone, ['authorize', 'drive', authorizeBlob()], { stdio: 'inherit' }).status ?? 1;
}
