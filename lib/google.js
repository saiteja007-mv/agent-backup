// agent-backup's own Google OAuth clients (drive.file scope only), so Drive sign-in does not depend on
// rclone's shared client, which Google is retiring:
//   google-client.json         Desktop app: the usual browser sign-in, on machines with a browser
//   google-device-client.json  TVs and Limited Input devices: device sign-in (a code entered at
//                              google.com/device on any phone or computer), on machines without one
// Both live next to this file: shipped in the npm package, kept out of git. They belong to one Google
// Cloud project, and drive.file access is per project, so files either client creates are visible to
// the other (tested). Building from source? Create both clients with scope drive.file and save each as
// {"id": "...apps.googleusercontent.com", "secret": "..."}.
import fs from 'node:fs';
import { run } from './util.js';

function load(file) {
  try {
    const c = JSON.parse(fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
    return { id: String(c.id || ''), secret: String(c.secret || '') };
  } catch {
    return { id: '', secret: '' };
  }
}

export const GOOGLE_CLIENT = load('google-client.json');
export const DEVICE_CLIENT = load('google-device-client.json');

export const hasClient = () => Boolean(GOOGLE_CLIENT.id && GOOGLE_CLIENT.secret);
export const hasDeviceClient = () => Boolean(DEVICE_CLIENT.id && DEVICE_CLIENT.secret);

export function clientArgs() {
  return hasClient() ? [`client_id=${GOOGLE_CLIENT.id}`, `client_secret=${GOOGLE_CLIENT.secret}`] : [];
}

// Is a Drive remote usable? 'missing', 'no-token' (sign-in never finished), 'other-client'
// (made with rclone's retiring shared client) or 'ok'. Reads `rclone config dump` without printing it.
export function remoteState(dumpJson, remote) {
  let d = null;
  try { d = JSON.parse(dumpJson)[remote] || null; } catch { /* unreadable: treat as missing */ }
  if (!d) return 'missing';
  if (!d.token) return 'no-token';
  const ours = [GOOGLE_CLIENT.id, DEVICE_CLIENT.id].filter(Boolean);
  if (ours.length && !ours.includes(d.client_id)) return 'other-client';
  return 'ok';
}

export function driveState(rclone, remote) { return remoteState(run(rclone, ['config', 'dump']).stdout, remote); }

// Device sign-in (Google's OAuth device flow): Google gives a short code, the user enters it at
// google.com/device on any phone or computer, and this polls until Google hands over the token.
// Returns the token in the shape rclone stores. fetch/sleep/now can be swapped in tests.
export async function deviceSignIn({ onCode, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  if (!hasDeviceClient()) throw new Error('this copy of agent-backup has no device sign-in client (lib/google-device-client.json)');
  const post = async (url, body) => {
    const res = await fetchImpl(url, { method: 'POST', body: new URLSearchParams(body) });
    let j = {};
    try { j = await res.json(); } catch { /* empty body */ }
    return { status: res.status, j };
  };
  const start = await post('https://oauth2.googleapis.com/device/code', {
    client_id: DEVICE_CLIENT.id, scope: 'https://www.googleapis.com/auth/drive.file',
  });
  if (!start.j.device_code) {
    throw new Error(`Google refused to start the sign-in: ${start.j.error_description || start.j.error || start.j.error_code || `HTTP ${start.status}`}`);
  }
  onCode?.({ url: start.j.verification_url || start.j.verification_uri, code: start.j.user_code, expiresIn: start.j.expires_in || 1800 });

  let wait = (start.j.interval || 5) * 1000;
  const deadline = now() + (start.j.expires_in || 1800) * 1000;
  while (now() < deadline) {
    await sleep(wait);
    let j;
    try {
      ({ j } = await post('https://oauth2.googleapis.com/token', {
        client_id: DEVICE_CLIENT.id, client_secret: DEVICE_CLIENT.secret,
        device_code: start.j.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }));
    } catch {
      continue; // network blip: try again on the next tick
    }
    if (j.access_token) {
      return {
        access_token: j.access_token, token_type: j.token_type || 'Bearer', refresh_token: j.refresh_token,
        expiry: new Date(now() + (j.expires_in || 3600) * 1000).toISOString(),
      };
    }
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { wait += 5000; continue; }
    if (j.error === 'access_denied') throw new Error('the sign-in was declined on the Google page');
    throw new Error(`Google sign-in failed: ${j.error_description || j.error || 'unknown error'}`);
  }
  throw new Error('the code expired before the sign-in finished; run enroll again for a new code');
}
