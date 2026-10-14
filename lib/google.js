// agent-backup's own Google OAuth client (Desktop app, drive.file scope only), so Drive sign-in does not
// depend on rclone's shared client, which Google is retiring. For installed apps Google does not treat
// the client secret as confidential: it ships in the package, as rclone's did.
import { run } from './util.js';

export const GOOGLE_CLIENT = { id: '', secret: '' }; // filled in once the Google Cloud client exists

export const hasClient = () => Boolean(GOOGLE_CLIENT.id && GOOGLE_CLIENT.secret);

export function clientArgs() {
  return hasClient() ? [`client_id=${GOOGLE_CLIENT.id}`, `client_secret=${GOOGLE_CLIENT.secret}`] : [];
}

// The client a remote signs in with ('' = rclone's shared one). Reads `rclone config dump` without printing it.
export function remoteClientId(dumpJson, remote) {
  try { return JSON.parse(dumpJson)[remote]?.client_id || ''; } catch { return ''; }
}

// A remote made earlier with another client (e.g. rclone's shared one) needs one new sign-in.
export function needsReconnect(rclone, remote) {
  return hasClient() && remoteClientId(run(rclone, ['config', 'dump']).stdout, remote) !== GOOGLE_CLIENT.id;
}
