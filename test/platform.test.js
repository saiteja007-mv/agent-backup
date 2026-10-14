import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotPath, resolveEntry, normHost } from '../lib/platform.js';
import { defaults } from '../lib/config.js';
import { parseArgs, list } from '../lib/args.js';
import { landed, targetsFor } from '../lib/commands/restore.js';
import { skipper } from '../lib/commands/scan.js';
import path from 'node:path';

test('snapshotPath matches how restic stores Windows paths', () => {
  assert.equal(snapshotPath('C:\\Users\\alex\\.claude', 'windows'), '/C/Users/alex/.claude');
  assert.equal(snapshotPath('d:\\data', 'windows'), '/D/data');
  assert.equal(snapshotPath('/home/alex/.claude', 'linux'), '/home/alex/.claude');
});

test('resolveEntry re-roots home entries on the target machine', () => {
  const ctx = { home: path.join(path.sep, 'home', 'sam'), os: 'linux' };
  assert.equal(resolveEntry({ root: 'home', rel: '.claude' }, ctx), path.join(ctx.home, '.claude'));
  assert.equal(resolveEntry({ root: 'hermes', rel: '' }, ctx), path.join(ctx.home, '.hermes'));
  assert.equal(resolveEntry({ root: 'abs', rel: '/etc/jellyfin' }, ctx), '/etc/jellyfin');
});

test('normHost', () => {
  assert.equal(normHost('BOBBY'), 'bobby');
  assert.equal(normHost('ideapad.tail1234.ts.net'), 'ideapad');
  assert.equal(normHost('My Laptop_2'), 'my-laptop-2');
});

test('defaults: 7/4/6 retention and one repository per machine', () => {
  const d = defaults('/tmp/av');
  assert.deepEqual(d.retention, { daily: 7, weekly: 4, monthly: 6 });
  assert.match(d.repository, /^rclone:agentvault-gdrive:AgentVault\/[a-z0-9-]+$/);
  assert.equal(d.passwordFile, path.join('/tmp/av', 'password'));
});

test('parseArgs', () => {
  const r = parseArgs(['restore', '--component', 'claude,codex', '--component', 'hermes', '--yes', '--mode=scratch', 'x'], new Set(['yes']));
  assert.equal(r.cmd, 'restore');
  assert.deepEqual(r.pos, ['x']);
  assert.equal(r.opts.yes, true);
  assert.equal(r.opts.mode, 'scratch');
  assert.deepEqual(list(r.opts.component), ['claude', 'codex', 'hermes']);
  assert.deepEqual(list(undefined), []);
});

test('landed: where a snapshot path ends up inside a restore folder', () => {
  assert.equal(landed('/t', 'C:\\Users\\alex\\.claude'), path.join('/t', 'C', 'Users', 'alex', '.claude'));
  assert.equal(landed('/t', '/home/alex/.claude'), path.join('/t', 'home', 'alex', '.claude'));
});

test('targetsFor: agents restore across OSes, machine-specific components do not', () => {
  const ctx = { home: '/home/sam', os: 'linux' };
  const agent = { crossOS: true, os: 'windows', entries: [{ root: 'home', rel: '.codex', abs: 'C:\\Users\\alex\\.codex' }] };
  assert.equal(targetsFor(agent, ctx)[0].target, path.join('/home/sam', '.codex'));
  const sys = { crossOS: false, os: 'windows', entries: [{ root: 'home', rel: '.ssh', abs: 'C:\\Users\\alex\\.ssh' }] };
  assert.equal(targetsFor(sys, ctx)[0].target, null);
});

test('skipper mirrors the exclude rules used for size estimates', () => {
  const base = path.join(path.sep, 'h', '.claude');
  const skip = skipper(['node_modules', '*.tmp', path.join(base, 'cache')]);
  assert.ok(skip(path.join(base, 'x', 'node_modules')));
  assert.ok(skip(path.join(base, 'a.tmp')));
  assert.ok(skip(path.join(base, 'cache', 'y')));
  assert.ok(!skip(path.join(base, 'settings.json')));
});
