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

// Is a Drive remote usable? 'missing', 'no-token' (sign-in never finished), 'other-client'
// (made with rclone's retiring shared client) or 'ok'. Reads `rclone config dump` without printing it.
export function remoteState(dumpJson, remote) {
  let d = null;
  try { d = JSON.parse(dumpJson)[remote] || null; } catch { /* unreadable: treat as missing */ }
  if (!d) return 'missing';
  if (!d.token) return 'no-token';
  if (hasClient() && d.client_id !== GOOGLE_CLIENT.id) return 'other-client';
  return 'ok';
}

export function driveState(rclone, remote) { return remoteState(run(rclone, ['config', 'dump']).stdout, remote); }
