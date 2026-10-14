// agent-backup's own Google OAuth client (Desktop app, drive.file scope only), so Drive sign-in does not
// depend on rclone's shared client, which Google is retiring.
//
// The client lives in google-client.json next to this file: shipped in the npm package, kept out of git.
// Building from source? Create a Desktop OAuth client (scope drive.file) in Google Cloud and save it as
// lib/google-client.json: {"id": "...apps.googleusercontent.com", "secret": "..."}. Without it, Drive
// sign-in falls back to rclone's own shared client.
import fs from 'node:fs';
import { run } from './util.js';

function loadClient() {
  try {
    const c = JSON.parse(fs.readFileSync(new URL('./google-client.json', import.meta.url), 'utf8'));
    return { id: String(c.id || ''), secret: String(c.secret || '') };
  } catch {
    return { id: '', secret: '' };
  }
}

export const GOOGLE_CLIENT = loadClient();

export const hasClient = () => Boolean(GOOGLE_CLIENT.id && GOOGLE_CLIENT.secret);

export function clientArgs() {
  return hasClient() ? [`client_id=${GOOGLE_CLIENT.id}`, `client_secret=${GOOGLE_CLIENT.secret}`] : [];
}

// The argument for `rclone authorize drive <blob>`: agent-backup's client and the drive.file scope,
// in the base64 JSON form rclone itself prints for machines without a browser.
export function authorizeBlob() {
  return Buffer.from(JSON.stringify({ client_id: GOOGLE_CLIENT.id, client_secret: GOOGLE_CLIENT.secret, scope: 'drive.file' })).toString('base64url');
}

// The client a remote signs in with ('' = rclone's shared one). Reads `rclone config dump` without printing it.
export function remoteClientId(dumpJson, remote) {
  try { return JSON.parse(dumpJson)[remote]?.client_id || ''; } catch { return ''; }
}

// A remote made earlier with another client (e.g. rclone's shared one) needs one new sign-in.
export function needsReconnect(rclone, remote) {
  return hasClient() && remoteClientId(run(rclone, ['config', 'dump']).stdout, remote) !== GOOGLE_CLIENT.id;
}
