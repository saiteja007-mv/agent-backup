import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyStorage, STORAGE } from '../lib/config.js';
import { repoCandidates } from '../lib/commands/restore.js';
import { stateOf } from '../lib/commands/fleet.js';
import { remoteClientId } from '../lib/google.js';

const base = () => ({ host: 'laptop', home: path.resolve('/home/alex') });

test('gdrive: repository and fleet list on Google Drive, no copy', () => {
  const c = applyStorage(base(), 'gdrive');
  assert.equal(c.repository, 'rclone:agentvault-gdrive:AgentVault/laptop');
  assert.equal(c.registry, 'rclone:agentvault-gdrive:AgentVault/_fleet');
  assert.equal(c.copyTo, null);
});

test('local: folder under home by default, fleet list next to it, no copy', () => {
  const c = applyStorage(base(), 'local');
  const root = path.join(path.resolve('/home/alex'), 'AgentVault-backups');
  assert.equal(c.repository, path.join(root, 'laptop'));
  assert.equal(c.registry, path.join(root, '_fleet'));
  assert.equal(c.copyTo, null);
});

test('both: local folder plus a Google Drive copy; fleet list on Drive', () => {
  const c = applyStorage(base(), 'both', path.resolve('/mnt/usb/backups'));
  assert.equal(c.repository, path.join(path.resolve('/mnt/usb/backups'), 'laptop'));
  assert.equal(c.copyTo, 'rclone:agentvault-gdrive:AgentVault/laptop');
  assert.equal(c.registry, 'rclone:agentvault-gdrive:AgentVault/_fleet');
});

test('coming-soon storage is listed but refused', () => {
  assert.ok(STORAGE.find((s) => s.key === 'onedrive').soon);
  assert.ok(STORAGE.find((s) => s.key === 'icloud').soon);
  assert.throws(() => applyStorage(base(), 'onedrive'), /future release/);
  assert.throws(() => applyStorage(base(), 'dropbox'), /storage must be/);
});

test('restore order: this machine reads local first, then the copy', () => {
  const cfg = applyStorage(base(), 'both');
  assert.deepEqual(repoCandidates(cfg, 'laptop', [], {}), [cfg.repository, cfg.copyTo]);
  assert.deepEqual(repoCandidates(cfg, 'laptop', [], { source: 'copy' }), [cfg.copyTo]);
  assert.deepEqual(repoCandidates(cfg, 'laptop', [], { source: 'local' }), [cfg.repository]);
});

test('restore order: another machine reads its off-site copy first', () => {
  const cfg = applyStorage(base(), 'both');
  const fleet = [{ host: 'old', repository: '/home/x/AgentVault-backups/old', copyTo: 'rclone:agentvault-gdrive:AgentVault/old' }];
  assert.deepEqual(repoCandidates(cfg, 'old', fleet, {}), ['rclone:agentvault-gdrive:AgentVault/old', '/home/x/AgentVault-backups/old']);
  // not in the fleet list: same layout, our name swapped for theirs
  const guessed = repoCandidates(applyStorage(base(), 'gdrive'), 'other', [], {});
  assert.deepEqual(guessed, ['rclone:agentvault-gdrive:AgentVault/other']);
});

test('Google remote client detection reads rclone config dump', () => {
  const dump = JSON.stringify({ 'agentvault-gdrive': { type: 'drive', scope: 'drive.file', token: 'x' }, other: { type: 'drive', client_id: 'abc' } });
  assert.equal(remoteClientId(dump, 'agentvault-gdrive'), '');
  assert.equal(remoteClientId(dump, 'other'), 'abc');
  assert.equal(remoteClientId('not json', 'other'), '');
});

test('fleet flags a failed copy', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.equal(stateOf({ time: '2026-10-14T03:00:00Z', ok: true, copyOk: false }, now, 30), 'COPY FAILED');
  assert.equal(stateOf({ time: '2026-10-14T03:00:00Z', ok: true, copyOk: null }, now, 30), 'ok');
});
