import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceSignIn, hasDeviceClient, remoteState, DEVICE_CLIENT, GOOGLE_CLIENT } from '../lib/google.js';

// A fake Google: the device-code answer, then one token-endpoint answer per poll.
function fakeGoogle(polls) {
  const calls = [];
  const fetchImpl = async (url, { body }) => {
    calls.push({ url, body: Object.fromEntries(body) });
    if (url.endsWith('/device/code')) {
      return { status: 200, json: async () => ({ device_code: 'dc', user_code: 'ABC-DEF-GHIJ', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 }) };
    }
    const next = polls.shift();
    if (next instanceof Error) throw next;
    return { status: next.access_token ? 200 : 428, json: async () => next };
  };
  let clock = 0;
  return { calls, fetchImpl, now: () => clock, sleep: async (ms) => { clock += ms; } };
}

const skip = !hasDeviceClient() && 'no lib/google-device-client.json in this checkout';

test('device sign-in: shows the code, waits while pending, slows down when told, returns an rclone token', { skip }, async () => {
  const g = fakeGoogle([
    { error: 'authorization_pending' },
    { error: 'slow_down' },
    new Error('network blip'),
    { access_token: 'at', refresh_token: 'rt', expires_in: 3599, token_type: 'Bearer' },
  ]);
  let shown;
  const token = await deviceSignIn({ onCode: (c) => { shown = c; }, fetchImpl: g.fetchImpl, sleep: g.sleep, now: g.now });
  assert.deepEqual(shown, { url: 'https://www.google.com/device', code: 'ABC-DEF-GHIJ', expiresIn: 1800 });
  assert.equal(token.access_token, 'at');
  assert.equal(token.refresh_token, 'rt');
  assert.match(token.expiry, /^\d{4}-\d\d-\d\dT/);
  assert.equal(g.calls[0].body.scope, 'https://www.googleapis.com/auth/drive.file');
  assert.equal(g.calls[1].body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
  assert.equal(g.calls[1].body.client_secret, DEVICE_CLIENT.secret, 'the token endpoint gets the client secret');
});

test('device sign-in: a declined sign-in and an expired code end with clear errors', { skip }, async () => {
  const declined = fakeGoogle([{ error: 'access_denied' }]);
  await assert.rejects(deviceSignIn({ fetchImpl: declined.fetchImpl, sleep: declined.sleep, now: declined.now }), /declined/);
  const forever = fakeGoogle(Array.from({ length: 400 }, () => ({ error: 'authorization_pending' })));
  await assert.rejects(deviceSignIn({ fetchImpl: forever.fetchImpl, sleep: forever.sleep, now: forever.now }), /expired/);
});

test('a Drive remote signed in through either agent-backup client counts as signed in', () => {
  const dump = JSON.stringify({
    desktop: { type: 'drive', token: '{}', client_id: GOOGLE_CLIENT.id },
    device: { type: 'drive', token: '{}', client_id: DEVICE_CLIENT.id },
  });
  if (GOOGLE_CLIENT.id) assert.equal(remoteState(dump, 'desktop'), 'ok');
  if (DEVICE_CLIENT.id) assert.equal(remoteState(dump, 'device'), 'ok');
});
