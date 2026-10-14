import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseToken } from '../lib/google.js';

const token = '{"access_token":"ya29.a0AfB_byC-long-value","token_type":"Bearer","refresh_token":"1//0g-another-long-value","expiry":"2026-10-14T04:00:00.123-05:00","expires_in":3599}';

test('token: plain line, wrapped by the terminal, with rclone markers, with bracketed-paste codes', () => {
  assert.equal(parseToken(token).refresh_token, '1//0g-another-long-value');
  const wrapped = token.match(/.{1,37}/g).join('\n');
  assert.equal(parseToken(wrapped).access_token, 'ya29.a0AfB_byC-long-value');
  assert.ok(parseToken(`Paste the following into your remote machine --->\n${token}\n<---End paste`));
  assert.ok(parseToken(`\x1b[200~${token}\x1b[201~`));
});

test('token: partial or wrong pastes are rejected', () => {
  assert.equal(parseToken(token.slice(0, 120)), null);
  assert.equal(parseToken('{"access_token":"x"}'), null, 'no refresh token');
  assert.equal(parseToken('hello'), null);
});

test('hidden multi-line reader puts a wrapped paste back together', () => {
  const script = `import('${new URL('../lib/util.js', import.meta.url).href}').then(async (u) => {
    const g = await import('${new URL('../lib/google.js', import.meta.url).href}');
    const t = await u.askHiddenLines('Token: ', (x) => Boolean(g.parseToken(x)));
    console.log('GOT', g.parseToken(t)?.refresh_token);
  });`;
  const input = `${token.match(/.{1,50}/g).join('\n')}\n`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input, encoding: 'utf8' });
  assert.match(r.stdout, /GOT 1\/\/0g-another-long-value/);
  assert.doesNotMatch(r.stdout, /ya29/, 'the token is not echoed');
});
