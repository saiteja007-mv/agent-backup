import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComposeLs, dbKind, classifyMounts, hostPath } from '../lib/components/docker.js';
import { tailnetDevices, stateOf } from '../lib/commands/fleet.js';

test('parseComposeLs reads project names and compose files', () => {
  const s = parseComposeLs(JSON.stringify([
    { Name: 'vault', Status: 'running(1)', ConfigFiles: '/srv/vault/docker-compose.yml' },
    { Name: 'media', Status: 'exited(2)', ConfigFiles: '/srv/media/compose.yml,/srv/media/override.yml' },
    { Name: 'broken', ConfigFiles: '' },
  ]));
  assert.equal(s.length, 2);
  assert.equal(s[0].dir, '/srv/vault');
  assert.deepEqual(s[1].configFiles, ['/srv/media/compose.yml', '/srv/media/override.yml']);
  assert.deepEqual(parseComposeLs('not json'), []);
});

test('dbKind spots database images', () => {
  assert.equal(dbKind('postgres:16'), 'postgres');
  assert.equal(dbKind('ghcr.io/immich-app/postgres:14'), 'postgres');
  assert.equal(dbKind('pgvector/pgvector:pg16'), 'postgres');
  assert.equal(dbKind('mariadb:11'), 'mysql');
  assert.equal(dbKind('vaultwarden/server:latest'), null);
});

test('classifyMounts: named volumes kept, system and anonymous mounts skipped, big binds left out', () => {
  const m = [
    { Type: 'volume', Name: 'vault_data' },
    { Type: 'volume', Name: 'a'.repeat(64) },
    { Type: 'bind', Source: '/srv/vault/config' },
    { Type: 'bind', Source: '/var/run/docker.sock' },
    { Type: 'bind', Source: '/home/alex/media-db' },
    { Type: 'bind', Source: '/home/alex/movies' },
    { Type: 'bind', Source: '/usr/share/fonts' },
  ];
  const r = classifyMounts(m, '/srv/vault', '/home/alex', (p) => (p.endsWith('movies') ? 5e12 : 1000));
  assert.deepEqual(r.volumes, ['vault_data']);
  assert.deepEqual(r.binds, ['/home/alex/media-db']);
  assert.equal(r.skipped.length, 3);
});

test('hostPath turns Docker Desktop bind sources back into drive paths', () => {
  assert.equal(hostPath('/run/desktop/mnt/host/c/Users/alex/app', 'windows'), 'C:\\Users\\alex\\app');
  assert.equal(hostPath('/mnt/d/data', 'windows'), 'D:\\data');
  assert.equal(hostPath('/mnt/d/data', 'linux'), '/mnt/d/data');
});

test('fleet: tailnet devices and backup state', () => {
  const d = tailnetDevices({ Self: { HostName: 'BOBBY', OS: 'windows' }, Peer: { k: { HostName: 'ideapad', OS: 'linux', Online: false } } });
  assert.deepEqual(d.map((x) => [x.host, x.online, x.self]), [['bobby', true, true], ['ideapad', false, false]]);
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(stateOf({ time: '2026-10-13T03:00:00Z', ok: true }, now, 30), 'ok');
  assert.equal(stateOf({ time: '2026-10-11T03:00:00Z', ok: true }, now, 30), 'STALE');
  assert.equal(stateOf({ time: '2026-10-13T03:00:00Z', ok: false }, now, 30), 'LAST BACKUP FAILED');
  assert.equal(stateOf({ time: null, enrolled: '2026-10-13T11:00:00Z' }, now, 30), 'waiting for first backup');
});
