import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Restic } from '../lib/restic.js';
import { loadConfig } from '../lib/config.js';

test('rclone path reaches restic with forward slashes, quoted when it has spaces', () => {
  const r = new Restic({ repository: 'rclone:remote:x', passwordFile: 'p' });
  r.rclone = 'C:\\Users\\a\\rclone.exe';
  assert.ok(r.baseArgs().includes('rclone.program=C:/Users/a/rclone.exe'));
  r.rclone = 'C:\\Program Files\\rclone\\rclone.exe';
  assert.ok(r.baseArgs().includes('rclone.program="C:/Program Files/rclone/rclone.exe"'));
  const local = new Restic({ repository: 'D:\\backups\\x', passwordFile: 'p' });
  local.rclone = 'C:\\rclone.exe';
  assert.ok(!local.baseArgs().some((a) => a.startsWith('rclone.program')));
});

test('storage counts as chosen only after enroll recorded it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-cfg-'));
  process.env.AGENT_BACKUP_HOME = dir;
  const write = (o) => fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(o));
  try {
    write({ storage: 'gdrive', repository: 'rclone:r:x', components: { options: { claude: { exclude: ['a'] } } } });
    assert.equal(loadConfig()._storageChosen, false, 'a config from "component set" is not a choice');
    write({ storage: 'local', repository: 'D:/b/x', enrolled: '2026-10-14T00:00:00Z' });
    assert.equal(loadConfig()._storageChosen, true);
    write({ repository: 'rclone:r:x' });
    const legacy = loadConfig();
    assert.equal(legacy._storageChosen, true, '0.1.0 configs keep their repository');
    assert.equal(legacy.storage, 'gdrive');
  } finally {
    delete process.env.AGENT_BACKUP_HOME;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
