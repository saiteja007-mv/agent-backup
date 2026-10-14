import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renameDevice, resolveName, passwordVerdict } from '../lib/devices.js';
import { applyStorage } from '../lib/config.js';

const base = () => ({ host: 'laptop', home: path.resolve('/home/alex') });

test('renaming a device moves its repositories along', () => {
  const c = renameDevice(applyStorage(base(), 'both'), 'work-laptop');
  assert.equal(c.host, 'work-laptop');
  assert.equal(c.repository, path.join(path.resolve('/home/alex'), 'agent-backups', 'work-laptop'));
  assert.equal(c.copyTo, 'rclone:agent-backup-gdrive:agent-backup/work-laptop');
  assert.equal(c.registry, 'rclone:agent-backup-gdrive:agent-backup/_fleet', 'the fleet list is shared, not per device');
});

test('a name already in the Drive is refused without a terminal unless --same-machine', async () => {
  const fleet = [{ host: 'laptop', os: 'linux', time: new Date().toISOString() }];
  const cfg = applyStorage(base(), 'gdrive');
  await assert.rejects(resolveName(cfg, fleet, {}), /already backed up here.*--same-machine.*--name/s);
  await resolveName(cfg, fleet, { 'same-machine': true });
  await resolveName(applyStorage({ ...base(), host: 'desktop' }, 'gdrive'), fleet, {});
});

test('password check tells a wrong password from an unreachable repository', () => {
  assert.equal(passwordVerdict({ ok: true, stderr: '' }), 'ok');
  assert.equal(passwordVerdict({ ok: false, stderr: 'Fatal: wrong password or no key found' }), 'wrong');
  assert.equal(passwordVerdict({ ok: false, stderr: 'Fatal: unable to open repository: no such host' }), 'unreachable');
});

